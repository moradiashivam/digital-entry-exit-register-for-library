/**
 * Time-zone helpers.
 *
 * MySQL DATETIME columns hold the *server's* wall-clock time (no zone).
 * The admin console shows times in the zone each university picks in
 * Settings → Kiosk branding, so we convert: server wall clock → instant →
 * university zone.
 */

/** IANA zone the Node/MySQL host runs in. */
export const serverTimezone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const partsIn = (date, tz) => {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return p;
};

/** Offset (ms) of `tz` at the given instant. */
const offsetAt = (ts, tz) => {
  const p = partsIn(new Date(ts), tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - ts;
};

/** Turn "YYYY-MM-DD HH:MM:SS" wall clock in `tz` into a real Date. */
export function wallClockToDate(value, tz = serverTimezone()) {
  if (value instanceof Date) return value;
  const m = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) {
    const d = new Date(String(value));
    return isNaN(d.getTime()) ? null : d;
  }
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  let ts = guess - offsetAt(guess, tz);
  ts = guess - offsetAt(ts, tz); // second pass handles DST boundaries
  return new Date(ts);
}

/** Calendar parts of an instant, rendered in `tz`. */
export function zoneParts(date, tz) {
  const p = partsIn(date, tz);
  return {
    year: p.year,
    month: p.month,
    day: p.day,
    hour: p.hour % 24,
    minute: p.minute,
    dayKey: `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`,
  };
}

/** Today's date key (YYYY-MM-DD) in `tz`. */
export const todayKey = (tz) => zoneParts(new Date(), tz).dayKey;
