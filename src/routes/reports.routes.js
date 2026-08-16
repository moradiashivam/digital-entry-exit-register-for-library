import { Router } from "express";
import { q } from "../db.js";
import { requireAuth, withInstitute, canViewReports, isStaff } from "../auth.js";

const router = Router();
router.use(requireAuth);

/** Live occupancy, today's numbers, breakdowns and the 14-day trend. */
router.get("/dashboard", withInstitute(canViewReports), async (req, res) => {
  const id = req.institute.id;
  const [[totals], windowRows, trend, recent] = await Promise.all([
    q(`SELECT COUNT(*) AS total,
              SUM(status = 'Active') AS active,
              SUM(valid_to < CURDATE()) AS expired
       FROM members WHERE institute_id = ?`, [id]),
    // Two-day window so people who entered before midnight still count as inside.
    q(`SELECT l.member_id, l.action, l.method, l.occurred_at,
              HOUR(l.occurred_at) AS log_hour,
              (DATE(l.occurred_at) = CURDATE()) AS is_today,
              TIMESTAMPDIFF(MINUTE, l.occurred_at, NOW()) AS mins_ago,
              m.full_name, m.member_code, m.gender, m.photo_url,
              d.name AS department, c.name AS course
       FROM entry_exit_logs l
       JOIN members m ON m.id = l.member_id
       LEFT JOIN departments d ON d.id = m.department_id
       LEFT JOIN courses c ON c.id = m.course_id
       WHERE l.institute_id = ? AND l.occurred_at >= DATE_SUB(NOW(), INTERVAL 48 HOUR)
       ORDER BY l.occurred_at ASC`, [id]),
    q(`SELECT DATE(occurred_at) AS day,
              SUM(action = 'Entry') AS entries, SUM(action = 'Exit') AS exits
       FROM entry_exit_logs
       WHERE institute_id = ? AND occurred_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
       GROUP BY DATE(occurred_at) ORDER BY day`, [id]),
    q(`SELECT l.id, l.action, l.method, l.occurred_at, m.full_name, m.member_code
       FROM entry_exit_logs l JOIN members m ON m.id = l.member_id
       WHERE l.institute_id = ? ORDER BY l.occurred_at DESC LIMIT 10`, [id]),
  ]);

  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, entries: 0, exits: 0 }));
  const gender = {};
  const byDepartment = {};
  const byCourse = {};
  const openVisits = new Map();
  const durations = [];
  let entries = 0;
  let exits = 0;

  for (const r of windowRows) {
    const today = Number(r.is_today) === 1;
    const hour = Math.min(23, Math.max(0, Number(r.log_hour) || 0));
    if (r.action === "Entry") {
      if (today) {
        entries += 1;
        hourly[hour].entries += 1;
        gender[r.gender || "Other"] = (gender[r.gender || "Other"] || 0) + 1;
        const dept = r.department || "Unassigned";
        const course = r.course || "Unassigned";
        byDepartment[dept] = (byDepartment[dept] || 0) + 1;
        byCourse[course] = (byCourse[course] || 0) + 1;
      }
      openVisits.set(r.member_id, { ...r, entry_at: r.occurred_at, mins_ago: Number(r.mins_ago) || 0 });
    } else {
      if (today) {
        exits += 1;
        hourly[hour].exits += 1;
      }
      const open = openVisits.get(r.member_id);
      if (open) {
        if (today) durations.push(Math.max(0, open.mins_ago - (Number(r.mins_ago) || 0)));
        openVisits.delete(r.member_id);
      }
    }
  }

  const inside = [...openVisits.values()].map((v) => ({
    member_id: v.member_id,
    full_name: v.full_name,
    member_code: v.member_code,
    department: v.department,
    course: v.course,
    photo_url: v.photo_url,
    entry_at: v.entry_at,
    minutes: Math.max(0, v.mins_ago),
  })).sort((a, b) => b.minutes - a.minutes);

  const busiest = hourly.reduce((best, h) => (h.entries > (best?.entries ?? -1) ? h : best), null);
  const toList = (obj) => Object.entries(obj).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

  res.json({
    institute: { name: req.institute.name },
    members: {
      total: Number(totals.total || 0),
      active: Number(totals.active || 0),
      expired: Number(totals.expired || 0),
    },
    today: {
      entries,
      exits,
      inside: inside.length,
      avg_minutes: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
      peak_hour: busiest && busiest.entries > 0 ? busiest.hour : null,
      peak_entries: busiest ? busiest.entries : 0,
    },
    hourly,
    inside,
    gender: toList(gender),
    departments: toList(byDepartment),
    courses: toList(byCourse),
    trend: trend.map((t) => ({ day: String(t.day).slice(0, 10), entries: Number(t.entries), exits: Number(t.exits) })),
    recent,
  });
});

/** Entry/exit register with filters. */
router.get("/logs", withInstitute(canViewReports), async (req, res) => {
  const params = [req.institute.id];
  let sql = `
    SELECT l.id, l.action, l.method, l.device_id, l.occurred_at, l.matched_confidence,
           m.member_code, m.full_name, c.name AS course, d.name AS department
    FROM entry_exit_logs l
    JOIN members m ON m.id = l.member_id
    LEFT JOIN courses c ON c.id = m.course_id
    LEFT JOIN departments d ON d.id = m.department_id
    WHERE l.institute_id = ?`;
  if (req.query.from) { sql += " AND l.occurred_at >= ?"; params.push(`${req.query.from} 00:00:00`); }
  if (req.query.to) { sql += " AND l.occurred_at <= ?"; params.push(`${req.query.to} 23:59:59`); }
  if (req.query.action) { sql += " AND l.action = ?"; params.push(req.query.action); }
  if (req.query.method) { sql += " AND l.method = ?"; params.push(req.query.method); }
  if (req.query.search) {
    sql += " AND (m.full_name LIKE ? OR m.member_code LIKE ?)";
    params.push(`%${req.query.search}%`, `%${req.query.search}%`);
  }
  sql += " ORDER BY l.occurred_at DESC LIMIT 5000";
  res.json(await q(sql, params));
});

router.get("/failed", withInstitute(isStaff), async (req, res) => {
  res.json(await q(
    `SELECT * FROM failed_scan_logs WHERE institute_id = ? ORDER BY occurred_at DESC LIMIT 500`,
    [req.institute.id],
  ));
});

router.get("/audit", withInstitute(isStaff), async (req, res) => {
  res.json(await q(
    `SELECT * FROM audit_logs WHERE institute_id = ? ORDER BY created_at DESC LIMIT 500`,
    [req.institute.id],
  ));
});

router.get("/imports", withInstitute(isStaff), async (req, res) => {
  res.json(await q(
    `SELECT * FROM bulk_import_logs WHERE institute_id = ? ORDER BY created_at DESC LIMIT 200`,
    [req.institute.id],
  ));
});

export default router;
