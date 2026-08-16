import { q } from "./db.js";
import { sendMail, smtpConfigured } from "./mailer.js";

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

/** Runs once at boot and then every 24 hours. */
export function startScheduler() {
  const tick = () =>
    runExpiryJob()
      .then((r) => console.log("  expiry job:", JSON.stringify(r)))
      .catch((e) => console.error("  expiry job failed:", e.message));
  setTimeout(tick, 5000);
  setInterval(tick, 24 * 60 * 60 * 1000).unref?.();
}
