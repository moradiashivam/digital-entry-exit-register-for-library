import { Router } from "express";
import { pool, q, one } from "../db.js";
import { requireAuth, requireOwner, withInstitute, isStaff, logAudit } from "../auth.js";

const router = Router();
router.use(requireAuth);

/**
 * University-scoped tables, parents first (restore order).
 * Credential / secret tables (users, user_roles, institute_secrets, sip2_settings)
 * are deliberately excluded — a university backup never carries logins.
 */
const TENANT_TABLES = [
  "courses",
  "departments",
  "academic_years",
  "members",
  "palm_templates",
  "entry_exit_logs",
  "failed_scan_logs",
  "bulk_import_logs",
  "audit_logs",
  "kiosk_settings",
];

const FORMAT = "library-register-backup/1";

const columnsOf = async (table) => {
  const rows = await q(
    `SELECT column_name AS c FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((r) => r.c ?? r.COLUMN_NAME);
};

const allTables = async () => {
  const rows = await q(
    `SELECT table_name AS t FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name`,
  );
  return rows.map((r) => r.t ?? r.TABLE_NAME);
};

/** Insert rows in chunks, keeping only columns that still exist in the schema. */
async function insertRows(table, rows, overrides = {}, ignore = false) {
  if (!rows?.length) return 0;
  const cols = await columnsOf(table);
  const use = cols.filter((c) => rows.some((r) => Object.prototype.hasOwnProperty.call(r, c)) || c in overrides);
  if (!use.length) return 0;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const values = chunk.map((r) => use.map((c) => (c in overrides ? overrides[c] : r[c] ?? null)));
    // mysql2 bulk inserts need pool.query (prepared statements cannot take a row set).
    await pool.query(
      `INSERT ${ignore ? "IGNORE " : ""}INTO \`${table}\` (${use.map((c) => `\`${c}\``).join(", ")}) VALUES ?`,
      [values],
    );
    inserted += chunk.length;
  }
  return inserted;
}

// ---------------------------------------------------------------- university

/** Download every record belonging to the signed-in university. */
router.get("/export", withInstitute(isStaff), async (req, res) => {
  const tables = {};
  for (const t of TENANT_TABLES) {
    tables[t] = await q(`SELECT * FROM \`${t}\` WHERE institute_id = ?`, [req.institute.id]);
  }
  await logAudit(req, req.institute.id, "backup.export", "institutes", req.institute.id, {
    counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
  });
  res.json({
    format: FORMAT,
    scope: "institute",
    generated_at: new Date().toISOString(),
    institute: { id: req.institute.id, slug: req.institute.slug, name: req.institute.name },
    tables,
  });
});

/**
 * Restore a university backup into the *current* university.
 * mode = "replace" (wipe then load) or "merge" (add missing rows only).
 */
router.post("/restore", withInstitute(isStaff), async (req, res) => {
  const file = req.body?.backup;
  const mode = req.body?.mode === "merge" ? "merge" : "replace";
  if (!file || file.format !== FORMAT || file.scope !== "institute") {
    return res.status(400).json({ error: "Not a university backup file" });
  }
  const summary = {};
  await pool.query("SET FOREIGN_KEY_CHECKS = 0");
  try {
    if (mode === "replace") {
      for (const t of [...TENANT_TABLES].reverse()) {
        await q(`DELETE FROM \`${t}\` WHERE institute_id = ?`, [req.institute.id]);
      }
    }
    for (const t of TENANT_TABLES) {
      const rows = Array.isArray(file.tables?.[t]) ? file.tables[t] : [];
      summary[t] = await insertRows(t, rows, { institute_id: req.institute.id }, mode === "merge");
    }
  } finally {
    await pool.query("SET FOREIGN_KEY_CHECKS = 1");
  }
  await logAudit(req, req.institute.id, "backup.restore", "institutes", req.institute.id, { mode, summary });
  res.json({ ok: true, mode, summary });
});

// --------------------------------------------------------------------- owner

/** Full master backup of every table in the platform database. */
router.get("/master/export", requireOwner, async (req, res) => {
  const names = await allTables();
  const tables = {};
  for (const t of names) tables[t] = await q(`SELECT * FROM \`${t}\``);
  await logAudit(req, null, "backup.master_export", null, null, {
    tables: names.length,
    rows: Object.values(tables).reduce((n, r) => n + r.length, 0),
  });
  res.json({
    format: FORMAT,
    scope: "master",
    generated_at: new Date().toISOString(),
    database: process.env.DB_NAME || null,
    order: names,
    tables,
  });
});

/** Restore the whole platform database from a master backup. */
router.post("/master/restore", requireOwner, async (req, res) => {
  const file = req.body?.backup;
  if (!file || file.format !== FORMAT || file.scope !== "master") {
    return res.status(400).json({ error: "Not a master backup file" });
  }
  const existing = await allTables();
  const order = (Array.isArray(file.order) ? file.order : Object.keys(file.tables || {}))
    .filter((t) => existing.includes(t));
  const summary = {};
  await pool.query("SET FOREIGN_KEY_CHECKS = 0");
  try {
    for (const t of [...order].reverse()) await pool.query(`DELETE FROM \`${t}\``);
    for (const t of order) summary[t] = await insertRows(t, file.tables[t]);
  } finally {
    await pool.query("SET FOREIGN_KEY_CHECKS = 1");
  }
  const me = await one("SELECT id FROM users WHERE id = ?", [req.user.id]);
  res.json({ ok: true, summary, owner_present: !!me });
});

export default router;
