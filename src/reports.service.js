/**
 * Report engine for the University Admin → Reports section.
 *
 * TIME ZONE POLICY
 * ----------------
 * Entry/exit rows are stored as MySQL DATETIME using the wall clock of the
 * computer running the app (the university's own local time, e.g. IST).
 * Every value returned here is that same local wall clock — no UTC shifting
 * is applied anywhere, so what the kiosk showed is exactly what a report shows.
 *
 * DURATIONS
 * ---------
 * Durations are always calculated and summed as raw SECONDS (integers) and only
 * formatted as HH:MM:SS for display. A time-of-day type is never used for totals
 * because a student's total time can exceed 24 hours and would silently wrap.
 *
 * DATA INTEGRITY
 * --------------
 * An Entry with no matching Exit means the member is still inside. Those visits
 * are flagged "In Progress" and excluded from every total-time calculation.
 *
 * All SQL below is parameterised; sort/direction inputs are whitelisted.
 */
import { q, one } from "./db.js";

/** Whitelisted sort columns for the visit-wise detail report. */
const VISIT_SORTS = {
  entry_time: "entry_time",
  exit_time: "exit_time",
  seconds: "seconds",
  name: "name",
  student_code: "student_code",
  course: "course",
  designation: "designation",
  location: "location",
};

const dir = (v) => (String(v).toLowerCase() === "asc" ? "ASC" : "DESC");

/** Build the shared WHERE clause + params for entry rows. */
function baseFilters(instituteId, f = {}) {
  const params = [instituteId];
  let where = "";
  if (f.from) { where += " AND e.occurred_at >= ?"; params.push(`${f.from} 00:00:00`); }
  if (f.to) { where += " AND e.occurred_at <= ?"; params.push(`${f.to} 23:59:59`); }
  if (f.course_id) { where += " AND m.course_id = ?"; params.push(f.course_id); }
  if (f.department_id) { where += " AND m.department_id = ?"; params.push(f.department_id); }
  if (f.designation) { where += " AND m.designation = ?"; params.push(f.designation); }
  if (f.location) { where += " AND e.device_id = ?"; params.push(f.location); }
  // Location-wise access: sublibrary users only ever see their own kiosks.
  if (Array.isArray(f.devices)) {
    if (!f.devices.length) where += " AND 1 = 0";
    else { where += ` AND e.device_id IN (${f.devices.map(() => "?").join(",")})`; params.push(...f.devices); }
  }
  if (f.search) {
    where += " AND (m.full_name LIKE ? OR m.member_code LIKE ?)";
    params.push(`%${f.search}%`, `%${f.search}%`);
  }
  return { where, params };
}

/**
 * Every Entry row paired with the first Exit that follows it for the same member.
 * `seconds` is NULL while the member is still inside.
 */
function visitSql(where) {
  return `
    SELECT v.*, CASE WHEN v.exit_time IS NULL THEN NULL
                     ELSE TIMESTAMPDIFF(SECOND, v.entry_time, v.exit_time) END AS seconds
    FROM (
      SELECT e.id AS log_id, m.id AS student_id, m.member_code AS student_code,
             m.full_name AS name, m.photo_url,
             COALESCE(c.name, 'Unassigned') AS course,
             COALESCE(d.name, 'Unassigned') AS department,
             COALESCE(NULLIF(m.designation, ''), 'Student') AS designation,
             COALESCE(NULLIF(kd.name, ''), NULLIF(e.device_id, ''), 'Main gate') AS location,
             e.method, e.occurred_at AS entry_time,
             (SELECT MIN(x.occurred_at) FROM entry_exit_logs x
               WHERE x.member_id = e.member_id AND x.institute_id = e.institute_id
                 AND x.action = 'Exit' AND x.occurred_at > e.occurred_at) AS exit_time
      FROM entry_exit_logs e
      JOIN members m ON m.id = e.member_id
      LEFT JOIN courses c ON c.id = m.course_id
      LEFT JOIN departments d ON d.id = m.department_id
      LEFT JOIN kiosk_devices kd ON kd.institute_id = e.institute_id AND kd.device_id = e.device_id
      WHERE e.institute_id = ? AND e.action = 'Entry' ${where}

    ) v`;
}

/** Seconds → "HH:MM:SS" (hours may exceed 24). */
export function hhmmss(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const num = (v) => Number(v || 0);

/* 3.1 — Report 1: visit-wise detail (server-side pagination + sorting). */
export async function getVisitDetailReport(instituteId, filters = {}) {
  const { where, params } = baseFilters(instituteId, filters);
  const sort = VISIT_SORTS[filters.sort] || "entry_time";
  const order = dir(filters.dir || "desc");
  const pageSize = Math.min(500, Math.max(10, Number(filters.page_size) || 50));
  const page = Math.max(1, Number(filters.page) || 1);
  const offset = (page - 1) * pageSize;

  const total = await one(`SELECT COUNT(*) AS n FROM (${visitSql(where)}) t`, params);
  const rows = await q(
    `${visitSql(where)} ORDER BY ${sort} ${order}, entry_time DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );

  return {
    page, page_size: pageSize, total: num(total?.n),
    rows: rows.map((r) => ({
      student_id: r.student_code,
      name: r.name,
      course: r.course,
      department: r.department,
      designation: r.designation,
      location: r.location,
      method: r.method,
      entry_time: r.entry_time,
      exit_time: r.exit_time,
      in_progress: r.exit_time === null,
      seconds: r.seconds === null ? null : num(r.seconds),
      time_spent: r.exit_time === null ? "In Progress" : hhmmss(r.seconds),
    })),
  };
}

/* 3.2 — Report 2: student-wise total time. */
export async function getStudentWiseTotalTimeReport(instituteId, filters = {}) {
  const { where, params } = baseFilters(instituteId, filters);
  const minVisits = Math.max(0, Number(filters.min_visits) || 0);
  const rows = await q(
    `SELECT student_code, name, course, department, designation,
            COUNT(*) AS visits,
            SUM(seconds IS NULL) AS open_visits,
            MIN(entry_time) AS first_entry,
            MAX(exit_time) AS last_exit,
            COALESCE(SUM(seconds), 0) AS total_seconds
     FROM (${visitSql(where)}) t
     GROUP BY student_id, student_code, name, course, department, designation
     HAVING visits >= ?
     ORDER BY total_seconds DESC`,
    [...params, minVisits],
  );
  return rows.map((r) => ({
    student_id: r.student_code,
    name: r.name,
    course: r.course,
    department: r.department,
    designation: r.designation,
    visits: num(r.visits),
    open_visits: num(r.open_visits),
    first_entry: r.first_entry,
    last_exit: r.last_exit,
    total_seconds: num(r.total_seconds),
    total_time: hhmmss(r.total_seconds),
  }));
}

/** Shared rollup used by the course-wise and designation-wise summaries. */
async function groupSummary(instituteId, filters, column, label) {
  const { where, params } = baseFilters(instituteId, filters);
  const rows = await q(
    `SELECT ${column} AS grp,
            COUNT(DISTINCT student_id) AS students,
            COUNT(*) AS visits,
            SUM(seconds IS NULL) AS open_visits,
            COALESCE(SUM(seconds), 0) AS total_seconds,
            SUM(seconds IS NOT NULL) AS completed
     FROM (${visitSql(where)}) t
     GROUP BY ${column}
     ORDER BY total_seconds DESC`,
    params,
  );
  return rows.map((r) => {
    const completed = num(r.completed);
    const avg = completed ? num(r.total_seconds) / completed : 0;
    return {
      [label]: r.grp,
      students: num(r.students),
      visits: num(r.visits),
      open_visits: num(r.open_visits),
      total_seconds: num(r.total_seconds),
      total_time: hhmmss(r.total_seconds),
      avg_time: hhmmss(avg),
    };
  });
}

/* 3.3 — Report 3: course-wise summary. */
export const getCourseWiseSummaryReport = (instituteId, filters = {}) =>
  groupSummary(instituteId, filters, "course", "course");

/* 3.7 — Report 7: designation-wise summary. */
export const getDesignationWiseSummaryReport = (instituteId, filters = {}) =>
  groupSummary(instituteId, filters, "designation", "designation");

/* 3.8 — Report 8: location (gate / device) wise summary. */
export const getLocationWiseReport = (instituteId, filters = {}) =>
  groupSummary(instituteId, filters, "location", "location");

/* 3.4 — Report 4: daily attendance / footfall with peak hour. */
export async function getDailyFootfallReport(instituteId, filters = {}) {
  const { where, params } = baseFilters(instituteId, filters);
  const [days, hours] = await Promise.all([
    q(`SELECT DATE(entry_time) AS day, COUNT(DISTINCT student_id) AS unique_students,
              COUNT(*) AS entries
       FROM (${visitSql(where)}) t GROUP BY DATE(entry_time) ORDER BY day ASC`, params),
    q(`SELECT DATE(entry_time) AS day, HOUR(entry_time) AS hour, COUNT(*) AS entries
       FROM (${visitSql(where)}) t GROUP BY DATE(entry_time), HOUR(entry_time)`, params),
  ]);
  const peak = new Map();
  for (const h of hours) {
    const key = String(h.day).slice(0, 10);
    const best = peak.get(key);
    if (!best || num(h.entries) > best.entries) peak.set(key, { hour: num(h.hour), entries: num(h.entries) });
  }
  return days.map((d) => {
    const key = String(d.day).slice(0, 10);
    const p = peak.get(key);
    return {
      date: key,
      unique_students: num(d.unique_students),
      entries: num(d.entries),
      peak_hour: p ? `${String(p.hour).padStart(2, "0")}:00 – ${String((p.hour + 1) % 24).padStart(2, "0")}:00` : "—",
      peak_entries: p ? p.entries : 0,
    };
  });
}

/* 3.5 — Report 5: currently inside / not checked out (live, no date filter). */
export async function getCurrentlyInsideReport(instituteId) {
  const rows = await q(
    `SELECT student_code, name, course, department, designation, location, entry_time,
            TIMESTAMPDIFF(SECOND, entry_time, NOW()) AS seconds
     FROM (${visitSql("")}) t
     WHERE exit_time IS NULL
     ORDER BY entry_time ASC`,
    [instituteId],
  );
  return rows.map((r) => ({
    student_id: r.student_code,
    name: r.name,
    course: r.course,
    department: r.department,
    designation: r.designation,
    location: r.location,
    entry_time: r.entry_time,
    seconds: num(r.seconds),
    duration_so_far: hhmmss(r.seconds),
  }));
}

/* 3.6 — Report 6: absentees / members with no visit in the range. */
export async function getAbsenteeReport(instituteId, filters = {}) {
  const params = [instituteId];
  let where = "";
  if (filters.course_id) { where += " AND m.course_id = ?"; params.push(filters.course_id); }
  if (filters.department_id) { where += " AND m.department_id = ?"; params.push(filters.department_id); }
  if (filters.designation) { where += " AND m.designation = ?"; params.push(filters.designation); }
  if (filters.search) {
    where += " AND (m.full_name LIKE ? OR m.member_code LIKE ?)";
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  const visitParams = [instituteId];
  let visitWhere = "";
  if (filters.from) { visitWhere += " AND l.occurred_at >= ?"; visitParams.push(`${filters.from} 00:00:00`); }
  if (filters.to) { visitWhere += " AND l.occurred_at <= ?"; visitParams.push(`${filters.to} 23:59:59`); }

  const rows = await q(
    `SELECT m.member_code AS student_id, m.full_name AS name,
            COALESCE(c.name, 'Unassigned') AS course,
            COALESCE(d.name, 'Unassigned') AS department,
            COALESCE(NULLIF(m.designation, ''), 'Student') AS designation,
            m.status
     FROM members m
     LEFT JOIN courses c ON c.id = m.course_id
     LEFT JOIN departments d ON d.id = m.department_id
     WHERE m.institute_id = ? AND m.status = 'Active' ${where}
       AND m.id NOT IN (
         SELECT DISTINCT l.member_id FROM entry_exit_logs l
          WHERE l.institute_id = ? ${visitWhere}
       )
     ORDER BY m.full_name ASC`,
    [...params, ...visitParams],
  );
  return rows;
}

/** Distinct gates/devices seen in the log — used to show/hide the location report. */
export async function listLocations(instituteId) {
  const rows = await q(
    `SELECT DISTINCT COALESCE(NULLIF(device_id, ''), 'Main gate') AS location
     FROM entry_exit_logs WHERE institute_id = ? ORDER BY location`,
    [instituteId],
  );
  return rows.map((r) => r.location);
}

/** Distinct designations configured on members. */
export async function listDesignations(instituteId) {
  const rows = await q(
    `SELECT DISTINCT COALESCE(NULLIF(designation, ''), 'Student') AS designation
     FROM members WHERE institute_id = ? ORDER BY designation`,
    [instituteId],
  );
  return rows.map((r) => r.designation);
}
