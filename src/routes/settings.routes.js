import { Router } from "express";
import { q, one } from "../db.js";
import { requireAuth, withInstitute, isMember, logAudit } from "../auth.js";
import { autoExitInstitute } from "../jobs.js";
import { serverTimezone } from "../tz.js";

const router = Router();
router.use(requireAuth);

const FIELDS = [
  "institution_name", "kiosk_title", "logo_url", "welcome_message", "entry_label", "exit_label",
  "footer_note", "theme", "custom_css", "allow_palm", "allow_rfid", "allow_manual", "allow_barcode", "show_photo", "show_clock", "result_seconds", "timezone",
];
const BOOLS = new Set(["allow_palm", "allow_rfid", "allow_manual", "allow_barcode", "show_photo", "show_clock"]);

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

router.put("/kiosk", withInstitute(), async (req, res) => {
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

router.put("/hours", withInstitute(), async (req, res) => {
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
router.post("/hours/auto-exit", withInstitute(), async (req, res) => {
  const closed = await autoExitInstitute(req.institute.id);
  res.json({ closed });
});

export default router;
