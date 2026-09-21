/**
 * /api/v1 — the published developer API.
 *
 * Every request needs an API key issued by a university administrator
 * (Admin panel → API & developers). The key decides which university the
 * request belongs to and which endpoints it may call, so a caller can never
 * reach another university's records and never touches MySQL directly.
 */
import { Router } from "express";
import { q, one, uuid, localDate, localDateTime, plusYear } from "../db.js";
import { apiKeyAuth, requireScope, maskContact } from "../api-keys.js";
import { ENDPOINTS, SCOPES, ERRORS, AUTH_NOTE } from "../api-spec.js";

const router = Router();

/** Machine-readable catalogue — open, so developers can start without a key. */
router.get("/docs", (_req, res) => {
  res.json({ version: "v1", authentication: AUTH_NOTE, scopes: SCOPES, endpoints: ENDPOINTS, errors: ERRORS });
});

router.use(apiKeyAuth);

const page = (req, def = 50, max = 200) => {
  const limit = Math.min(max, Math.max(1, Number(req.query.limit) || def));
  const p = Math.max(1, Number(req.query.page) || 1);
  return { limit, offset: (p - 1) * limit, p };
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/;

/* ------------------------------- basics -------------------------------- */

router.get("/ping", (_req, res) => res.json({ ok: true, time: localDateTime() }));

router.get("/me", (req, res) => {
  res.json({
    institute: { id: req.institute.id, name: req.institute.name, code: req.institute.code ?? null },
    key: {
      name: req.apiKey.name,
      prefix: req.apiKey.key_prefix,
      scopes: req.apiScopes,
      allow_pii: !!req.apiKey.allow_pii,
      rate_limit_per_min: Number(req.apiKey.rate_limit_per_min),
      expires_at: req.apiKey.expires_at ? String(req.apiKey.expires_at).slice(0, 10) : null,
    },
  });
});

/* ------------------------------- members -------------------------------- */

const MEMBER_COLUMNS = `m.id, m.member_code, m.full_name, m.designation, m.gender, m.status,
  m.valid_from, m.valid_to, m.mobile, m.email, m.rfid_uid, m.updated_at, m.created_at,
  c.name AS course, c.code AS course_code,
  d.name AS department, d.code AS department_code,
  y.name AS academic_year, y.code AS academic_year_code`;

const MEMBER_JOINS = `FROM members m
  LEFT JOIN courses c ON c.id = m.course_id
  LEFT JOIN departments d ON d.id = m.department_id
  LEFT JOIN academic_years y ON y.id = m.academic_year_id`;

router.get("/members", requireScope("members.read"), async (req, res) => {
  const where = ["m.institute_id = ?"];
  const args = [req.institute.id];

  const search = String(req.query.q || "").trim();
  if (search) {
    where.push("(m.full_name LIKE ? OR m.member_code LIKE ?)");
    args.push(`%${search}%`, `%${search}%`);
  }
  const status = String(req.query.status || "").trim();
  if (status) {
    if (!["Active", "Inactive", "Expired", "Blocked"].includes(status)) {
      return res.status(400).json({ error: "status must be Active, Inactive, Expired or Blocked" });
    }
    where.push("m.status = ?");
    args.push(status);
  }
  for (const [param, column] of [["course_id", "m.course_id"], ["department_id", "m.department_id"], ["academic_year_id", "m.academic_year_id"]]) {
    const value = String(req.query[param] || "").trim();
    if (value) { where.push(`${column} = ?`); args.push(value); }
  }
  const since = String(req.query.updated_since || "").trim();
  if (since) {
    if (!DATE_RE.test(since)) return res.status(400).json({ error: "updated_since must look like 2026-01-31" });
    where.push("m.updated_at >= ?");
    args.push(`${since} 00:00:00`);
  }

  const clause = where.join(" AND ");
  const { limit, offset, p } = page(req, 50, 200);
  const total = await one(`SELECT COUNT(*) AS n FROM members m WHERE ${clause}`, args);
  const rows = await q(
    `SELECT ${MEMBER_COLUMNS} ${MEMBER_JOINS} WHERE ${clause} ORDER BY m.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    args,
  );
  res.json({
    page: p,
    limit,
    total: Number(total?.n || 0),
    data: rows.map((r) => maskContact(r, req.apiKey.allow_pii)),
  });
});

/** Look a member up by member code, RFID number or record id. */
async function findMember(instituteId, key) {
  return one(
    `SELECT ${MEMBER_COLUMNS} ${MEMBER_JOINS}
      WHERE m.institute_id = ? AND (m.member_code = ? OR m.rfid_uid = ? OR m.id = ?) LIMIT 1`,
    [instituteId, key, key, key],
  );
}

router.get("/members/:code", requireScope("members.read"), async (req, res) => {
  const member = await findMember(req.institute.id, String(req.params.code));
  if (!member) return res.status(404).json({ error: "No member with that code" });
  const last = await one(
    "SELECT action, occurred_at FROM entry_exit_logs WHERE member_id = ? ORDER BY occurred_at DESC LIMIT 1",
    [member.id],
  );
  res.json({
    ...maskContact(member, req.apiKey.allow_pii),
    inside: last?.action === "Entry",
    last_seen: last?.occurred_at ?? null,
  });
}); 

/** Resolve a master-data code (e.g. course "01") to its id. */
async function masterId(table, instituteId, code) {
  if (!code) return null;
  const row = await one(
    `SELECT id FROM ${table} WHERE institute_id = ? AND (code = ? OR name = ?) LIMIT 1`,
    [instituteId, String(code).toUpperCase(), String(code)],
  );
  return row?.id ?? null;
}

router.post("/members", requireScope("members.write"), async (req, res) => {
  const b = req.body || {};
  const code = String(b.member_code || "").trim();
  const name = String(b.full_name || "").trim();
  if (!code || !name) return res.status(400).json({ error: "member_code and full_name are required" });
  if (code.length > 60 || name.length > 200) return res.status(400).json({ error: "member_code or full_name is too long" });

  const gender = ["Male", "Female", "Other"].includes(b.gender) ? b.gender : "Other";
  const status = ["Active", "Inactive", "Expired", "Blocked"].includes(b.status) ? b.status : "Active";
  const mobile = String(b.mobile || "").replace(/\D/g, "").slice(0, 10) || null;
  const email = String(b.email || "").trim().slice(0, 200) || null;
  const validFrom = DATE_RE.test(b.valid_from || "") ? b.valid_from : localDate();
  const validTo = DATE_RE.test(b.valid_to || "") ? b.valid_to : plusYear();

  const id = uuid();
  try {
    await q(
      `INSERT INTO members
        (id, institute_id, member_code, full_name, course_id, department_id, academic_year_id,
         gender, designation, mobile, email, rfid_uid, valid_from, valid_to, status, source, external_ref)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'manual',?)`,
      [
        id, req.institute.id, code, name,
        await masterId("courses", req.institute.id, b.course_code || b.course_id),
        await masterId("departments", req.institute.id, b.department_code || b.department_id),
        await masterId("academic_years", req.institute.id, b.academic_year_code || b.academic_year_id),
        gender, String(b.designation || "Student").slice(0, 60), mobile, email,
        String(b.rfid_uid || "").trim().slice(0, 64) || null,
        validFrom, validTo, status, String(b.external_ref || "").slice(0, 120) || null,
      ],
    );
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "A member with that code or RFID already exists" });
    throw e;
  }
  res.status(201).json({ id, member_code: code, created: true });
});

router.patch("/members/:code", requireScope("members.write"), async (req, res) => {
  const member = await findMember(req.institute.id, String(req.params.code));
  if (!member) return res.status(404).json({ error: "No member with that code" });

  const b = req.body || {};
  const sets = [];
  const args = [];
  const put = (column, value) => { sets.push(`${column} = ?`); args.push(value); };

  if (b.full_name !== undefined) {
    const v = String(b.full_name).trim();
    if (!v) return res.status(400).json({ error: "full_name cannot be empty" });
    put("full_name", v.slice(0, 200));
  }
  if (b.designation !== undefined) put("designation", String(b.designation).slice(0, 60));
  if (b.gender !== undefined) {
    if (!["Male", "Female", "Other"].includes(b.gender)) return res.status(400).json({ error: "gender must be Male, Female or Other" });
    put("gender", b.gender);
  }
  if (b.status !== undefined) {
    if (!["Active", "Inactive", "Expired", "Blocked"].includes(b.status)) return res.status(400).json({ error: "Invalid status" });
    put("status", b.status);
  }
  if (b.mobile !== undefined) put("mobile", String(b.mobile).replace(/\D/g, "").slice(0, 10) || null);
  if (b.email !== undefined) put("email", String(b.email).trim().slice(0, 200) || null);
  if (b.rfid_uid !== undefined) put("rfid_uid", String(b.rfid_uid).trim().slice(0, 64) || null);
  for (const field of ["valid_from", "valid_to"]) {
    if (b[field] !== undefined) {
      if (!DATE_RE.test(b[field])) return res.status(400).json({ error: `${field} must look like 2026-01-31` });
      put(field, b[field]);
    }
  }
  for (const [field, table, column] of [
    ["course_code", "courses", "course_id"],
    ["department_code", "departments", "department_id"],
    ["academic_year_code", "academic_years", "academic_year_id"],
  ]) {
    if (b[field] !== undefined) put(column, await masterId(table, req.institute.id, b[field]));
  }

  if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
  args.push(member.id, req.institute.id);
  try {
    await q(`UPDATE members SET ${sets.join(", ")} WHERE id = ? AND institute_id = ?`, args);
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Another member already uses that RFID" });
    throw e;
  }
  res.json({ id: member.id, updated: true });
});

/* ------------------------------- masters -------------------------------- */

router.get("/masters", requireScope("masters.read"), async (req, res) => {
  const [courses, departments, years] = await Promise.all([
    q("SELECT id, name, code FROM courses WHERE institute_id = ? ORDER BY code, name", [req.institute.id]),
    q("SELECT id, name, code FROM departments WHERE institute_id = ? ORDER BY code, name", [req.institute.id]),
    q("SELECT id, name, code FROM academic_years WHERE institute_id = ? ORDER BY code, name", [req.institute.id]),
  ]);
  res.json({ courses, departments, years });
});

/* -------------------------------- visits -------------------------------- */

router.get("/visits", requireScope("visits.read"), async (req, res) => {
  const where = ["l.institute_id = ?"];
  const args = [req.institute.id];

  for (const [param, op] of [["from", ">="], ["to", "<="]]) {
    const value = String(req.query[param] || "").trim();
    if (!value) continue;
    if (!DATE_RE.test(value)) return res.status(400).json({ error: `${param} must look like 2026-01-31` });
    where.push(`l.occurred_at ${op} ?`);
    args.push(param === "from" ? `${value} 00:00:00` : `${value} 23:59:59`);
  }
  const action = String(req.query.action || "").trim();
  if (action) {
    if (!["Entry", "Exit"].includes(action)) return res.status(400).json({ error: "action must be Entry or Exit" });
    where.push("l.action = ?");
    args.push(action);
  }
  const memberCode = String(req.query.member_code || "").trim();
  if (memberCode) { where.push("m.member_code = ?"); args.push(memberCode); }

  const clause = where.join(" AND ");
  const { limit, offset, p } = page(req, 100, 500);
  const total = await one(
    `SELECT COUNT(*) AS n FROM entry_exit_logs l JOIN members m ON m.id = l.member_id WHERE ${clause}`, args,
  );
  const data = await q(
    `SELECT l.id, m.member_code, m.full_name, l.action, l.method, l.device_id, l.occurred_at
       FROM entry_exit_logs l JOIN members m ON m.id = l.member_id
      WHERE ${clause} ORDER BY l.occurred_at DESC LIMIT ${limit} OFFSET ${offset}`,
    args,
  );
  res.json({ page: p, limit, total: Number(total?.n || 0), data });
});

router.post("/visits", requireScope("visits.write"), async (req, res) => {
  const b = req.body || {};
  const member = await findMember(req.institute.id, String(b.member_code || b.member_id || "").trim());
  if (!member) return res.status(404).json({ error: "No member with that code" });
  if (member.status !== "Active") return res.status(400).json({ error: `This membership is ${String(member.status).toLowerCase()}` });

  let action = b.action;
  if (action !== undefined && !["Entry", "Exit"].includes(action)) {
    return res.status(400).json({ error: "action must be Entry or Exit" });
  }
  if (!action) {
    const last = await one(
      "SELECT action FROM entry_exit_logs WHERE member_id = ? ORDER BY occurred_at DESC LIMIT 1",
      [member.id],
    );
    action = last?.action === "Entry" ? "Exit" : "Entry";
  }
  const at = String(b.occurred_at || "").trim();
  if (at && !DATETIME_RE.test(at)) return res.status(400).json({ error: "occurred_at must look like 2026-01-31 09:30:00" });
  const occurredAt = at ? at.replace("T", " ").slice(0, 19).padEnd(19, ":00".slice(0, 0)) : localDateTime();

  const id = uuid();
  await q(
    `INSERT INTO entry_exit_logs (id, institute_id, member_id, action, method, device_id, occurred_at)
     VALUES (?, ?, ?, ?, 'API', ?, ?)`,
    [id, req.institute.id, member.id, action, String(b.device_id || "api").slice(0, 80), occurredAt],
  );
  res.status(201).json({ id, member_code: member.member_code, action, occurred_at: occurredAt });
});

/* -------------------------------- stats --------------------------------- */

router.get("/occupancy", requireScope("stats.read"), async (req, res) => {
  const row = await one(
    `SELECT COUNT(*) AS inside FROM (
        SELECT l.member_id, SUBSTRING_INDEX(GROUP_CONCAT(l.action ORDER BY l.occurred_at DESC), ',', 1) AS last_action
          FROM entry_exit_logs l
         WHERE l.institute_id = ? AND l.occurred_at >= ?
         GROUP BY l.member_id
      ) t WHERE t.last_action = 'Entry'`,
    [req.institute.id, `${localDate()} 00:00:00`],
  );
  res.json({ inside: Number(row?.inside || 0), as_of: localDateTime() });
});

router.get("/stats/daily", requireScope("stats.read"), async (req, res) => {
  const to = DATE_RE.test(String(req.query.to || "")) ? String(req.query.to) : localDate();
  let from = DATE_RE.test(String(req.query.from || "")) ? String(req.query.from) : null;
  if (!from) {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    from = localDate(d);
  }
  const data = await q(
    `SELECT DATE(occurred_at) AS day, COUNT(*) AS entries, COUNT(DISTINCT member_id) AS unique_members
       FROM entry_exit_logs
      WHERE institute_id = ? AND action = 'Entry' AND occurred_at BETWEEN ? AND ?
      GROUP BY DATE(occurred_at) ORDER BY day`,
    [req.institute.id, `${from} 00:00:00`, `${to} 23:59:59`],
  );
  res.json({ from, to, data });
});

/** Anything else under /api/v1 answers JSON, never an HTML 404 page. */
router.use((_req, res) => res.status(404).json({ error: "Unknown API endpoint — see GET /api/v1/docs" }));

export default router;
