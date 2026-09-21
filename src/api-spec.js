/**
 * The published developer API — one place that describes every endpoint.
 * The admin panel renders its documentation straight from this list, so the
 * docs can never drift away from what the server actually serves.
 */

export const SCOPES = [
  { key: "members.read", label: "Read members" },
  { key: "members.write", label: "Create / update members" },
  { key: "visits.read", label: "Read entry & exit records" },
  { key: "visits.write", label: "Record an entry or exit" },
  { key: "masters.read", label: "Read courses, departments and years" },
  { key: "stats.read", label: "Read occupancy and daily statistics" },
];

export const SCOPE_KEYS = SCOPES.map((s) => s.key);

export const AUTH_NOTE =
  "Send your key in the `X-API-Key` header (or `Authorization: Bearer <key>`). " +
  "Every key belongs to one university, so no university id is needed in the request.";

export const ERRORS = [
  { code: 400, meaning: "The request is missing a field or a value is invalid." },
  { code: 401, meaning: "No key sent, or the key is unknown, revoked or expired." },
  { code: 403, meaning: "The key is valid but does not carry the permission this endpoint needs (or the calling IP is not allowed)." },
  { code: 404, meaning: "The record does not exist in this university." },
  { code: 409, meaning: "The record already exists (duplicate member code or RFID)." },
  { code: 429, meaning: "Too many requests — the key's per-minute limit was reached. Retry after the seconds given in `Retry-After`." },
  { code: 503, meaning: "The database is not reachable. Check the Health page." },
];

/** Every endpoint of /api/v1. `scope: null` means any active key may call it. */
export const ENDPOINTS = [
  {
    method: "GET",
    path: "/api/v1/ping",
    scope: null,
    summary: "Check that the API is reachable and your key works.",
    params: [],
    request: null,
    response: { ok: true, time: "2026-09-14 14:20:11" },
  },
  {
    method: "GET",
    path: "/api/v1/me",
    scope: null,
    summary: "Details of the university the key belongs to, plus the key's permissions and rate limit.",
    params: [],
    request: null,
    response: {
      institute: { id: "0f1c…", name: "Saurashtra University", code: "SU" },
      key: { name: "Campus portal", prefix: "lrk_9f2a41c8", scopes: ["members.read"], rate_limit_per_min: 120 },
    },
  },
  {
    method: "GET",
    path: "/api/v1/members",
    scope: "members.read",
    summary: "List members, newest first. Supports search, filters and paging.",
    params: [
      { name: "q", in: "query", type: "string", required: false, description: "Search in name or member code." },
      { name: "status", in: "query", type: "Active | Inactive | Expired | Blocked", required: false, description: "Filter by membership status." },
      { name: "course_id", in: "query", type: "uuid", required: false, description: "Filter by course." },
      { name: "department_id", in: "query", type: "uuid", required: false, description: "Filter by department." },
      { name: "updated_since", in: "query", type: "YYYY-MM-DD", required: false, description: "Only members changed on or after this date — use it for incremental sync." },
      { name: "page", in: "query", type: "number", required: false, description: "Page number, default 1." },
      { name: "limit", in: "query", type: "number", required: false, description: "Rows per page, 1–200, default 50." },
    ],
    request: null,
    response: {
      page: 1, limit: 50, total: 1240,
      data: [{
        id: "8c1e…", member_code: "SU2024001", full_name: "Ravi Patel", designation: "Student",
        course: "B.Sc.", department: "Physics", academic_year: "2024-25", gender: "Male",
        status: "Active", valid_from: "2024-06-01", valid_to: "2025-05-31",
        mobile: "98•••••210", email: "r•••@example.com", updated_at: "2026-09-01 10:22:04",
      }],
    },
  },
  {
    method: "GET",
    path: "/api/v1/members/{code}",
    scope: "members.read",
    summary: "One member by member code (or by id).",
    params: [{ name: "code", in: "path", type: "string", required: true, description: "Member code, RFID number or record id." }],
    request: null,
    response: { id: "8c1e…", member_code: "SU2024001", full_name: "Ravi Patel", status: "Active", inside: false, last_seen: "2026-09-13 18:02:11" },
  },
  {
    method: "POST",
    path: "/api/v1/members",
    scope: "members.write",
    summary: "Create a member.",
    params: [],
    request: {
      member_code: "SU2024999", full_name: "Nita Shah", designation: "Student",
      gender: "Female", mobile: "9876543210", email: "nita@example.com",
      course_code: "01", department_code: "PH", academic_year_code: "24",
      valid_from: "2026-06-01", valid_to: "2027-05-31", status: "Active",
    },
    response: { id: "c4a2…", member_code: "SU2024999", created: true },
  },
  {
    method: "PATCH",
    path: "/api/v1/members/{code}",
    scope: "members.write",
    summary: "Update the editable fields of a member. Send only the fields you want to change.",
    params: [{ name: "code", in: "path", type: "string", required: true, description: "Member code or record id." }],
    request: { full_name: "Nita R. Shah", status: "Inactive", valid_to: "2026-12-31" },
    response: { id: "c4a2…", updated: true },
  },
  {
    method: "GET",
    path: "/api/v1/masters",
    scope: "masters.read",
    summary: "Courses, departments and academic years with their codes.",
    params: [],
    request: null,
    response: { courses: [{ id: "…", name: "B.Sc.", code: "01" }], departments: [], years: [] },
  },
  {
    method: "GET",
    path: "/api/v1/visits",
    scope: "visits.read",
    summary: "Entry and exit records, newest first.",
    params: [
      { name: "from", in: "query", type: "YYYY-MM-DD", required: false, description: "Start date (inclusive)." },
      { name: "to", in: "query", type: "YYYY-MM-DD", required: false, description: "End date (inclusive)." },
      { name: "member_code", in: "query", type: "string", required: false, description: "Only this member." },
      { name: "action", in: "query", type: "Entry | Exit", required: false, description: "Only entries or only exits." },
      { name: "page", in: "query", type: "number", required: false, description: "Page number, default 1." },
      { name: "limit", in: "query", type: "number", required: false, description: "Rows per page, 1–500, default 100." },
    ],
    request: null,
    response: {
      page: 1, limit: 100, total: 5821,
      data: [{ id: "aa10…", member_code: "SU2024001", full_name: "Ravi Patel", action: "Entry", method: "Face", device_id: "kiosk-1", occurred_at: "2026-09-14 09:31:05" }],
    },
  },
  {
    method: "POST",
    path: "/api/v1/visits",
    scope: "visits.write",
    summary: "Record an entry or exit for a member from your own application or gate hardware.",
    params: [],
    request: { member_code: "SU2024001", action: "Entry", device_id: "gate-north", occurred_at: "2026-09-14 09:31:05" },
    response: { id: "aa10…", member_code: "SU2024001", action: "Entry", occurred_at: "2026-09-14 09:31:05" },
  },
  {
    method: "GET",
    path: "/api/v1/occupancy",
    scope: "stats.read",
    summary: "How many members are inside the library right now.",
    params: [],
    request: null,
    response: { inside: 87, as_of: "2026-09-14 14:20:11" },
  },
  {
    method: "GET",
    path: "/api/v1/stats/daily",
    scope: "stats.read",
    summary: "Entry counts per day for a date range (no personal data).",
    params: [
      { name: "from", in: "query", type: "YYYY-MM-DD", required: false, description: "Start date, default 30 days ago." },
      { name: "to", in: "query", type: "YYYY-MM-DD", required: false, description: "End date, default today." },
    ],
    request: null,
    response: { data: [{ day: "2026-09-13", entries: 412, unique_members: 305 }] },
  },
  {
    method: "GET",
    path: "/api/health/status",
    scope: null,
    summary: "Application, database and API health. Open endpoint — no key needed, used by the public Health page.",
    params: [],
    request: null,
    response: { overall: "healthy", checks: [{ key: "database", label: "Database connection", status: "up" }], checked_at: "2026-09-14 14:20:11" },
  },
];

/** A ready-to-paste curl example for one endpoint. */
export function curlFor(endpoint, base = "https://your-server") {
  const url = `${base}${endpoint.path.replace(/\{(\w+)\}/g, ":$1")}`;
  const lines = [`curl -X ${endpoint.method} "${url}"`, `  -H "X-API-Key: lrk_xxxxxxxx_yyyyyyyy"`];
  if (endpoint.request) {
    lines.push(`  -H "Content-Type: application/json"`);
    lines.push(`  -d '${JSON.stringify(endpoint.request)}'`);
  }
  return lines.join(" \\\n");
}
