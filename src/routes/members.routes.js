import { Router } from "express";
import { q, one, uuid, today, plusYear } from "../db.js";
import { requireAuth, withInstitute, canViewReports, logAudit } from "../auth.js";

const router = Router();
router.use(requireAuth);

const MOBILE = /^[0-9]{10}$/;

const clean = (v) => (v === undefined || v === "" ? null : v);

/** List / search members of the active university. */
router.get("/", withInstitute(canViewReports), async (req, res) => {
  const search = `%${String(req.query.search || "").trim()}%`;
  const status = req.query.status;
  const params = [req.institute.id, search, search, search];
  let sql = `
    SELECT m.*, c.name AS course, d.name AS department, y.name AS academic_year,
           (SELECT COUNT(*) FROM palm_templates p WHERE p.member_id = m.id) AS palm_count
    FROM members m
    LEFT JOIN courses c ON c.id = m.course_id
    LEFT JOIN departments d ON d.id = m.department_id
    LEFT JOIN academic_years y ON y.id = m.academic_year_id
    WHERE m.institute_id = ? AND (m.full_name LIKE ? OR m.member_code LIKE ? OR m.email LIKE ?)`;
  if (status) {
    sql += " AND m.status = ?";
    params.push(status);
  }
  sql += " ORDER BY m.full_name LIMIT 1000";
  res.json(await q(sql, params));
});

function validate(body) {
  if (!String(body.member_code || "").trim()) return "Member code is required";
  if (!String(body.full_name || "").trim()) return "Full name is required";
  if (!MOBILE.test(String(body.mobile || ""))) return "Mobile must be exactly 10 digits";
  if (!String(body.email || "").includes("@")) return "A valid email is required";
  const from = body.valid_from || today();
  const to = body.valid_to || plusYear();
  if (to <= from) return "Valid-to date must be after valid-from";
  return null;
}

router.post("/", withInstitute(), async (req, res) => {
  const error = validate(req.body || {});
  if (error) return res.status(400).json({ error });
  const id = uuid();
  const b = req.body;
  try {
    await q(
      `INSERT INTO members (id, institute_id, member_code, full_name, course_id, department_id, academic_year_id,
        gender, mobile, email, photo_url, rfid_uid, valid_from, valid_to, status, source, consent_given)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.institute.id, b.member_code.trim(), b.full_name.trim(), clean(b.course_id), clean(b.department_id),
       clean(b.academic_year_id), b.gender || "Other", b.mobile, b.email.trim(), clean(b.photo_url),
       clean(b.rfid_uid), b.valid_from || today(), b.valid_to || plusYear(), b.status || "Active",
       b.source || "manual", b.consent_given ? 1 : 0],
    );
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Member code or RFID already exists" });
    throw e;
  }
  await logAudit(req, req.institute.id, "member.create", "members", id, { code: b.member_code });
  res.status(201).json(await one("SELECT * FROM members WHERE id = ?", [id]));
});

router.patch("/:id", withInstitute(), async (req, res) => {
  const member = await one("SELECT * FROM members WHERE id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  if (!member) return res.status(404).json({ error: "Member not found" });
  const merged = { ...member, ...req.body };
  const error = validate(merged);
  if (error) return res.status(400).json({ error });

  const allowed = ["member_code", "full_name", "course_id", "department_id", "academic_year_id", "gender",
    "mobile", "email", "photo_url", "rfid_uid", "valid_from", "valid_to", "status", "consent_given"];
  const patch = {};
  for (const f of allowed) if (req.body?.[f] !== undefined) patch[f] = f === "consent_given" ? (req.body[f] ? 1 : 0) : clean(req.body[f]);
  if (!Object.keys(patch).length) return res.json(member);

  await q(
    `UPDATE members SET ${Object.keys(patch).map((k) => `${k} = ?`).join(", ")} WHERE id = ? AND institute_id = ?`,
    [...Object.values(patch), member.id, req.institute.id],
  );
  await logAudit(req, req.institute.id, "member.update", "members", member.id, patch);
  res.json(await one("SELECT * FROM members WHERE id = ?", [member.id]));
});

router.delete("/:id", withInstitute(), async (req, res) => {
  await q("DELETE FROM members WHERE id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  await logAudit(req, req.institute.id, "member.delete", "members", req.params.id, null);
  res.json({ ok: true });
});

/** Bulk import rows parsed from Excel/CSV in the browser. */
router.post("/bulk", withInstitute(), async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const fileName = String(req.body?.file_name || "import.xlsx");
  const results = [];
  let ok = 0;

  for (const [index, row] of rows.entries()) {
    const error = validate(row);
    if (error) {
      results.push({ row: index + 2, error });
      continue;
    }
    try {
      await q(
        `INSERT INTO members (id, institute_id, member_code, full_name, gender, mobile, email,
           rfid_uid, valid_from, valid_to, status, source, consent_given)
         VALUES (?,?,?,?,?,?,?,?,?,?,?, 'excel_import', ?)
         ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), mobile = VALUES(mobile),
           email = VALUES(email), valid_to = VALUES(valid_to), status = VALUES(status)`,
        [uuid(), req.institute.id, String(row.member_code).trim(), String(row.full_name).trim(),
         row.gender || "Other", String(row.mobile), String(row.email).trim(), clean(row.rfid_uid),
         row.valid_from || today(), row.valid_to || plusYear(), row.status || "Active",
         row.consent_given ? 1 : 0],
      );
      ok += 1;
    } catch (e) {
      results.push({ row: index + 2, error: e.code === "ER_DUP_ENTRY" ? "Duplicate RFID" : e.message });
    }
  }

  await q(
    `INSERT INTO bulk_import_logs (id, institute_id, admin_id, admin_email, file_name, total_rows, success_count, error_count)
     VALUES (?,?,?,?,?,?,?,?)`,
    [uuid(), req.institute.id, req.user.id, req.user.email, fileName, rows.length, ok, results.length],
  );
  await logAudit(req, req.institute.id, "member.bulk_import", "members", null, { fileName, ok, failed: results.length });
  res.json({ total: rows.length, success: ok, errors: results });
});

/** Store a palm feature template captured by the C++ bridge / enrolment tool. */
router.post("/:id/palm", withInstitute(), async (req, res) => {
  const member = await one("SELECT id FROM members WHERE id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  if (!member) return res.status(404).json({ error: "Member not found" });
  const id = uuid();
  await q(
    `INSERT INTO palm_templates (id, institute_id, member_id, hand_type, template_hash, quality_score, device_id)
     VALUES (?,?,?,?,?,?,?)`,
    [id, req.institute.id, member.id, req.body?.hand_type === "Left" ? "Left" : "Right",
     String(req.body?.template_hash || ""), clean(req.body?.quality_score), clean(req.body?.device_id)],
  );
  await logAudit(req, req.institute.id, "member.palm_enroll", "palm_templates", id, null);
  res.status(201).json({ id });
});

router.delete("/:id/palm", withInstitute(), async (req, res) => {
  await q("DELETE FROM palm_templates WHERE member_id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  await logAudit(req, req.institute.id, "member.palm_clear", "palm_templates", req.params.id, null);
  res.json({ ok: true });
});

export default router;
