import { Router } from "express";
import { q, one, uuid } from "../db.js";
import { requireAuth, withInstitute, isMember, logAudit } from "../auth.js";
import { requireModule, requireWrite, kioskScope } from "../access.js";
import { autoExitInstitute } from "../jobs.js";
import { serverTimezone } from "../tz.js";
import { studentInsights, pickInsights, DEFAULT_CATEGORIES } from "../insights.service.js";

const router = Router();
router.use(requireAuth);


const FIELDS = [
  "institution_name", "kiosk_title", "logo_url", "welcome_message", "entry_label", "exit_label",
  "footer_note", "theme", "kiosk_template", "custom_css", "allow_palm", "allow_rfid", "allow_manual", "allow_barcode", "show_photo", "show_clock", "result_seconds", "timezone", "multi_kiosk_transfer", "allow_face", "face_threshold", "face_model_url",
  // “Did You Know?” student insights shown on the kiosk after a scan.
  "insights_enabled", "insights_on_entry", "insights_on_exit", "insights_title",
  "insights_count", "insights_categories", "insights_goal", "insights_item_html",
];
const BOOLS = new Set(["allow_palm", "allow_rfid", "allow_manual", "allow_barcode", "show_photo", "show_clock", "multi_kiosk_transfer", "allow_face", "insights_enabled", "insights_on_entry", "insights_on_exit"]);


router.get("/kiosk", withInstitute(isMember), async (req, res) => {
  let row = await one("SELECT * FROM kiosk_settings WHERE institute_id = ?", [req.institute.id]);
  if (!row) {
    await q("INSERT INTO kiosk_settings (institute_id, institution_name) VALUES (?, ?)",
      [req.institute.id, req.institute.name]);
    row = await one("SELECT * FROM kiosk_settings WHERE institute_id = ?", [req.institute.id]);
  }
  // server_timezone lets the browser translate MySQL wall-clock times correctly.
  res.json({ ...row, server_timezone: serverTimezone() });
});

router.put("/kiosk", withInstitute(), requireModule("kiosks"), requireWrite, async (req, res) => {
  const patch = {};
  for (const f of FIELDS) {
    if (req.body?.[f] === undefined) continue;
    patch[f] = BOOLS.has(f) ? (req.body[f] ? 1 : 0) : req.body[f];
  }
  if (!Object.keys(patch).length) return res.json({ ok: true });
  await q(
    `INSERT INTO kiosk_settings (institute_id, ${Object.keys(patch).join(", ")})
     VALUES (?, ${Object.keys(patch).map(() => "?").join(", ")})
     ON DUPLICATE KEY UPDATE ${Object.keys(patch).map((k) => `${k} = VALUES(${k})`).join(", ")}`,
    [req.institute.id, ...Object.values(patch)],
  );
  await logAudit(req, req.institute.id, "kiosk.settings_update", "kiosk_settings", req.institute.id, patch);
  const saved = await one("SELECT * FROM kiosk_settings WHERE institute_id = ?", [req.institute.id]);
  res.json({ ...saved, server_timezone: serverTimezone() });
});

/**
 * Preview the “Did You Know?” insights of one member (membership number),
 * so an admin can see exactly what the kiosk will show.
 */
router.get("/insights/preview", withInstitute(isMember), async (req, res) => {
  const code = String(req.query.code || "").trim();
  if (!code) return res.status(400).json({ error: "Enter a membership number" });
  const member = await one(
    "SELECT id, full_name, member_code FROM members WHERE institute_id = ? AND member_code = ?",
    [req.institute.id, code],
  );
  if (!member) return res.status(404).json({ error: "No member with that membership number" });
  const cfg = await one("SELECT * FROM kiosk_settings WHERE institute_id = ?", [req.institute.id]);
  const all = await studentInsights(req.institute.id, member.id, {
    categories: cfg?.insights_categories || DEFAULT_CATEGORIES,
    monthly_goal: Number(cfg?.insights_goal || 0),
  });
  res.json({
    member,
    title: cfg?.insights_title || "Did You Know?",
    shown: pickInsights(all, cfg?.insights_count ?? 2),
    all,
  });
});


/** Staff accounts attached to this university (visible to its own admins). */
router.get("/staff", withInstitute(), async (req, res) => {
  res.json(await q(
    `SELECT u.id, u.email, u.full_name, u.status, u.last_login_at, r.role
     FROM user_roles r JOIN users u ON u.id = r.user_id
     WHERE r.institute_id = ? ORDER BY u.email`,
    [req.institute.id],
  ));
});

/* ---------------- Library working hours (per weekday) ---------------- */

const DEFAULT_HOURS = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  is_closed: weekday === 0 ? 1 : 0,
  open_time: "09:00",
  close_time: "18:00",
  auto_exit: 1,
}));

const hhmm = (v) => {
  const m = String(v ?? "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const mi = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
};

router.get("/hours", withInstitute(isMember), async (req, res) => {
  const rows = await q("SELECT * FROM library_hours WHERE institute_id = ?", [req.institute.id]);
  const map = new Map(rows.map((r) => [Number(r.weekday), r]));
  res.json(DEFAULT_HOURS.map((d) => {
    const r = map.get(d.weekday);
    if (!r) return d;
    return {
      weekday: d.weekday,
      is_closed: Number(r.is_closed) ? 1 : 0,
      open_time: String(r.open_time).slice(0, 5),
      close_time: String(r.close_time).slice(0, 5),
      auto_exit: Number(r.auto_exit) ? 1 : 0,
    };
  }));
});

router.put("/hours", withInstitute(), requireModule("kiosks"), requireWrite, async (req, res) => {
  const days = Array.isArray(req.body?.days) ? req.body.days : [];
  for (const d of days) {
    const weekday = Number(d.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
    const open = hhmm(d.open_time) || "09:00";
    const close = hhmm(d.close_time) || "18:00";
    await q(
      `INSERT INTO library_hours (institute_id, weekday, is_closed, open_time, close_time, auto_exit)
       VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE is_closed = VALUES(is_closed), open_time = VALUES(open_time),
         close_time = VALUES(close_time), auto_exit = VALUES(auto_exit)`,
      [req.institute.id, weekday, d.is_closed ? 1 : 0, `${open}:00`, `${close}:00`, d.auto_exit ? 1 : 0],
    );
  }
  await logAudit(req, req.institute.id, "settings.library_hours_update", "library_hours", req.institute.id, { days });
  res.json({ ok: true });
});

/* ---------------- Special days (holiday / custom timing calendar) ---------------- */

const ymd = (v) => {
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : null;
};

/** All calendar overrides, newest first (optionally filtered to one month). */
router.get("/special-days", withInstitute(isMember), async (req, res) => {
  const rows = await q(
    "SELECT * FROM library_special_days WHERE institute_id = ? ORDER BY day",
    [req.institute.id],
  );
  res.json(rows.map((r) => ({
    day: String(r.day).slice(0, 10),
    is_closed: Number(r.is_closed) ? 1 : 0,
    open_time: String(r.open_time).slice(0, 5),
    close_time: String(r.close_time).slice(0, 5),
    auto_exit: Number(r.auto_exit) ? 1 : 0,
    reason: r.reason || "",
  })));
});

/** Add or update one calendar day. */
router.put("/special-days", withInstitute(), requireModule("kiosks"), requireWrite, async (req, res) => {
  const day = ymd(req.body?.day);
  if (!day) return res.status(400).json({ error: "Pick a valid date" });
  const isClosed = req.body?.is_closed ? 1 : 0;
  const open = hhmm(req.body?.open_time) || "09:00";
  const close = hhmm(req.body?.close_time) || "18:00";
  const reason = String(req.body?.reason ?? "").trim().slice(0, 160) || null;
  await q(
    `INSERT INTO library_special_days (institute_id, day, is_closed, open_time, close_time, auto_exit, reason)
     VALUES (?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE is_closed = VALUES(is_closed), open_time = VALUES(open_time),
       close_time = VALUES(close_time), auto_exit = VALUES(auto_exit), reason = VALUES(reason)`,
    [req.institute.id, day, isClosed, `${open}:00`, `${close}:00`, req.body?.auto_exit ? 1 : 0, reason],
  );
  await logAudit(req, req.institute.id, "settings.special_day_save", "library_special_days", day, { day, isClosed, reason });
  res.json({ day, is_closed: isClosed, open_time: open, close_time: close, auto_exit: req.body?.auto_exit ? 1 : 0, reason: reason || "" });
});

/** Remove one calendar override (day falls back to the weekly hours). */
router.delete("/special-days/:day", withInstitute(), requireModule("kiosks"), requireWrite, async (req, res) => {
  const day = ymd(req.params.day);
  if (!day) return res.status(400).json({ error: "Invalid date" });
  await q("DELETE FROM library_special_days WHERE institute_id = ? AND day = ?", [req.institute.id, day]);
  await logAudit(req, req.institute.id, "settings.special_day_delete", "library_special_days", day, { day });
  res.json({ ok: true });
});

/** Close open visits now, library-wise, and record who ran it. */
router.post("/hours/auto-exit", withInstitute(), requireModule("kiosks"), requireWrite, async (req, res) => {
  const scope = ["all", "main", "sub"].includes(req.body?.scope) ? req.body.scope : "all";
  const sublibraryIds = Array.isArray(req.body?.sublibrary_ids)
    ? req.body.sublibrary_ids.map(String).slice(0, 100)
    : [];
  if (scope === "sub" && !sublibraryIds.length) {
    return res.status(400).json({ error: "Pick at least one sublibrary" });
  }
  const closed = await autoExitInstitute(req.institute.id, {
    scope,
    sublibraryIds,
    force: req.body?.force !== false,
  });
  await logAudit(req, req.institute.id, "settings.auto_exit_run", "entry_exit_logs", null, {
    scope,
    sublibrary_ids: sublibraryIds,
    closed,
  });
  res.json({ closed, scope });
});



/* ---------------- PDF header / footer branding (report exports only) ---------------- */

const PDF_DEFAULTS = {
  enabled: 0,
  header_type: "none",
  header_content: null,
  header_height_mm: 25,
  footer_type: "none",
  footer_content: null,
  footer_height_mm: 18,
};

const pdfPart = (type, content) => {
  const t = ["none", "html", "image"].includes(type) ? type : "none";
  if (t === "none") return { type: "none", content: null };
  const value = String(content ?? "").trim();
  if (!value) return { type: "none", content: null };
  if (t === "image" && !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(value)) {
    const err = new Error("Upload a JPG or PNG image file");
    err.status = 400;
    throw err;
  }
  return { type: t, content: value.slice(0, 4 * 1024 * 1024) };
};

const mm = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(80, Math.max(5, Math.round(n))) : fallback;
};

router.get("/pdf-branding", withInstitute(isMember), async (req, res) => {
  const row = await one("SELECT * FROM pdf_branding WHERE institute_id = ?", [req.institute.id]);
  res.json(row ? { ...row, enabled: Number(row.enabled) ? 1 : 0 } : { institute_id: req.institute.id, ...PDF_DEFAULTS });
});

router.put("/pdf-branding", withInstitute(), requireWrite, async (req, res, next) => {
  try {
    const header = pdfPart(req.body?.header_type, req.body?.header_content);
    const footer = pdfPart(req.body?.footer_type, req.body?.footer_content);
    const patch = {
      enabled: req.body?.enabled ? 1 : 0,
      header_type: header.type,
      header_content: header.content,
      header_height_mm: mm(req.body?.header_height_mm, 25),
      footer_type: footer.type,
      footer_content: footer.content,
      footer_height_mm: mm(req.body?.footer_height_mm, 18),
    };
    const keys = Object.keys(patch);
    await q(
      `INSERT INTO pdf_branding (institute_id, ${keys.join(", ")})
       VALUES (?, ${keys.map(() => "?").join(", ")})
       ON DUPLICATE KEY UPDATE ${keys.map((k) => `${k} = VALUES(${k})`).join(", ")}`,
      [req.institute.id, ...keys.map((k) => patch[k])],
    );
    await logAudit(req, req.institute.id, "settings.pdf_branding_update", "pdf_branding", req.institute.id, {
      enabled: patch.enabled, header_type: patch.header_type, footer_type: patch.footer_type,
    });
    res.json({ institute_id: req.institute.id, ...patch });
  } catch (e) {
    next(e);
  }
});


/* ---------------- Kiosks / terminals ---------------- */

/** Slug-safe device id, e.g. "Main Gate" -> "main-gate". */
const deviceSlug = (v) =>
  String(v ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/** List every kiosk of this university (creates the default one on first use). */
router.get("/kiosks", withInstitute(isMember), async (req, res) => {
  // Sublibrary users only ever see the terminals assigned to them.
  const scope = kioskScope(req.access, "k.device_id");
  const list = () => q(
    `SELECT k.id, k.device_id, k.name, k.location, k.is_active, k.sublibrary_id, s.name AS sublibrary
     FROM kiosk_devices k
     LEFT JOIN sublibraries s ON s.id = k.sublibrary_id
     WHERE k.institute_id = ?${scope.sql} ORDER BY k.name`,
    [req.institute.id, ...scope.params],
  );
  let rows = await list();
  if (!rows.length && req.access?.admin) {
    await q(
      "INSERT IGNORE INTO kiosk_devices (id, institute_id, device_id, name, location) VALUES (?,?,?,?,?)",
      [uuid(), req.institute.id, "kiosk-1", "Main kiosk", null],
    );
    rows = await list();
  }
  res.json(rows);
});

/** Create another kiosk for this university. */
router.post("/kiosks", withInstitute(), requireModule("kiosks"), requireWrite, async (req, res) => {
  const name = String(req.body?.name ?? "").trim().slice(0, 120);
  if (!name) return res.status(400).json({ error: "Kiosk name is required" });
  const location = String(req.body?.location ?? "").trim().slice(0, 120) || null;

  const base = deviceSlug(req.body?.device_id || name) || "kiosk";
  let deviceId = base;
  for (let n = 2; n < 200; n++) {
    const clash = await one("SELECT id FROM kiosk_devices WHERE institute_id = ? AND device_id = ?", [req.institute.id, deviceId]);
    if (!clash) break;
    deviceId = `${base}-${n}`;
  }

  const id = uuid();
  const sublibraryId = req.body?.sublibrary_id || null;
  await q(
    "INSERT INTO kiosk_devices (id, institute_id, device_id, name, location, sublibrary_id) VALUES (?,?,?,?,?,?)",
    [id, req.institute.id, deviceId, name, location, sublibraryId],
  );
  await logAudit(req, req.institute.id, "kiosk.device_create", "kiosk_devices", id, { device_id: deviceId, name });
  res.json({ id, device_id: deviceId, name, location, sublibrary_id: sublibraryId, is_active: 1 });
});

/** Rename a kiosk (or change its location / active state). */
router.patch("/kiosks/:id", withInstitute(), requireModule("kiosks"), requireWrite, async (req, res) => {
  const row = await one("SELECT * FROM kiosk_devices WHERE id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  if (!row) return res.status(404).json({ error: "Kiosk not found" });

  const name = req.body?.name === undefined ? row.name : String(req.body.name).trim().slice(0, 120);
  if (!name) return res.status(400).json({ error: "Kiosk name is required" });
  const location = req.body?.location === undefined
    ? row.location
    : (String(req.body.location).trim().slice(0, 120) || null);
  const isActive = req.body?.is_active === undefined ? row.is_active : (req.body.is_active ? 1 : 0);

  const sublibraryId = req.body?.sublibrary_id === undefined ? row.sublibrary_id : (req.body.sublibrary_id || null);
  await q("UPDATE kiosk_devices SET name = ?, location = ?, is_active = ?, sublibrary_id = ? WHERE id = ?",
    [name, location, isActive, sublibraryId, row.id]);
  await logAudit(req, req.institute.id, "kiosk.device_update", "kiosk_devices", row.id, { name, location, is_active: isActive });
  res.json({ id: row.id, device_id: row.device_id, name, location, is_active: isActive, sublibrary_id: sublibraryId });
});

/** Remove a kiosk. Past scan history keeps its device id. */
router.delete("/kiosks/:id", withInstitute(), requireModule("kiosks"), requireWrite, async (req, res) => {
  const row = await one("SELECT * FROM kiosk_devices WHERE id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  if (!row) return res.status(404).json({ error: "Kiosk not found" });
  await q("DELETE FROM kiosk_devices WHERE id = ?", [row.id]);
  await logAudit(req, req.institute.id, "kiosk.device_delete", "kiosk_devices", row.id, { device_id: row.device_id });
  res.json({ ok: true });
});

export default router;

