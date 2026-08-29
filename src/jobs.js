import { q } from "./db.js";
import { sendMail, smtpConfigured } from "./mailer.js";
import { runGithubCheckJob } from "./github-update.js";

const RETRY_MS = 30 * 1000;

const connectionProblem = (error) => {
  const code = String(error?.code || error?.cause?.code || "");
  return ["ETIMEDOUT", "ECONNREFUSED", "ECONNRESET", "PROTOCOL_CONNECTION_LOST"].includes(code);
};

let databaseWarningShown = false;

/** Do not start database-backed jobs until MySQL is reachable. */
async function whenDatabaseReady(job) {
  try {
    await q("SELECT 1");
    if (databaseWarningShown) console.log("  scheduler: MySQL connection restored");
    databaseWarningShown = false;
    return await job();
  } catch (error) {
    if (!connectionProblem(error)) throw error;
    if (!databaseWarningShown) {
      console.warn("  scheduler: waiting for MySQL; background jobs will retry automatically");
      databaseWarningShown = true;
    }
    return null;
  }
}

const setting = async (key, fallback) => {
  const rows = await q("SELECT setting_value FROM platform_settings WHERE setting_key = ?", [key]);
  return rows[0]?.setting_value ?? fallback;
};

/**
 * Daily housekeeping:
 *  - suspends universities whose subscription ended more than the grace period ago
 *  - re-activates ones that were renewed
 *  - emails expiry reminders (30 / 15 / 7 / 1 days out) when SMTP is configured
 */
export async function runExpiryJob() {
  const grace = Number(await setting("grace_days", "5")) || 0;

  const expired = await q(
    `SELECT id, name, contact_email, subscription_end FROM institutes
     WHERE status = 'Active' AND subscription_end < DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
    [grace],
  );
  for (const inst of expired) {
    await q("UPDATE institutes SET status = 'Suspended' WHERE id = ?", [inst.id]);
    await q(
      `INSERT INTO subscription_history (id, institute_id, action, old_end_date, changed_by, note)
       VALUES (UUID(), ?, 'auto_suspend', ?, 'system', 'Subscription expired past grace period')`,
      [inst.id, inst.subscription_end],
    );
  }

  const renewed = await q(
    `SELECT id FROM institutes WHERE status = 'Suspended' AND subscription_end >= CURDATE()`,
  );
  for (const inst of renewed) {
    await q("UPDATE institutes SET status = 'Active' WHERE id = ?", [inst.id]);
  }

  let reminders = 0;
  if (await smtpConfigured()) {
    const soon = await q(
      `SELECT name, contact_email, subscription_end,
              DATEDIFF(subscription_end, CURDATE()) AS days_left
       FROM institutes
       WHERE contact_email IS NOT NULL AND contact_email <> ''
         AND DATEDIFF(subscription_end, CURDATE()) IN (30, 15, 7, 1)`,
    );
    for (const inst of soon) {
      try {
        await sendMail({
          to: inst.contact_email,
          subject: `Subscription expires in ${inst.days_left} day(s) — ${inst.name}`,
          text: `Hello ${inst.name},\n\nYour Library Entry & Exit Register subscription ends on ${inst.subscription_end}.\nPlease renew to avoid interruption of your kiosk and admin access.\n\nThank you.`,
        });
        reminders += 1;
      } catch {
        /* delivery problems must never break the job */
      }
    }
  }

  return { suspended: expired.length, reactivated: renewed.length, reminders };
}

/**
 * Auto-exit: anybody still marked inside after the library's closing time for the
 * day they entered gets an Exit row stamped at that closing time (method "Auto").
 */
export async function autoExitInstitute(instituteId) {
  const hours = await q("SELECT * FROM library_hours WHERE institute_id = ?", [instituteId]);
  if (!hours.length) return 0;
  const byDay = new Map(hours.map((h) => [Number(h.weekday), h]));

  // Calendar overrides (holidays / custom timings) win over the weekly rule.
  const special = await q("SELECT * FROM library_special_days WHERE institute_id = ?", [instituteId])
    .catch(() => []);
  const byDate = new Map(special.map((s) => [String(s.day).slice(0, 10), s]));
  const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // Latest log per member — an "Entry" means they are still inside.
  const open = await q(
    `SELECT l.member_id, l.occurred_at
     FROM entry_exit_logs l
     JOIN (SELECT member_id, MAX(occurred_at) AS last_at
           FROM entry_exit_logs WHERE institute_id = ? GROUP BY member_id) x
       ON x.member_id = l.member_id AND x.last_at = l.occurred_at
     WHERE l.institute_id = ? AND l.action = 'Entry'`,
    [instituteId, instituteId],
  );

  let closed = 0;
  const now = new Date();
  for (const row of open) {
    const entry = new Date(row.occurred_at);
    if (Number.isNaN(entry.getTime())) continue;
    const rule = byDate.get(dateKey(entry)) || byDay.get(entry.getDay());
    if (!rule || !Number(rule.auto_exit) || Number(rule.is_closed)) continue;

    const [oh, om] = String(rule.open_time).split(":").map(Number);
    const [ch, cm] = String(rule.close_time).split(":").map(Number);
    const close = new Date(entry);
    close.setHours(ch || 0, cm || 0, 0, 0);
    // Overnight libraries: closing time earlier than opening time means "next day".
    if ((ch * 60 + cm) <= (oh * 60 + om)) close.setDate(close.getDate() + 1);
    if (close <= entry) close.setDate(close.getDate() + 1);
    if (now < close) continue;

    const stamp = close.toISOString().slice(0, 19).replace("T", " ");
    const local = `${close.getFullYear()}-${String(close.getMonth() + 1).padStart(2, "0")}-${String(close.getDate()).padStart(2, "0")} ` +
      `${String(close.getHours()).padStart(2, "0")}:${String(close.getMinutes()).padStart(2, "0")}:00`;
    await q(
      `INSERT INTO entry_exit_logs (id, institute_id, member_id, action, method, device_id, occurred_at)
       VALUES (UUID(), ?, ?, 'Exit', 'Auto', 'auto-close', ?)`,
      [instituteId, row.member_id, local || stamp],
    );
    closed += 1;
  }
  return closed;
}

/** Sweeps every university for people left inside after closing time. */
export async function runAutoExitJob() {
  const institutes = await q("SELECT id FROM institutes");
  let closed = 0;
  for (const inst of institutes) {
    try {
      closed += await autoExitInstitute(inst.id);
    } catch {
      /* one university must never break the sweep */
    }
  }
  return { closed };
}

/** Runs once at boot and then every 24 hours. */
export function startScheduler() {
  const tick = () =>
    whenDatabaseReady(runExpiryJob)
      .then((r) => r && console.log("  expiry job:", JSON.stringify(r)))
      .catch((e) => console.error("  expiry job failed:", e.message));
  setTimeout(tick, 5000);
  setInterval(tick, 24 * 60 * 60 * 1000).unref?.();

  const autoExit = () =>
    whenDatabaseReady(runAutoExitJob)
      .then((r) => r?.closed && console.log(`  auto-exit: closed ${r.closed} visit(s)`))
      .catch((e) => console.error("  auto-exit job failed:", e.message));
  setTimeout(autoExit, 8000);
  setInterval(autoExit, 5 * 60 * 1000).unref?.();

  // Daily GitHub release check (the helper itself only calls GitHub once a day).
  const releaseCheck = () =>
    whenDatabaseReady(runGithubCheckJob)
      .then((r) => {
        if (!r) return;
        if (r.error) console.error("  update check failed:", r.error);
        else if (r.available) console.log(`  update available on GitHub: ${r.latest}`);
      })
      .catch((e) => console.error("  update check failed:", e.message));
  setTimeout(releaseCheck, 12000);
  setInterval(releaseCheck, 60 * 60 * 1000).unref?.();

  // If MySQL is still starting (common with XAMPP/WAMP), retry promptly rather
  // than waiting for the normal five-minute/hourly schedules.
  const readinessRetry = setInterval(() => {
    if (!databaseWarningShown) return;
    whenDatabaseReady(async () => {
      await Promise.allSettled([runAutoExitJob(), runGithubCheckJob()]);
    }).catch((e) => console.error("  scheduler retry failed:", e.message));
  }, RETRY_MS);
  readinessRetry.unref?.();
}
