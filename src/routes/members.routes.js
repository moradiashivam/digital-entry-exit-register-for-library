import { Router } from "express";
import { pool, q, one, uuid, today, plusYear } from "../db.js";
import { requireAuth, withInstitute, canViewReports, logAudit } from "../auth.js";
import { requireModule, requireWrite, requireBulk } from "../access.js";
import { savePhoto, deletePhoto } from "../photos.js";

const router = Router();
router.use(requireAuth);

const MOBILE = /^[0-9]{10}$/;

const clean = (v) => (v === undefined || v === "" ? null : v);

/**
 * Accepts YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, D.M.YYYY and Excel serial numbers.
 * Returns null when the value is empty and undefined when it cannot be understood.
 */
export function normalizeDate(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;

  const dmy = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (dmy) {
    let [, d, m, y] = dmy;
    if (Number(d) > 12 && Number(m) <= 12) { /* clearly day-first */ }
    else if (Number(m) > 12) { [d, m] = [m, d]; }
    if (y.length === 2) y = `20${y}`;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (serial > 20000 && serial < 80000) {
      const ms = Math.round((serial - 25569) * 86400000);
      return new Date(ms).toISOString().slice(0, 10);
    }
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return undefined;
}

/** List / search members of the active university. */
router.get("/", withInstitute(canViewReports), requireModule("members"), async (req, res) => {
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

/** Only member code, name and the validity window are mandatory. */
function validate(body) {
  if (!String(body.member_code || "").trim()) return "Member code is required";
  if (!String(body.full_name || "").trim()) return "Full name is required";
  const mobile = String(body.mobile ?? "").trim();
  if (mobile && !MOBILE.test(mobile)) return "Mobile must be exactly 10 digits";
  const email = String(body.email ?? "").trim();
  if (email && !email.includes("@")) return "Enter a valid email address or leave it blank";
  const fromRaw = normalizeDate(body.valid_from);
  const toRaw = normalizeDate(body.valid_to);
  if (fromRaw === undefined) return "Valid-from is not a recognised date (use YYYY-MM-DD or DD-MM-YYYY)";
  if (toRaw === undefined) return "Valid-to is not a recognised date (use YYYY-MM-DD or DD-MM-YYYY)";
  const from = fromRaw || today();
  const to = toRaw || plusYear();
  if (to <= from) return "Valid-to date must be after valid-from";
  return null;
}


router.post("/", withInstitute(), requireModule("members"), requireWrite, async (req, res) => {
  const error = validate(req.body || {});
  if (error) return res.status(400).json({ error });
  const id = uuid();
  const b = req.body;
  let photoUrl = clean(b.photo_url);
  if (b.photo_data) {
    try {
      photoUrl = await savePhoto(req.institute, b.member_code, b.photo_data);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }
  try {
    await q(
      `INSERT INTO members (id, institute_id, member_code, full_name, course_id, department_id, academic_year_id,
        gender, designation, mobile, email, photo_url, rfid_uid, valid_from, valid_to, status, source, consent_given)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.institute.id, b.member_code.trim(), b.full_name.trim(), clean(b.course_id), clean(b.department_id),
       clean(b.academic_year_id), b.gender || "Other", clean(b.designation) || "Student", clean(String(b.mobile ?? "").trim()),
       clean(String(b.email ?? "").trim()), photoUrl,
       clean(b.rfid_uid), normalizeDate(b.valid_from) || today(), normalizeDate(b.valid_to) || plusYear(), b.status || "Active",
       b.source || "manual", b.consent_given ? 1 : 0],
    );
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Member code or RFID already exists" });
    throw e;
  }
  await logAudit(req, req.institute.id, "member.create", "members", id, { code: b.member_code });
  res.status(201).json(await one("SELECT * FROM members WHERE id = ?", [id]));
});

router.patch("/:id", withInstitute(), requireModule("members"), requireWrite, async (req, res) => {
  const member = await one("SELECT * FROM members WHERE id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  if (!member) return res.status(404).json({ error: "Member not found" });
  const merged = { ...member, ...req.body };
  const error = validate(merged);
  if (error) return res.status(400).json({ error });

  const allowed = ["member_code", "full_name", "course_id", "department_id", "academic_year_id", "gender", "designation",
    "mobile", "email", "photo_url", "rfid_uid", "valid_from", "valid_to", "status", "consent_given"];
  const patch = {};
  if (req.body?.photo_data) {
    try {
      patch.photo_url = await savePhoto(req.institute, merged.member_code, req.body.photo_data);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }
  for (const f of allowed) {
    if (req.body?.[f] === undefined) continue;
    if (f === "consent_given") patch[f] = req.body[f] ? 1 : 0;
    else if (f === "valid_from" || f === "valid_to") patch[f] = normalizeDate(req.body[f]) || (f === "valid_from" ? today() : plusYear());
    else patch[f] = clean(req.body[f]);
  }
  if (!Object.keys(patch).length) return res.json(member);

  await q(
    `UPDATE members SET ${Object.keys(patch).map((k) => `${k} = ?`).join(", ")} WHERE id = ? AND institute_id = ?`,
    [...Object.values(patch), member.id, req.institute.id],
  );
  await logAudit(req, req.institute.id, "member.update", "members", member.id, patch);
  res.json(await one("SELECT * FROM members WHERE id = ?", [member.id]));
});

router.delete("/:id", withInstitute(), requireModule("members"), requireWrite, async (req, res) => {
  await q("DELETE FROM members WHERE id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  await logAudit(req, req.institute.id, "member.delete", "members", req.params.id, null);
  res.json({ ok: true });
});

/**
 * Bulk import rows parsed from Excel/CSV in the browser.
 * The CSV only carries the per-member columns; course / department / academic year /
 * photo and consent come from `defaults` chosen in the import screen and apply to every row.
 *
 * The screen uploads the file in small chunks so it can draw a live progress bar.
 * Every chunk carries the same `batch_id` (and `row_offset` so error row numbers stay
 * correct); the import history row is created on the first chunk and topped up after each one.
 */
router.post("/bulk", withInstitute(), requireModule("members"), requireWrite, requireBulk, async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const fileName = String(req.body?.file_name || "import.csv");
  const d = req.body?.defaults || {};
  // "skip" keeps the existing member, "overwrite" updates it from the CSV.
  const duplicateMode = req.body?.duplicate_mode === "overwrite" ? "overwrite" : "skip";
  const given = String(req.body?.batch_id || "");
  const batchId = /^[0-9a-f-]{36}$/i.test(given) ? given : uuid();
  const rowOffset = Number(req.body?.row_offset) || 0;
  const isLast = req.body?.is_last !== false;
  const results = [];
  let created = 0, updated = 0, skipped = 0, duplicates = 0;

  // Master data codes from the sheet -> master record ids.
  const codeMap = async (table) => {
    const rows = await q(`SELECT id, name, code FROM ${table} WHERE institute_id = ?`, [req.institute.id]);
    const map = new Map();
    for (const r of rows) {
      if (r.code) map.set("code:" + String(r.code).trim().toUpperCase().padStart(2, "0"), r.id);
      if (r.name) map.set("name:" + String(r.name).trim().toLowerCase(), r.id);
    }
    return map;
  };
  const [courseMap, deptMap, yearMap] = await Promise.all([
    codeMap("courses"), codeMap("departments"), codeMap("academic_years"),
  ]);
  /** Accept either the alphanumeric master code (01, BT, CS…) or the exact master name. */
  const lookup = (map, value) => {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    if (/^[A-Za-z0-9]{1,2}$/.test(raw)) {
      const hit = map.get("code:" + raw.toUpperCase().padStart(2, "0"));
      if (hit) return hit;
    }
    return map.get("name:" + raw.toLowerCase()) || null;
  };

  // 1) Validate + normalise every row up front (no database work here).
  const prepared = [];
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    const error = validate(row);
    if (error) {
      results.push({ row: rowOffset + index + 2, member_code: row?.member_code || "", error });
      continue;
    }
    const code = String(row.member_code).trim();
    if (seen.has(code)) {
      // The same code twice in one chunk — treat the later one like a duplicate.
      duplicates += 1;
      if (duplicateMode === "skip") { skipped += 1; continue; }
    }
    seen.add(code);
    prepared.push({
      rowNumber: rowOffset + index + 2,
      code,
      values: {
        full_name: String(row.full_name).trim(),
        course_id: lookup(courseMap, row.course_code ?? row.course) || clean(d.course_id),
        department_id: lookup(deptMap, row.department_code ?? row.department) || clean(d.department_id),
        academic_year_id:
          lookup(yearMap, row.academic_year_code ?? row.academic_year) || clean(d.academic_year_id),
        gender: row.gender || d.gender || "Other",
        designation: clean(row.designation) || clean(d.designation) || "Student",
        mobile: clean(String(row.mobile ?? "").trim()),
        email: clean(String(row.email ?? "").trim()),
        rfid_uid: clean(row.rfid_uid),
        valid_from: normalizeDate(row.valid_from) || normalizeDate(d.valid_from) || today(),
        valid_to: normalizeDate(row.valid_to) || normalizeDate(d.valid_to) || plusYear(),
        status: row.status || d.status || "Active",
        consent_given: (row.consent_given ?? d.consent_given) ? 1 : 0,
      },
    });
  }

  const photoUrl = clean(d.photo_url);
  const COLUMNS = ["id", "institute_id", "member_code", "full_name", "course_id", "department_id",
    "academic_year_id", "gender", "designation", "mobile", "email", "photo_url", "rfid_uid",
    "valid_from", "valid_to", "status", "source", "consent_given", "import_batch_id"];

  const tuple = (item) => {
    const v = item.values;
    return [uuid(), req.institute.id, item.code, v.full_name, v.course_id, v.department_id,
      v.academic_year_id, v.gender, v.designation, v.mobile, v.email, photoUrl, v.rfid_uid,
      v.valid_from, v.valid_to, v.status, "excel_import", v.consent_given, batchId];
  };

  const INSERT_SQL = `INSERT INTO members (${COLUMNS.join(", ")}) VALUES ?`;
  // Overwrite mode: same statement, but existing (institute_id, member_code) rows are updated.
  const UPSERT_SQL = `${INSERT_SQL}
    ON DUPLICATE KEY UPDATE
      full_name = VALUES(full_name), course_id = VALUES(course_id),
      department_id = VALUES(department_id), academic_year_id = VALUES(academic_year_id),
      gender = VALUES(gender), designation = VALUES(designation),
      mobile = VALUES(mobile), email = VALUES(email), rfid_uid = VALUES(rfid_uid),
      valid_from = VALUES(valid_from), valid_to = VALUES(valid_to),
      status = VALUES(status), consent_given = VALUES(consent_given)`;

  if (prepared.length) {
    // 2) One lookup for the whole chunk instead of one SELECT per row.
    const existingRows = await pool.query(
      "SELECT member_code FROM members WHERE institute_id = ? AND member_code IN (?)",
      [req.institute.id, prepared.map((p) => p.code)],
    ).then(([r]) => r);
    const existing = new Set(existingRows.map((r) => String(r.member_code)));

    const fresh = [];
    const dupes = [];
    for (const item of prepared) {
      if (existing.has(item.code)) {
        duplicates += 1;
        if (duplicateMode === "skip") { skipped += 1; continue; }
        dupes.push(item);
      } else {
        fresh.push(item);
      }
    }

    // 3) Write the whole chunk in one transaction with multi-row statements.
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      if (fresh.length) await conn.query(INSERT_SQL, [fresh.map(tuple)]);
      if (dupes.length) await conn.query(UPSERT_SQL, [dupes.map(tuple)]);
      await conn.commit();
      created += fresh.length;
      updated += dupes.length;
    } catch (batchError) {
      // A bad row (e.g. duplicate RFID) fails the whole batch — replay row by row
      // so the import screen can still point at the exact rows that need fixing.
      try { await conn.rollback(); } catch { /* connection already reset */ }
      for (const item of [...fresh, ...dupes]) {
        try {
          await conn.query(existing.has(item.code) ? UPSERT_SQL : INSERT_SQL, [[tuple(item)]]);
          if (existing.has(item.code)) updated += 1; else created += 1;
        } catch (e) {
          results.push({
            row: item.rowNumber, member_code: item.code,
            error: e.code === "ER_DUP_ENTRY" ? "Duplicate RFID card UID" : (e.message || batchError.message),
          });
        }
      }
    } finally {
      conn.release();
    }
  }


  // One history row per file — each chunk adds its own counts to it.
  await q(
    `INSERT INTO bulk_import_logs (id, institute_id, admin_id, admin_email, file_name, total_rows,
       success_count, error_count, duplicate_count, updated_count, skipped_count)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       total_rows = total_rows + VALUES(total_rows),
       success_count = success_count + VALUES(success_count),
       error_count = error_count + VALUES(error_count),
       duplicate_count = duplicate_count + VALUES(duplicate_count),
       updated_count = updated_count + VALUES(updated_count),
       skipped_count = skipped_count + VALUES(skipped_count)`,
    [batchId, req.institute.id, req.user.id, req.user.email, fileName, rows.length,
     created, results.length, duplicates, updated, skipped],
  );
  if (isLast) {
    await logAudit(req, req.institute.id, "member.bulk_import", "members", batchId, {
      fileName, duplicateMode,
    });
  }
  res.json({
    batch_id: batchId, total: rows.length, success: created, imported: created,
    updated, skipped, duplicates, failed: results.length, errors: results,
  });
});


/**
 * Bulk delete members by id. Permanent — scan history and palm templates cascade away.
 */
router.post("/bulk-delete", withInstitute(), requireModule("members"), requireWrite, async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: "Select at least one member" });
  const placeholders = ids.map(() => "?").join(",");
  const targets = await q(
    `SELECT id, member_code FROM members WHERE institute_id = ? AND id IN (${placeholders})`,
    [req.institute.id, ...ids],
  );
  if (!targets.length) return res.json({ deleted: 0 });
  const out = await q(
    `DELETE FROM members WHERE institute_id = ? AND id IN (${targets.map(() => "?").join(",")})`,
    [req.institute.id, ...targets.map((t) => t.id)],
  );
  for (const t of targets) await deletePhoto(req.institute, t.member_code).catch(() => {});
  await logAudit(req, req.institute.id, "member.bulk_delete", "members", null, {
    count: out.affectedRows, codes: targets.map((t) => t.member_code).slice(0, 50),
  });
  res.json({ deleted: out.affectedRows });
});

/**
 * Delete every member created by one CSV import batch (undo a wrong upload).
 * Members updated by an overwrite import are NOT removed — only rows this batch created.
 */
router.delete("/import/:batchId", withInstitute(), requireModule("members"), requireWrite, requireBulk, async (req, res) => {
  const log = await one(
    "SELECT * FROM bulk_import_logs WHERE id = ? AND institute_id = ?",
    [req.params.batchId, req.institute.id],
  );
  if (!log) return res.status(404).json({ error: "Import batch not found" });
  const targets = await q(
    "SELECT id, member_code FROM members WHERE institute_id = ? AND import_batch_id = ?",
    [req.institute.id, log.id],
  );
  const out = await q(
    "DELETE FROM members WHERE institute_id = ? AND import_batch_id = ?",
    [req.institute.id, log.id],
  );
  for (const t of targets) await deletePhoto(req.institute, t.member_code).catch(() => {});
  await q("DELETE FROM bulk_import_logs WHERE id = ? AND institute_id = ?", [log.id, req.institute.id]);
  await logAudit(req, req.institute.id, "member.import_delete", "members", log.id, {
    fileName: log.file_name, deleted: out.affectedRows,
  });
  res.json({ deleted: out.affectedRows, file_name: log.file_name });
});


/** Upload one photo (base64) and attach it to the member with that code. */
router.post("/photo", withInstitute(), requireModule("members"), requireWrite, async (req, res) => {
  const code = String(req.body?.member_code || "").trim();
  if (!code) return res.status(400).json({ error: "Member code is required" });
  let url;
  try {
    url = await savePhoto(req.institute, code, req.body?.photo_data);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  await q("UPDATE members SET photo_url = ? WHERE member_code = ? AND institute_id = ?", [url, code, req.institute.id]);
  res.json({ url });
});

/**
 * Bulk photo upload: each file is named <member_code>.jpg. Photos are written to
 * public/photos/<university>/ and linked to the matching member record.
 */
router.post("/photos/bulk", withInstitute(), requireModule("members"), requireWrite, requireBulk, async (req, res) => {
  const files = Array.isArray(req.body?.files) ? req.body.files : [];
  const results = { saved: 0, linked: 0, unmatched: [], errors: [] };
  for (const f of files) {
    const code = String(f?.member_code || "").trim();
    if (!code) continue;
    try {
      const url = await savePhoto(req.institute, code, f.photo_data);
      results.saved += 1;
      const out = await q("UPDATE members SET photo_url = ? WHERE member_code = ? AND institute_id = ?",
        [url, code, req.institute.id]);
      if (out.affectedRows) results.linked += 1;
      else results.unmatched.push(code);
    } catch (e) {
      results.errors.push({ member_code: code, error: e.message });
    }
  }
  await logAudit(req, req.institute.id, "member.photo_bulk", "members", null, {
    saved: results.saved, linked: results.linked, unmatched: results.unmatched.length,
  });
  res.json(results);
});

/** Remove the stored photo of a member. */
router.delete("/:id/photo", withInstitute(), requireModule("members"), requireWrite, async (req, res) => {
  const member = await one("SELECT * FROM members WHERE id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  if (!member) return res.status(404).json({ error: "Member not found" });
  await deletePhoto(req.institute, member.member_code);
  await q("UPDATE members SET photo_url = NULL WHERE id = ?", [member.id]);
  res.json({ ok: true });
});

/** Store a palm feature template captured by the C++ bridge / enrolment tool. */
router.post("/:id/palm", withInstitute(), requireModule("members"), requireWrite, async (req, res) => {
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

router.delete("/:id/palm", withInstitute(), requireModule("members"), requireWrite, async (req, res) => {
  await q("DELETE FROM palm_templates WHERE member_id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  await logAudit(req, req.institute.id, "member.palm_clear", "palm_templates", req.params.id, null);
  res.json({ ok: true });
});

export default router;
