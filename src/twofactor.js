import speakeasy from "speakeasy";
import QRCode from "qrcode";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { q, one, uuid } from "./db.js";
import { encrypt, decrypt, sha256 } from "./crypto.js";
import { sendMail, smtpConfigured } from "./mailer.js";

// Read lazily: first-run setup writes the secret after this module loads.
const secret = () => process.env.JWT_SECRET || "dev-only-secret-change-me";
const ISSUER = process.env.APP_NAME || "Library Entry & Exit Register";
const OTP_MINUTES = 10;

/** Short-lived ticket issued after the password step, before the second factor. */
export function signMfaTicket(user) {
  return jwt.sign({ sub: user.id, mfa: true }, secret(), { expiresIn: "10m" });
}

export function readMfaTicket(token) {
  try {
    const payload = jwt.verify(String(token || ""), secret());
    return payload?.mfa ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Creates a new (not yet enabled) authenticator secret and its QR code. */
export async function startEnrolment(user) {
  const secret = speakeasy.generateSecret({ length: 20, name: `${ISSUER} (${user.email})` });
  const otpauth = speakeasy.otpauthURL({
    secret: secret.ascii,
    label: user.email,
    issuer: ISSUER,
  });
  await q("UPDATE users SET totp_pending = ? WHERE id = ?", [encrypt(secret.base32), user.id]);
  return { secret: secret.base32, otpauth_url: otpauth, qr: await QRCode.toDataURL(otpauth) };
}

export const verifyTotp = (base32, token) =>
  !!base32 &&
  speakeasy.totp.verify({
    secret: base32,
    encoding: "base32",
    token: String(token || "").replace(/\s+/g, ""),
    window: 1,
  });

export const userTotpSecret = (user) => decrypt(user.totp_secret);

/** Confirms the first code and switches two-factor on. */
export async function enableTotp(user, token) {
  const pending = decrypt(user.totp_pending);
  if (!pending) return { ok: false, error: "Start the setup again — no pending secret" };
  if (!verifyTotp(pending, token)) return { ok: false, error: "That code is not correct — try the next one" };
  await q(
    "UPDATE users SET totp_secret = ?, totp_pending = NULL, totp_enabled = 1 WHERE id = ?",
    [encrypt(pending), user.id],
  );
  return { ok: true };
}

export async function disableTotp(userId) {
  await q(
    "UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled = 0 WHERE id = ?",
    [userId],
  );
}

/** Email OTP fallback so a lost/blocked authenticator app never locks anyone out. */
export async function sendEmailOtp(user) {
  if (!(await smtpConfigured())) throw new Error("Email is not configured yet — ask the platform owner");
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await q("DELETE FROM login_otps WHERE user_id = ? OR expires_at < NOW()", [user.id]);
  await q(
    `INSERT INTO login_otps (id, user_id, code_hash, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [uuid(), user.id, sha256(code), OTP_MINUTES],
  );
  await sendMail({
    to: user.email,
    subject: `${code} is your sign-in code`,
    text: `Your sign-in code is ${code}. It expires in ${OTP_MINUTES} minutes.\n\nIf you did not try to sign in, change your password.`,
    html: `<p>Your sign-in code is <strong style="font-size:20px">${code}</strong>.</p><p>It expires in ${OTP_MINUTES} minutes.</p>`,
  });
  return { sent: true, minutes: OTP_MINUTES };
}

export async function verifyEmailOtp(userId, code) {
  const row = await one(
    `SELECT * FROM login_otps
     WHERE user_id = ? AND code_hash = ? AND used_at IS NULL AND expires_at > NOW()`,
    [userId, sha256(String(code || "").trim())],
  );
  if (!row) return false;
  await q("UPDATE login_otps SET used_at = NOW() WHERE id = ?", [row.id]);
  return true;
}

/* ----------------------------------------------------------------------------
 * Face authentication as a second factor.
 *
 * The browser (admin console or login page) turns the camera image into a
 * 128-number face descriptor with face-api.js; only that descriptor travels to
 * the server, encrypted at rest. Matching is done here on the server so a
 * stored template is never handed back to the browser.
 * ------------------------------------------------------------------------- */

const FACE_THRESHOLD = Number(process.env.FACE_2FA_THRESHOLD || 0.5);

export function parseDescriptor(value) {
  const list = Array.isArray(value) ? value : [];
  if (list.length !== 128 || list.some((n) => typeof n !== "number" || !Number.isFinite(n))) return null;
  return list;
}

const faceDistance = (a, b) => {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
};

/** Saves (or replaces) the face template and switches face sign-in on. */
export async function enableFace(userId, descriptor) {
  const list = parseDescriptor(descriptor);
  if (!list) return { ok: false, error: "No clear face was captured — try again in better light" };
  await q("UPDATE users SET face_descriptor = ?, face_2fa_enabled = 1 WHERE id = ?", [
    encrypt(JSON.stringify(list)),
    userId,
  ]);
  return { ok: true };
}

export async function disableFace(userId) {
  await q("UPDATE users SET face_descriptor = NULL, face_2fa_enabled = 0 WHERE id = ?", [userId]);
}

/** True when the captured face is close enough to the enrolled template. */
export function verifyFace(user, descriptor) {
  const list = parseDescriptor(descriptor);
  if (!list || !user?.face_2fa_enabled) return false;
  let stored = null;
  try {
    stored = JSON.parse(decrypt(user.face_descriptor) || "null");
  } catch {
    stored = null;
  }
  if (!Array.isArray(stored) || stored.length !== 128) return false;
  return faceDistance(list, stored) <= FACE_THRESHOLD;
}

/** Email OTP can also be a stand-alone second factor, not only a fallback. */
export async function setEmailFactor(userId, enabled) {
  await q("UPDATE users SET email_2fa_enabled = ? WHERE id = ?", [enabled ? 1 : 0, userId]);
}

/** The methods a user can complete at sign-in. */
export const userMethods = (user) => ({
  totp: !!user.totp_enabled,
  face: !!user.face_2fa_enabled,
  email: !!user.email_2fa_enabled,
});

export const mfaRequired = (user) => !!(user.totp_enabled || user.face_2fa_enabled || user.email_2fa_enabled);
