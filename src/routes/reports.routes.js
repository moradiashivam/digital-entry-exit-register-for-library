import { Router } from "express";
import { q, one, localDateTime } from "../db.js";
import { requireAuth, withInstitute, canViewReports, isStaff } from "../auth.js";
import { requireModule, requireExport, kioskScope } from "../access.js";
import { serverTimezone, wallClockToDate, zoneParts, todayKey } from "../tz.js";
import {
  getVisitDetailReport,
  getStudentWiseTotalTimeReport,
  getCourseWiseSummaryReport,
  getDesignationWiseSummaryReport,
  getLocationWiseReport,
  getDailyFootfallReport,
  getCurrentlyInsideReport,
  getAbsenteeReport,
  listLocations,
  listDesignations,
  getVisitFlowSankey,
  TIME_PERIODS,
} from "../reports.service.js";

const router = Router();
router.use(requireAuth);

/** Live occupancy, today's numbers, breakdowns and the 14-day trend. */
/**
 * Devices the dashboard should count: the caller's allowed kiosks, narrowed
 * further by the library / kiosk / location filter chosen on screen.
 */
async function dashboardDevices(req) {
  const allowed = req.access?.kiosks ?? null; // null = every kiosk
  const wanted = [];
  if (req.query.sublibrary_id) {
    const rows = await q(
      "SELECT device_id FROM kiosk_devices WHERE institute_id = ? AND sublibrary_id = ?",
      [req.institute.id, req.query.sublibrary_id],
    );
    wanted.push(rows.map((r) => r.device_id));
  }
  if (req.query.location) {
    const rows = await q(
      "SELECT device_id FROM kiosk_devices WHERE institute_id = ? AND location = ?",
      [req.institute.id, req.query.location],
    );
    wanted.push(rows.map((r) => r.device_id));
  }
  if (req.query.device_id) wanted.push([String(req.query.device_id)]);
  if (allowed) wanted.push(allowed);
  if (!wanted.length) return null;
  return wanted.reduce((a, b) => a.filter((d) => b.includes(d)));
}

const deviceClause = (devices, column) => {
  if (devices === null) return { sql: "", params: [] };
  if (!devices.length) return { sql: " AND 1 = 0", params: [] };
  return { sql: ` AND ${column} IN (${devices.map(() => "?").join(",")})`, params: [...devices] };
};

/** Libraries, kiosks and locations the caller may filter the dashboard by. */
router.get("/filters", withInstitute(canViewReports), async (req, res) => {
  const scope = kioskScope(req.access, "k.device_id");
  const kiosks = await q(
    `SELECT k.id, k.device_id, k.name, k.location, k.sublibrary_id, s.name AS sublibrary
     FROM kiosk_devices k LEFT JOIN sublibraries s ON s.id = k.sublibrary_id
     WHERE k.institute_id = ?${scope.sql} ORDER BY k.name`,
    [req.institute.id, ...scope.params],
  );
  const seen = new Map();
  for (const k of kiosks) if (k.sublibrary_id) seen.set(k.sublibrary_id, k.sublibrary);
  res.json({
    kiosks,
    sublibraries: [...seen].map(([id, name]) => ({ id, name })),
    locations: [...new Set(kiosks.map((k) => k.location).filter(Boolean))],
  });
});

router.get("/dashboard", withInstitute(canViewReports), requireModule("dashboard"), async (req, res) => {
  const id = req.institute.id;
  const devices = await dashboardDevices(req);
  const dev = deviceClause(devices, "l.device_id");
  const devPlain = deviceClause(devices, "device_id");
  // Times follow the computer system clock of the host running this app.
  const tz = serverTimezone();
  const today_key = todayKey(tz);
  const now = new Date();
  const nowText = localDateTime(now);
  const windowStart = localDateTime(new Date(now.getTime() - 48 * 60 * 60 * 1000));
  const trendStart = new Date(now);
  trendStart.setDate(trendStart.getDate() - 13);
  trendStart.setHours(0, 0, 0, 0);
  const trendStartText = localDateTime(trendStart);

  const [[totals], statusMix, windowRows, trend, recent] = await Promise.all([

    q(`SELECT COUNT(*) AS total,
              SUM(status = 'Active') AS active,
              SUM(valid_to < CURDATE()) AS expired
       FROM members WHERE institute_id = ?`, [id]),
    q(`SELECT status AS name, COUNT(*) AS count FROM members
       WHERE institute_id = ? GROUP BY status ORDER BY count DESC`, [id]),
    // Two-day window so people who entered before midnight still count as inside.
    q(`SELECT l.member_id, l.action, l.method, l.occurred_at,
              HOUR(l.occurred_at) AS log_hour,
               (DATE(l.occurred_at) = ?) AS is_today,
               TIMESTAMPDIFF(MINUTE, l.occurred_at, ?) AS mins_ago,
              m.full_name, m.member_code, m.gender, m.photo_url,
              d.name AS department, c.name AS course
       FROM entry_exit_logs l
       JOIN members m ON m.id = l.member_id
       LEFT JOIN departments d ON d.id = m.department_id
       LEFT JOIN courses c ON c.id = m.course_id
       WHERE l.institute_id = ? AND l.occurred_at >= ?${dev.sql}
       ORDER BY l.occurred_at ASC`, [today_key, nowText, id, windowStart, ...dev.params]),
    q(`SELECT DATE(occurred_at) AS day,
              SUM(action = 'Entry') AS entries, SUM(action = 'Exit') AS exits
       FROM entry_exit_logs
        WHERE institute_id = ? AND occurred_at >= ?${devPlain.sql}
        GROUP BY DATE(occurred_at) ORDER BY day`, [id, trendStartText, ...devPlain.params]),
    q(`SELECT l.id, l.action, l.method, l.occurred_at, m.full_name, m.member_code
       FROM entry_exit_logs l JOIN members m ON m.id = l.member_id
       WHERE l.institute_id = ?${dev.sql} ORDER BY l.occurred_at DESC LIMIT 10`, [id, ...dev.params]),
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
    // Bucket by the university's own clock, not the database server's.
    const at = wallClockToDate(r.occurred_at);
    const parts = at ? zoneParts(at, tz) : null;
    const today = parts ? parts.dayKey === today_key : Number(r.is_today) === 1;
    const hour = Math.min(23, Math.max(0, parts ? parts.hour : Number(r.log_hour) || 0));

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
    memberMix: statusMix.map((r) => ({ name: r.name, count: Number(r.count) })),
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
router.get("/logs", withInstitute(canViewReports), requireModule("entry_exit"), requireExport, async (req, res) => {
  const params = [req.institute.id];
  let sql = `
    SELECT l.id, l.action, l.method, l.device_id, l.occurred_at, l.matched_confidence,
           m.member_code, m.full_name, c.name AS course, d.name AS department
    FROM entry_exit_logs l
    JOIN members m ON m.id = l.member_id
    LEFT JOIN courses c ON c.id = m.course_id
    LEFT JOIN departments d ON d.id = m.department_id
    WHERE l.institute_id = ?`;
  const scope = kioskScope(req.access, "l.device_id");
  sql += scope.sql;
  params.push(...scope.params);
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

router.get("/audit", withInstitute(isStaff), requireModule("audit"), async (req, res) => {
  res.json(await q(
    `SELECT * FROM audit_logs WHERE institute_id = ? ORDER BY created_at DESC LIMIT 500`,
    [req.institute.id],
  ));
});

router.get("/imports", withInstitute(isStaff), async (req, res) => {
  res.json(await q(
    `SELECT l.*, (SELECT COUNT(*) FROM members m WHERE m.import_batch_id = l.id) AS members_remaining
     FROM bulk_import_logs l WHERE l.institute_id = ? ORDER BY l.created_at DESC LIMIT 200`,
    [req.institute.id],
  ));
});

/* ------------------------------------------------------------------ *
 * Reports section (University Admin panel).
 * All timestamps are the computer's local wall clock (e.g. IST) — see
 * src/reports.service.js for the time-zone and duration policy.
 * Every endpoint is Admin / report-viewer only via canViewReports.
 * ------------------------------------------------------------------ */

const filtersFrom = (req) => ({
  devices: req.access?.kiosks ?? undefined,
  from: req.query.from || "",
  to: req.query.to || "",
  course_id: req.query.course_id || "",
  department_id: req.query.department_id || "",
  designation: req.query.designation || "",
  location: req.query.location || "",
  search: (req.query.search || "").trim().slice(0, 80),
  sort: req.query.sort || "",
  dir: req.query.dir || "",
  page: req.query.page,
  page_size: req.query.page_size,
  min_visits: req.query.min_visits,
});

router.get("/options", withInstitute(canViewReports), requireModule("reports"), async (req, res) => {
  const [locations, designations] = await Promise.all([
    listLocations(req.institute.id),
    listDesignations(req.institute.id),
  ]);
  res.json({ locations, designations });
});

router.get("/visits", withInstitute(canViewReports), requireModule("reports"), requireExport, async (req, res) => {
  res.json(await getVisitDetailReport(req.institute.id, filtersFrom(req)));
});

router.get("/student-time", withInstitute(canViewReports), requireModule("reports"), requireExport, async (req, res) => {
  res.json(await getStudentWiseTotalTimeReport(req.institute.id, filtersFrom(req)));
});

router.get("/course-summary", withInstitute(canViewReports), requireModule("reports"), requireExport, async (req, res) => {
  res.json(await getCourseWiseSummaryReport(req.institute.id, filtersFrom(req)));
});

router.get("/designation-summary", withInstitute(canViewReports), requireModule("reports"), requireExport, async (req, res) => {
  res.json(await getDesignationWiseSummaryReport(req.institute.id, filtersFrom(req)));
});

router.get("/location-summary", withInstitute(canViewReports), requireModule("reports"), requireExport, async (req, res) => {
  res.json(await getLocationWiseReport(req.institute.id, filtersFrom(req)));
});

router.get("/footfall", withInstitute(canViewReports), requireModule("reports"), requireExport, async (req, res) => {
  res.json(await getDailyFootfallReport(req.institute.id, filtersFrom(req)));
});

/** Student visit analysis — Course → Department → Time period flow. */
router.get("/sankey", withInstitute(canViewReports), requireModule("reports"), async (req, res) => {
  const data = await getVisitFlowSankey(req.institute.id, filtersFrom(req));
  res.json({ ...data, time_periods: TIME_PERIODS.map((p) => p.label) });
});

router.get("/inside", withInstitute(canViewReports), requireModule("reports"), requireExport, async (req, res) => {
  res.json(await getCurrentlyInsideReport(req.institute.id));
});

router.get("/absentees", withInstitute(canViewReports), requireModule("reports"), requireExport, async (req, res) => {
  res.json(await getAbsenteeReport(req.institute.id, filtersFrom(req)));
});

/**
 * Transaction history — the full scan chain of one member (or of every member
 * in a date range), showing which kiosk each entry/exit happened at and which
 * rows were automatic kiosk-to-kiosk transfers.
 */
router.get("/history", withInstitute(canViewReports), requireModule("entry_exit"), requireExport, async (req, res) => {
  const params = [req.institute.id];
  let sql = `
    SELECT l.id, l.action, l.method, l.device_id, l.occurred_at,
           COALESCE(NULLIF(k.name, ''), l.device_id) AS kiosk,
           s.name AS sublibrary, k.location,
           m.member_code, m.full_name
    FROM entry_exit_logs l
    JOIN members m ON m.id = l.member_id
    LEFT JOIN kiosk_devices k ON k.institute_id = l.institute_id AND k.device_id = l.device_id
    LEFT JOIN sublibraries s ON s.id = k.sublibrary_id
    WHERE l.institute_id = ?`;
  const scope = kioskScope(req.access, "l.device_id");
  sql += scope.sql;
  params.push(...scope.params);
  if (req.query.from) { sql += " AND l.occurred_at >= ?"; params.push(`${req.query.from} 00:00:00`); }
  if (req.query.to) { sql += " AND l.occurred_at <= ?"; params.push(`${req.query.to} 23:59:59`); }
  if (req.query.search) {
    sql += " AND (m.member_code = ? OR m.full_name LIKE ?)";
    params.push(String(req.query.search).trim(), `%${String(req.query.search).trim()}%`);
  }
  sql += " ORDER BY l.occurred_at DESC LIMIT 2000";
  const rows = await q(sql, params);
  res.json(rows.map((r) => ({ ...r, transfer: r.method === "Transfer" })));
});

export default router;
