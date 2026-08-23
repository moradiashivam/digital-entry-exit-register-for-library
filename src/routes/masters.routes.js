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
    q("SELECT id, name FROM courses WHERE institute_id = ? ORDER BY name", [req.institute.id]),
    q("SELECT id, name FROM departments WHERE institute_id = ? ORDER BY name", [req.institute.id]),
    q("SELECT id, name FROM academic_years WHERE institute_id = ? ORDER BY name", [req.institute.id]),
  ]);
  res.json({ courses, departments, years });
});

router.post("/:kind", withInstitute(), requireModule("master_data"), requireWrite, async (req, res) => {
  const table = TABLES[req.params.kind];
  if (!table) return res.status(404).json({ error: "Unknown list" });
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Enter a name" });
  const id = uuid();
  try {
    await q(`INSERT INTO ${table} (id, institute_id, name) VALUES (?, ?, ?)`, [id, req.institute.id, name]);
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "That entry already exists" });
    throw e;
  }
  await logAudit(req, req.institute.id, `${req.params.kind}.create`, table, id, { name });
  res.status(201).json({ id, name });
});

router.delete("/:kind/:id", withInstitute(), requireModule("master_data"), requireWrite, async (req, res) => {
  const table = TABLES[req.params.kind];
  if (!table) return res.status(404).json({ error: "Unknown list" });
  await q(`DELETE FROM ${table} WHERE id = ? AND institute_id = ?`, [req.params.id, req.institute.id]);
  await logAudit(req, req.institute.id, `${req.params.kind}.delete`, table, req.params.id, null);
  res.json({ ok: true });
});

export default router;
