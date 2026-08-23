const TOKEN_KEY = "ler_token";
const INST_KEY = "ler_institute";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(INST_KEY);
};

export const getInstitute = () => localStorage.getItem(INST_KEY);
export const setInstitute = (id) => localStorage.setItem(INST_KEY, id);

/** Fetch wrapper that adds the bearer token and active university. */
export async function api(url, { method = "GET", body, institute } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const inst = institute ?? getInstitute();
  if (inst) headers["x-institute-id"] = inst;

  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // The server answered with HTML (404 page, proxy error, crash page).
      if (res.status === 404) {
        throw new Error(`Endpoint ${url} was not found — restart the application server so new routes load.`);
      }
      throw new Error(`Unexpected response from ${url} (HTTP ${res.status}). Check the server console.`);
    }
  }
  if (res.status === 401 && !url.includes("/auth/login")) {
    clearToken();
    location.href = "/login";
    throw new Error("Session expired");
  }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;

}

export function toast(message, isError = false) {
  const el = document.createElement("div");
  el.className = `toast${isError ? " err" : ""}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Time zone chosen by the university admin (Settings → Kiosk branding). */
const TZ_KEY = "ler_tz";
export const getTimezone = () => localStorage.getItem(TZ_KEY) || "Asia/Kolkata";
export const setTimezone = (tz) => tz && localStorage.setItem(TZ_KEY, tz);

/** Zone the MySQL/Node host runs in — reported by the API. */
const SRV_TZ_KEY = "ler_server_tz";
export const getServerTimezone = () =>
  localStorage.getItem(SRV_TZ_KEY) || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
export const setServerTimezone = (tz) => tz && localStorage.setItem(SRV_TZ_KEY, tz);

/** List offered in the settings dropdown — IANA zone ids. */
export const TIMEZONES = [
  ["Asia/Kolkata", "India Standard Time (IST, UTC+5:30)"],
  ["Asia/Kathmandu", "Nepal (UTC+5:45)"],
  ["Asia/Colombo", "Sri Lanka (UTC+5:30)"],
  ["Asia/Dhaka", "Bangladesh (UTC+6)"],
  ["Asia/Karachi", "Pakistan (UTC+5)"],
  ["Asia/Dubai", "Gulf (UTC+4)"],
  ["Asia/Singapore", "Singapore (UTC+8)"],
  ["Asia/Tokyo", "Japan (UTC+9)"],
  ["Europe/London", "United Kingdom"],
  ["Europe/Paris", "Central Europe"],
  ["Africa/Nairobi", "East Africa (UTC+3)"],
  ["America/New_York", "US Eastern"],
  ["America/Chicago", "US Central"],
  ["America/Los_Angeles", "US Pacific"],
  ["Australia/Sydney", "Australia Eastern"],
  ["UTC", "UTC / GMT"],
];

/**
 * MySQL DATETIME values carry no zone — they are the *server's* wall clock.
 * We convert: server wall clock → real instant → the zone chosen in Settings.
 */
const MYSQL_DT = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/;

const partsIn = (date, tz) => {
  const out = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
};

const offsetAt = (ts, tz) => {
  const p = partsIn(new Date(ts), tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - ts;
};

/**
 * Parse a value coming from the API into a Date on the *computer system* clock.
 * Stored MySQL DATETIME values are shown exactly as recorded — no zone shifting.
 */
const toDate = (v) => {
  if (v instanceof Date) return v;
  const s = String(v ?? "").trim();
  const m = s.match(MYSQL_DT);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

/** Date + time on the computer's system clock. */
export const fmtDate = (v) => {
  if (!v) return "—";
  const d = toDate(v);
  if (!d) return String(v).replace("T", " ").slice(0, 16);
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d).replace(",", "");
};

/** Time only, on the computer's system clock. */
export const fmtTime = (v, opts = {}) => {
  const d = toDate(v);
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, ...opts,
  }).format(d);
};



/** Download an array of objects as a CSV file. */
export function downloadCsv(filename, rows) {
  if (!rows.length) return toast("Nothing to export", true);
  const cols = Object.keys(rows[0]);
  const csv = [
    cols.join(","),
    ...rows.map((r) => cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
