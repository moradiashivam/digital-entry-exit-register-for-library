import { Router } from "express";
import { q, one, uuid } from "../db.js";
import { requireAuth, withInstitute, isMember, logAudit } from "../auth.js";
import { requireModule, requireWrite, kioskScope } from "../access.js";
import { autoExitInstitute } from "../jobs.js";
import { serverTimezone } from "../tz.js";

const router = Router();
router.use(requireAuth);


const FIELDS = [
  "institution_name", "kiosk_title", "logo_url", "welcome_message", "entry_label", "exit_label",
  "footer_note", "theme", "custom_css", "allow_palm", "allow_rfid", "allow_manual", "allow_barcode", "show_photo", "show_clock", "result_seconds", "timezone", "multi_kiosk_transfer",
];
const BOOLS = new Set(["allow_palm", "allow_rfid", "allow_manual", "allow_barcode", "show_photo", "show_clock", "multi_kiosk_transfer"]);

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

/** Close open visits now, using each weekday's closing time. */
router.post("/hours/auto-exit", withInstitute(), requireModule("kiosks"), requireWrite, async (req, res) => {
  const closed = await autoExitInstitute(req.institute.id);
  res.json({ closed });
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

