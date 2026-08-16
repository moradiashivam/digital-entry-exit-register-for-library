import { Router } from "express";
import { q, one } from "../db.js";
import { requireAuth, withInstitute, isMember, logAudit } from "../auth.js";

const router = Router();
router.use(requireAuth);

const FIELDS = [
  "institution_name", "kiosk_title", "logo_url", "welcome_message", "entry_label", "exit_label",
  "footer_note", "theme", "custom_css", "allow_palm", "allow_rfid", "allow_manual", "show_photo", "show_clock", "result_seconds",
];
const BOOLS = new Set(["allow_palm", "allow_rfid", "allow_manual", "show_photo", "show_clock"]);

router.get("/kiosk", withInstitute(isMember), async (req, res) => {
  let row = await one("SELECT * FROM kiosk_settings WHERE institute_id = ?", [req.institute.id]);
  if (!row) {
    await q("INSERT INTO kiosk_settings (institute_id, institution_name) VALUES (?, ?)",
      [req.institute.id, req.institute.name]);
    row = await one("SELECT * FROM kiosk_settings WHERE institute_id = ?", [req.institute.id]);
  }
  res.json(row);
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
  res.json(await one("SELECT * FROM kiosk_settings WHERE institute_id = ?", [req.institute.id]));
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

export default router;
