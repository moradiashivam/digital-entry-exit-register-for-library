/**
 * “Did You Know?” student insights.
 *
 * Turns the raw Entry/Exit rows of one member into friendly, personal facts that
 * the kiosk shows right after a scan. Nothing new is stored — every number is
 * derived from entry_exit_logs, using the same local wall clock as the reports.
 *
 * Wording rule: we always say “time spent in the library”, never “reading time”.
 */
import { q } from "./db.js";

export const INSIGHT_CATEGORIES = [
  ["time", "Library time facts (total / average / longest session)"],
  ["visits", "Visit counts (total visits, different days, this month)"],
  ["streak", "Visit streaks (current and longest run of days)"],
  ["milestone", "Milestone celebrations (50th visit, 100 hours…)"],
  ["progress", "Personal progress (this month vs last month)"],
  ["stats", "Interesting personal statistics (favourite day, averages)"],
  ["next", "Next achievement / goal"],
];

export const DEFAULT_CATEGORIES = INSIGHT_CATEGORIES.map(([id]) => id).join(",");

const VISIT_MILESTONES = [10, 25, 50, 100, 200, 365, 500, 1000];
const HOUR_MILESTONES = [10, 25, 50, 100, 150, 250, 500, 1000];
const DAY_MILESTONES = [5, 10, 25, 50, 100, 200, 365];
const STREAK_MILESTONES = [3, 7, 14, 21, 30, 60, 100];

const nextOf = (list, value) => list.find((m) => m > value) ?? null;
const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);

/** “2 hours 15 minutes”, “45 minutes”, “5 hours”. */
export function humanDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (h && m) return `${h} hour${h > 1 ? "s" : ""} ${m} minute${m > 1 ? "s" : ""}`;
  if (h) return `${h} hour${h > 1 ? "s" : ""}`;
  return `${m} minute${m === 1 ? "" : "s"}`;
}

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseLocal = (v) => {
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : new Date(v);
};

/** Pair Entry rows with the following Exit row into completed visits. */
function buildVisits(rows) {
  const visits = [];
  const days = new Set();
  let open = null;
  for (const r of rows) {
    const at = parseLocal(r.occurred_at);
    if (r.action === "Entry") {
      if (open) visits.push({ start: open, end: null, seconds: 0 });   // never closed
      open = at;
      days.add(dayKey(at));
    } else if (open) {
      visits.push({ start: open, end: at, seconds: Math.max(0, Math.round((at - open) / 1000)) });
      open = null;
    }
  }
  if (open) visits.push({ start: open, end: null, seconds: 0 });
  return { visits, days };
}

function streaks(dayKeys) {
  const sorted = [...dayKeys].sort();
  let longest = 0, run = 0, prev = null;
  for (const key of sorted) {
    const d = new Date(`${key}T00:00:00`);
    run = prev && (d - prev) / 864e5 === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  // Current streak: counted back from today (or yesterday, if not here yet today).
  const set = new Set(sorted);
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!set.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let current = 0;
  while (set.has(dayKey(cursor))) { current += 1; cursor.setDate(cursor.getDate() - 1); }
  return { current, longest };
}

/**
 * Compute every available insight for one member.
 * Returns objects: { category, icon, text, priority }  (higher priority first).
 */
export async function studentInsights(instituteId, memberId, opts = {}) {
  const categories = new Set(
    String(opts.categories || DEFAULT_CATEGORIES).split(",").map((s) => s.trim()).filter(Boolean),
  );
  const rows = await q(
    `SELECT action, occurred_at FROM entry_exit_logs
     WHERE institute_id = ? AND member_id = ? ORDER BY occurred_at ASC`,
    [instituteId, memberId],
  );
  if (!rows.length) return [];

  const { visits, days } = buildVisits(rows);
  const done = visits.filter((v) => v.end);
  const totalSeconds = done.reduce((s, v) => s + v.seconds, 0);
  const totalHours = totalSeconds / 3600;
  const totalVisits = visits.length;
  const distinctDays = days.size;
  const avgSeconds = done.length ? totalSeconds / done.length : 0;
  const longest = done.reduce((m, v) => Math.max(m, v.seconds), 0);
  const { current: currentStreak, longest: longestStreak } = streaks(days);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const inRange = (v, a, b) => v.start >= a && (!b || v.start < b);
  const thisMonth = visits.filter((v) => inRange(v, monthStart, null));
  const lastMonth = visits.filter((v) => inRange(v, lastMonthStart, monthStart));
  const monthSeconds = thisMonth.reduce((s, v) => s + v.seconds, 0);
  const lastMonthSeconds = lastMonth.reduce((s, v) => s + v.seconds, 0);

  const since21 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 20);
  const daysIn21 = new Set([...days].filter((k) => new Date(`${k}T00:00:00`) >= since21)).size;

  // Semester = the running Jan–Jun / Jul–Dec block.
  const semStart = new Date(now.getFullYear(), now.getMonth() < 6 ? 0 : 6, 1);
  const semesterVisits = visits.filter((v) => v.start >= semStart).length;

  const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const perWeekday = new Array(7).fill(0);
  for (const v of visits) perWeekday[v.start.getDay()] += 1;
  const bestWeekday = perWeekday.indexOf(Math.max(...perWeekday));

  const out = [];
  const add = (category, icon, text, priority = 1) => {
    if (categories.has(category) && text) out.push({ category, icon, text, priority });
  };

  /* 1 — library time */
  if (totalSeconds > 0) {
    add("time", "💡", `You have spent ${humanDuration(totalSeconds)} in the library so far.`, 3);
    if (totalHours >= 10) add("time", "💡", `You have spent more than ${Math.floor(totalHours / 10) * 10} hours in the library.`, 2);
    if (avgSeconds >= 300) add("time", "⏱️", `Your average library session is ${humanDuration(avgSeconds)}.`, 2);
    if (longest >= 900) add("time", "💡", `Your longest library session was ${humanDuration(longest)}.`, 2);
    if (monthSeconds >= 3600) add("time", "💡", `You have completed ${humanDuration(monthSeconds)} of library time this month.`, 2);
  }

  /* 2 — visits */
  add("visits", "💡", `You have completed ${totalVisits} library visit${totalVisits === 1 ? "" : "s"}.`, 3);
  if (distinctDays > 1) add("visits", "💡", `You have visited the library on ${distinctDays} different days.`, 2);
  if (semesterVisits > 1) add("visits", "💡", `You have visited the library ${semesterVisits} times this semester.`, 1);
  if (thisMonth.length > lastMonth.length && lastMonth.length > 0)
    add("visits", "💡", "You have visited the library more often this month than last month.", 2);
  if (daysIn21 >= 5) add("visits", "💡", `You have visited the library on ${daysIn21} of the last 21 days.`, 2);

  /* 3 — streaks */
  if (currentStreak >= 2) add("streak", "🔥", `You are currently on a ${currentStreak}-day library streak.`, 4);
  if (currentStreak >= 3) add("streak", "🔥", `Great job! You have visited the library for ${currentStreak} consecutive days.`, 3);
  if (longestStreak >= 3) add("streak", "🏆", `Your longest library streak is ${longestStreak} consecutive days.`, 2);
  const nextStreak = nextOf(STREAK_MILESTONES, currentStreak);
  if (currentStreak >= 1 && nextStreak) {
    const gap = nextStreak - currentStreak;
    add("streak", gap === 1 ? "🔥" : "🎯",
      gap === 1
        ? `Keep going! Visit tomorrow to complete your ${nextStreak}-day streak.`
        : `Almost there! You are only ${gap} days away from a ${nextStreak}-day streak.`, 3);
  }

  /* 4 — milestones (celebrated the moment they are reached) */
  if (VISIT_MILESTONES.includes(totalVisits))
    add("milestone", "🎉", `Congratulations! You just completed your ${totalVisits}th library visit.`, 10);
  if (DAY_MILESTONES.includes(distinctDays))
    add("milestone", "🌟", `Library achievement unlocked — you have visited on ${distinctDays} different days.`, 9);
  const hourMark = HOUR_MILESTONES.filter((h) => totalHours >= h).pop();
  if (hourMark && totalHours - hourMark < 1)
    add("milestone", "⭐", `Great milestone! You have now spent more than ${hourMark} hours in the library.`, 9);
  if (STREAK_MILESTONES.includes(currentStreak))
    add("milestone", "🏆", `Amazing! You have kept a ${currentStreak}-day library streak.`, 9);

  /* 5 — personal progress */
  const visitChange = pct(thisMonth.length, lastMonth.length);
  if (visitChange != null && visitChange >= 10)
    add("progress", "📈", `Your library visits increased by ${visitChange}% this month compared with last month.`, 3);
  if (monthSeconds > lastMonthSeconds && lastMonthSeconds > 0)
    add("progress", "📈", "Great progress — you have spent more time in the library this month than last month.", 2);
  if (opts.monthly_goal > 0) {
    const share = Math.min(200, Math.round((thisMonth.length / opts.monthly_goal) * 100));
    add("progress", "🎯", `You have already achieved ${share}% of your ${opts.monthly_goal}-visit monthly goal.`, 2);
  }
  if (currentStreak >= 3 && longestStreak >= currentStreak)
    add("progress", "💪", "Keep going — you are building a more consistent library habit.", 1);

  /* 6 — personal statistics */
  if (perWeekday[bestWeekday] >= 3)
    add("stats", "💡", `${weekdayNames[bestWeekday]} is your most frequent library day.`, 2);
  if (done.length >= 3) add("stats", "⏱️", `Your average library session is ${humanDuration(avgSeconds)}.`, 1);
  if (thisMonth.length) add("stats", "💡", `You have made ${thisMonth.length} library visit${thisMonth.length === 1 ? "" : "s"} this month.`, 1);

  /* 7 — next achievement */
  const nextVisit = nextOf(VISIT_MILESTONES, totalVisits);
  if (nextVisit) add("next", "🎯", `Only ${nextVisit - totalVisits} more visits to reach ${nextVisit} library visits.`, 3);
  const nextHour = nextOf(HOUR_MILESTONES, Math.floor(totalHours));
  if (nextHour && totalHours >= 1)
    add("next", "⭐", `You need only ${humanDuration((nextHour - totalHours) * 3600)} more to reach ${nextHour} hours of library time.`, 2);
  const nextDay = nextOf(DAY_MILESTONES, distinctDays);
  if (nextDay) add("next", "🌟", `Visit on ${nextDay - distinctDays} more day${nextDay - distinctDays === 1 ? "" : "s"} to reach ${nextDay} library days.`, 1);

  return out.sort((a, b) => b.priority - a.priority);
}

/**
 * Pick the 1–3 insights shown on the kiosk: milestones first, then a rotating,
 * randomised mix so the same student rarely sees the same card twice.
 */
export function pickInsights(all, count = 2) {
  const take = Math.max(1, Math.min(3, Number(count) || 2));
  const top = all.filter((i) => i.priority >= 9);
  const rest = all.filter((i) => i.priority < 9);
  // Weighted shuffle: higher-priority facts surface more often but not always.
  const shuffled = rest
    .map((i) => ({ i, k: Math.random() * (1 + i.priority) }))
    .sort((a, b) => b.k - a.k)
    .map((x) => x.i);
  const picked = [];
  const seen = new Set();
  for (const item of [...top, ...shuffled]) {
    if (picked.length >= take) break;
    if (seen.has(item.text)) continue;
    seen.add(item.text);
    picked.push(item);
  }
  return picked;
}
