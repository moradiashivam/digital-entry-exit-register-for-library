import { Router } from "express";
import { q, uuid } from "../db.js";
import { requireAuth, withInstitute, isMember, logAudit } from "../auth.js";
import { requireModule, requireWrite } from "../access.js";

const router = Router();
router.use(requireAuth);

const TABLES = { courses: "courses", departments: "departments", years: "academic_years" };

/** Courses, departments and academic years for the active university. */
router.get("/", withInstitute(isMember), requireModule("master_data"), async (req, res) => {
  const [courses, departments, years] = await Promise.all([
    q("SELECT id, name, code FROM courses WHERE institute_id = ? ORDER BY code, name", [req.institute.id]),
    q("SELECT id, name, code FROM departments WHERE institute_id = ? ORDER BY code, name", [req.institute.id]),
    q("SELECT id, name, code FROM academic_years WHERE institute_id = ? ORDER BY code, name", [req.institute.id]),
  ]);
  res.json({ courses, departments, years });
});

const CODE_RE = /^[A-Za-z0-9]{1,2}$/;

/** First free two-character alphanumeric code inside this university's list.
 *  Tries 01…99 first, then A0…Z9 / AA…ZZ style pairs. */
async function nextCode(table, instituteId) {
  const rows = await q(
    `SELECT code FROM ${table} WHERE institute_id = ? AND code IS NOT NULL AND code <> ''`,
    [instituteId],
  );
  const used = new Set(rows.map((r) => String(r.code).toUpperCase()));
  for (let n = 1; n <= 99; n++) {
    const candidate = String(n).padStart(2, "0");
    if (!used.has(candidate)) return candidate;
  }
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const a of chars) {
    for (const b of chars) {
      const candidate = a + b;
      if (!used.has(candidate)) return candidate;
    }
  }
  return null;
}

router.post("/:kind", withInstitute(), requireModule("master_data"), requireWrite, async (req, res) => {
  const table = TABLES[req.params.kind];
  if (!table) return res.status(404).json({ error: "Unknown list" });
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Enter a name" });

  // Two-digit code used by the bulk import mapper — typed by the admin, or the next free one.
  const raw = String(req.body?.code ?? "").trim();
  let code;
  if (raw) {
    if (!CODE_RE.test(raw)) return res.status(400).json({ error: "Code must be 1–2 letters or digits (e.g. 01, BT, CS)" });
    code = raw.toUpperCase().padStart(2, "0");
  } else {
    code = await nextCode(table, req.institute.id);
    if (!code) return res.status(400).json({ error: "No free codes left in this list" });
  }

  const id = uuid();
  try {
    await q(`INSERT INTO ${table} (id, institute_id, name, code) VALUES (?, ?, ?, ?)`,
      [id, req.institute.id, name, code]);
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "That name or code already exists in this list" });
    }
    throw e;
  }
  await logAudit(req, req.institute.id, `${req.params.kind}.create`, table, id, { name, code });
  res.status(201).json({ id, name, code });
});

/** Change the name or two-digit code of one entry. */
router.put("/:kind/:id", withInstitute(), requireModule("master_data"), requireWrite, async (req, res) => {
  const table = TABLES[req.params.kind];
  if (!table) return res.status(404).json({ error: "Unknown list" });
  const raw = String(req.body?.code ?? "").trim();
  if (!CODE_RE.test(raw)) return res.status(400).json({ error: "Code must be 1–2 letters or digits (e.g. 01, BT, CS)" });
  const code = raw.toUpperCase().padStart(2, "0");
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Enter a name" });
  try {
    await q(`UPDATE ${table} SET name = ?, code = ? WHERE id = ? AND institute_id = ?`,
      [name, code, req.params.id, req.institute.id]);
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "That name or code already exists in this list" });
    }
    throw e;
  }
  await logAudit(req, req.institute.id, `${req.params.kind}.update`, table, req.params.id, { name, code });
  res.json({ id: req.params.id, name, code });
});


router.delete("/:kind/:id", withInstitute(), requireModule("master_data"), requireWrite, async (req, res) => {
  const table = TABLES[req.params.kind];
  if (!table) return res.status(404).json({ error: "Unknown list" });
  await q(`DELETE FROM ${table} WHERE id = ? AND institute_id = ?`, [req.params.id, req.institute.id]);
  await logAudit(req, req.institute.id, `${req.params.kind}.delete`, table, req.params.id, null);
  res.json({ ok: true });
});

export default router;
