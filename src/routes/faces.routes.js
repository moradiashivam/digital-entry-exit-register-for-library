/**
 * Facial recognition enrolment (university admin side).
 *
 * The maths runs in the browser (face-api.js); the server only stores the
 * 128-number descriptor produced from the member's photo or a webcam capture,
 * and serves those descriptors back to the kiosk for matching.
 */
import { Router } from "express";
import { q, one, uuid } from "../db.js";
import { requireAuth, withInstitute, isMember, logAudit } from "../auth.js";
import { requireModule, requireWrite } from "../access.js";

const router = Router();
router.use(requireAuth);

const parseDescriptor = (raw) => {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length !== 128) return null;
  const out = list.map((n) => Number(n));
  return out.every((n) => Number.isFinite(n)) ? out : null;
};

/** Members of this university with their photo and face-enrolment status. */
router.get("/", withInstitute(isMember), requireModule("members"), async (req, res) => {
  const search = String(req.query.search || "").trim();
  const args = [req.institute.id];
  let where = "m.institute_id = ?";
  if (search) {
    where += " AND (m.full_name LIKE ? OR m.member_code LIKE ?)";
    args.push(`%${search}%`, `%${search}%`);
  }
  const rows = await q(
    `SELECT m.id, m.member_code, m.full_name, m.photo_url, m.status,
            f.id AS face_id, f.source AS face_source, f.quality AS face_quality, f.created_at AS face_at
     FROM members m
     LEFT JOIN face_templates f ON f.member_id = m.id
     WHERE ${where}
     ORDER BY m.full_name
     LIMIT 2000`,
    args,
  );
  res.json(rows);
});

/** Save (or replace) one member's face descriptor. */
router.put("/:memberId", withInstitute(), requireModule("members"), requireWrite, async (req, res) => {
  const descriptor = parseDescriptor(req.body?.descriptor);
  if (!descriptor) return res.status(400).json({ error: "A 128-value face descriptor is required" });
  const member = await one("SELECT id, member_code FROM members WHERE id = ? AND institute_id = ?", [
    req.params.memberId, req.institute.id,
  ]);
  if (!member) return res.status(404).json({ error: "Member not found" });

  const source = req.body?.source === "camera" ? "camera" : "photo";
  const quality = Number(req.body?.quality);
  await q(
    `INSERT INTO face_templates (id, institute_id, member_id, descriptor, source, quality)
     VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE descriptor = VALUES(descriptor), source = VALUES(source),
       quality = VALUES(quality), created_at = CURRENT_TIMESTAMP`,
    [uuid(), req.institute.id, member.id, JSON.stringify(descriptor), source,
     Number.isFinite(quality) ? quality : null],
  );
  await logAudit(req, req.institute.id, "face.enrol", "face_templates", member.id, { source });
  res.json({ ok: true });
});

/** Remove one member's face. */
router.delete("/:memberId", withInstitute(), requireModule("members"), requireWrite, async (req, res) => {
  await q("DELETE FROM face_templates WHERE member_id = ? AND institute_id = ?", [
    req.params.memberId, req.institute.id,
  ]);
  await logAudit(req, req.institute.id, "face.remove", "face_templates", req.params.memberId, {});
  res.json({ ok: true });
});

/** Remove every enrolled face of the university. */
router.post("/clear", withInstitute(), requireModule("members"), requireWrite, async (req, res) => {
  await q("DELETE FROM face_templates WHERE institute_id = ?", [req.institute.id]);
  await logAudit(req, req.institute.id, "face.clear_all", "face_templates", req.institute.id, {});
  res.json({ ok: true });
});

export default router;
