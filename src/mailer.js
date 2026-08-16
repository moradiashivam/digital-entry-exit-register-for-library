import { q, one } from "./db.js";
import { decrypt } from "./crypto.js";

/** Loads the default SMTP profile (and the fallback, if configured). */
export async function loadSmtp() {
  const rows = await q(
    `SELECT * FROM smtp_settings WHERE institute_id IS NULL ORDER BY is_default DESC, is_fallback ASC`,
  );
  return {
    primary: rows.find((r) => r.is_default) ?? rows[0] ?? null,
    fallback: rows.find((r) => r.is_fallback) ?? null,
  };
}

function transportFor(cfg) {
  return import("nodemailer").then(({ default: nodemailer }) =>
    nodemailer.createTransport({
      host: cfg.host,
      port: Number(cfg.port || 587),
      secure: cfg.encryption_type === "ssl",
      requireTLS: cfg.encryption_type === "tls",
      auth: cfg.username ? { user: cfg.username, pass: decrypt(cfg.password_encrypted) } : undefined,
    }),
  );
}

async function deliver(cfg, message) {
  const transporter = await transportFor(cfg);
  await transporter.sendMail({
    from: `"${cfg.from_name}" <${cfg.from_email}>`,
    replyTo: cfg.reply_to || undefined,
    ...message,
  });
  return { sent: true, via: cfg.label };
}

/** Sends an email through the primary profile, falling back to the backup one. */
export async function sendMail(message) {
  const { primary, fallback } = await loadSmtp();
  if (!primary) throw new Error("No SMTP profile configured yet — add one in Owner settings");
  try {
    return await deliver(primary, message);
  } catch (e) {
    if (!fallback || fallback.id === primary.id) throw e;
    return deliver(fallback, message);
  }
}

/** Sends using an explicit (unsaved) config — used by the “Send test email” button. */
export async function sendMailWith(cfg, message) {
  return deliver(cfg, message);
}

export async function smtpConfigured() {
  return !!(await one("SELECT id FROM smtp_settings WHERE institute_id IS NULL LIMIT 1"));
}
