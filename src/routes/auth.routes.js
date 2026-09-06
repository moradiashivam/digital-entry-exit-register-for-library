import { Router } from "express";
import svgCaptcha from "svg-captcha";
import { q, one, uuid } from "../db.js";
import {
  hashPassword,
  verifyPassword,
  signToken,
  requireAuth,
  logAudit,
} from "../auth.js";
import { sha256, randomToken } from "../crypto.js";
import { evaluateLoginAccess, DENY_MESSAGE } from "../net-access.js";
import { sendMail, smtpConfigured } from "../mailer.js";
import {
  signMfaTicket,
  readMfaTicket,
  startEnrolment,
  enableTotp,
  disableTotp,
  verifyTotp,
  userTotpSecret,
  sendEmailOtp,
  verifyEmailOtp,
  enableFace,
  disableFace,
  verifyFace,
  setEmailFactor,
  userMethods,
  mfaRequired,
} from "../twofactor.js";


const router = Router();

/** Very small in-memory rate limiter for the sensitive endpoints. */
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  return list.length <= max;
}

/** In-memory captcha store: id -> { answer, expires }. One-time use. */
const captchas = new Map();
const CAPTCHA_TTL = 5 * 60 * 1000;
function sweepCaptchas() {
  const now = Date.now();
  for (const [id, c] of captchas) if (now > c.expires) captchas.delete(id);
}

/** GET /api/auth/captcha — returns { id, svg } for the login form. */
router.get("/captcha", (_req, res) => {
  sweepCaptchas();
  const captcha = svgCaptcha.create({
    size: 4,
    ignoreChars: "0o1ilI",
    noise: 2,
    color: true,
    width: 180,
    height: 60,
    fontSize: 52,
  });
  const id = uuid();
  captchas.set(id, { answer: captcha.text.toLowerCase(), expires: Date.now() + CAPTCHA_TTL });
  res.set("Cache-Control", "no-store").json({ id, svg: captcha.data });
});

function checkCaptcha(id, text) {
  const c = captchas.get(String(id || ""));
  captchas.delete(String(id || "")); // one-time use, even on failure
  if (!c || Date.now() > c.expires) return false;
  return c.answer === String(text || "").trim().toLowerCase();
}


router.post("/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });
  if (!checkCaptcha(req.body?.captchaId, req.body?.captchaText)) {
    return res.status(400).json({ error: "Incorrect or expired security code — try again", captcha: true });
  }
  if (!rateLimit(`login:${req.ip}:${email}`, 10, 5 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many attempts — try again in a few minutes" });
  }



  const user = await one("SELECT * FROM users WHERE email = ?", [email]);
  if (!user || user.status !== "Active" || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  // University Access Control — geography (owner) then IP list (university).
  if (!user.is_platform_owner) {
    const verdict = await evaluateLoginAccess(user.id, req);
    if (!verdict.allowed) {
      return res.status(403).json({ error: DENY_MESSAGE, detail: verdict.reason });
    }
  }
  if (mfaRequired(user)) {
    const methods = userMethods(user);
    return res.json({
      mfa: true,
      mfaToken: signMfaTicket(user),
      methods,
      emailHint: maskEmail(user.email),
      message: methods.totp
        ? "Enter the 6-digit code from your Authenticator app"
        : methods.face
          ? "Verify with your face to finish signing in"
          : "We can email you a one-time sign-in code",
    });
  }
  await q("UPDATE users SET last_login_at = NOW() WHERE id = ?", [user.id]);
  res.json({
    token: signToken(user),
    user: { id: user.id, email: user.email, full_name: user.full_name, is_platform_owner: !!user.is_platform_owner },
  });
});

const maskEmail = (email) => {
  const [name, domain] = String(email).split("@");
  return `${name.slice(0, 2)}${"•".repeat(Math.max(2, name.length - 2))}@${domain || ""}`;
};

async function ticketUser(req, res) {
  const id = readMfaTicket(req.body?.mfaToken);
  const user = id ? await one("SELECT * FROM users WHERE id = ?", [id]) : null;
  if (!user || user.status !== "Active") {
    res.status(401).json({ error: "This sign-in attempt expired — start again", restart: true });
    return null;
  }
  return user;
}

/** Step 2 — verify the Authenticator code (or the emailed code). */
router.post("/login/verify", async (req, res) => {
  const user = await ticketUser(req, res);
  if (!user) return;
  const code = String(req.body?.code || "").trim();
  if (!rateLimit(`mfa:${user.id}`, 10, 10 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many codes tried — wait a few minutes" });
  }
  const ok =
    (req.body?.method === "email"
      ? await verifyEmailOtp(user.id, code)
      : verifyTotp(userTotpSecret(user), code)) ||
    (req.body?.method !== "email" && (await verifyEmailOtp(user.id, code)));
  if (!ok) return res.status(401).json({ error: "That code is not correct or has expired" });
  await q("UPDATE users SET last_login_at = NOW() WHERE id = ?", [user.id]);
  res.json({
    token: signToken(user),
    user: { id: user.id, email: user.email, full_name: user.full_name, is_platform_owner: !!user.is_platform_owner },
  });
});

/** Step 2 (face) — verify the captured face descriptor against the enrolled one. */
router.post("/login/face", async (req, res) => {
  const user = await ticketUser(req, res);
  if (!user) return;
  if (!rateLimit(`face:${user.id}`, 10, 10 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many face attempts — wait a few minutes" });
  }
  if (!user.face_2fa_enabled) return res.status(400).json({ error: "Face sign-in is not set up for this account" });
  if (!verifyFace(user, req.body?.descriptor)) {
    return res.status(401).json({ error: "Face did not match — try again or use another method" });
  }
  await q("UPDATE users SET last_login_at = NOW() WHERE id = ?", [user.id]);
  res.json({
    token: signToken(user),
    user: { id: user.id, email: user.email, full_name: user.full_name, is_platform_owner: !!user.is_platform_owner },
  });
});

/** Step 2 (fallback) — email a one-time code instead of using the app. */
router.post("/login/email-otp", async (req, res) => {
  const user = await ticketUser(req, res);
  if (!user) return;
  if (!rateLimit(`otp:${user.id}`, 5, 15 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many codes requested — try again later" });
  }
  try {
    const out = await sendEmailOtp(user);
    res.json({ ...out, email: maskEmail(user.email) });
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

/** Two-factor management for the signed-in user. */
router.get("/2fa", requireAuth, async (req, res) => {
  const user = await one(
    "SELECT totp_enabled, face_2fa_enabled, email_2fa_enabled FROM users WHERE id = ?",
    [req.user.id],
  );
  const methods = userMethods(user || {});
  res.json({
    enabled: !!user?.totp_enabled, // kept for older screens
    methods,
    any: methods.totp || methods.face || methods.email,
    emailReady: await smtpConfigured(),
    email: req.user.email,
  });
});

/** Face authentication as a second factor. */
router.post("/2fa/face/enable", requireAuth, async (req, res) => {
  const out = await enableFace(req.user.id, req.body?.descriptor);
  if (!out.ok) return res.status(400).json({ error: out.error });
  await logAudit(req, null, "user.2fa_face_enabled", "users", req.user.id, null);
  res.json({ ok: true });
});

router.post("/2fa/face/disable", requireAuth, async (req, res) => {
  const user = await one("SELECT * FROM users WHERE id = ?", [req.user.id]);
  if (!(await verifyPassword(String(req.body?.password || ""), user.password_hash))) {
    return res.status(400).json({ error: "Your password is incorrect" });
  }
  await disableFace(req.user.id);
  await logAudit(req, null, "user.2fa_face_disabled", "users", req.user.id, null);
  res.json({ ok: true });
});

/** Emailed one-time code as a stand-alone second factor. */
router.post("/2fa/email", requireAuth, async (req, res) => {
  const on = !!req.body?.enabled;
  if (on && !(await smtpConfigured())) {
    return res.status(400).json({ error: "Email is not configured yet — ask the platform owner" });
  }
  if (!on) {
    const user = await one("SELECT password_hash FROM users WHERE id = ?", [req.user.id]);
    if (!(await verifyPassword(String(req.body?.password || ""), user.password_hash))) {
      return res.status(400).json({ error: "Your password is incorrect" });
    }
  }
  await setEmailFactor(req.user.id, on);
  await logAudit(req, null, on ? "user.2fa_email_enabled" : "user.2fa_email_disabled", "users", req.user.id, null);
  res.json({ ok: true });
});

router.post("/2fa/setup", requireAuth, async (req, res) => {
  const user = await one("SELECT * FROM users WHERE id = ?", [req.user.id]);
  if (user.totp_enabled) return res.status(400).json({ error: "Two-factor is already enabled" });
  res.json(await startEnrolment(user));
});

router.post("/2fa/enable", requireAuth, async (req, res) => {
  const user = await one("SELECT * FROM users WHERE id = ?", [req.user.id]);
  const out = await enableTotp(user, req.body?.code);
  if (!out.ok) return res.status(400).json({ error: out.error });
  await logAudit(req, null, "user.2fa_enabled", "users", req.user.id, null);
  res.json({ ok: true });
});

router.post("/2fa/disable", requireAuth, async (req, res) => {
  const user = await one("SELECT * FROM users WHERE id = ?", [req.user.id]);
  if (!(await verifyPassword(String(req.body?.password || ""), user.password_hash))) {
    return res.status(400).json({ error: "Your password is incorrect" });
  }
  await disableTotp(req.user.id);
  await logAudit(req, null, "user.2fa_disabled", "users", req.user.id, null);
  res.json({ ok: true });
});


/** Current user + the universities they can work in. */
router.get("/me", requireAuth, async (req, res) => {
  const owner = !!req.user.is_platform_owner;
  const institutes = owner
    ? await q("SELECT * FROM institutes ORDER BY name")
    : req.user.roles.length
      ? await q(
          `SELECT * FROM institutes WHERE id IN (${req.user.roles.map(() => "?").join(",")}) ORDER BY name`,
          req.user.roles.map((r) => r.institute_id),
        )
      : [];
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      full_name: req.user.full_name,
      is_platform_owner: owner,
    },
    roles: req.user.roles,
    institutes,
  });
});

router.post("/change-password", requireAuth, async (req, res) => {
  const current = String(req.body?.current || "");
  const next = String(req.body?.next || "");
  if (next.length < 8) return res.status(400).json({ error: "New password must be at least 8 characters" });
  const user = await one("SELECT password_hash FROM users WHERE id = ?", [req.user.id]);
  if (!(await verifyPassword(current, user.password_hash))) {
    return res.status(400).json({ error: "Current password is incorrect" });
  }
  await q("UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(next), req.user.id]);
  await logAudit(req, null, "user.password_change", "users", req.user.id, null);
  res.json({ ok: true });
});

/** Step 1 — request a reset link. Always answers OK so emails can't be probed. */
router.post("/forgot-password", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const generic = { ok: true, message: "If that email is registered, a reset link is on its way." };
  if (!email) return res.status(400).json({ error: "Enter your email address" });
  if (!rateLimit(`forgot:${req.ip}`, 5, 15 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many reset requests — try again later" });
  }

  const user = await one("SELECT id, email, full_name, status FROM users WHERE email = ?", [email]);
  if (!user || user.status !== "Active") return res.json(generic);
  if (!(await smtpConfigured())) {
    return res.status(503).json({ error: "Email is not configured yet — ask the platform owner" });
  }

  const token = randomToken();
  await q(
    `INSERT INTO password_resets (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 45 MINUTE))`,
    [uuid(), user.id, sha256(token)],
  );
  const base = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
  const link = `${base}/reset.html?token=${token}`;
  try {
    await sendMail({
      to: user.email,
      subject: "Reset your Library Register password",
      text: `Hello ${user.full_name || ""},\n\nUse this link to set a new password (valid for 45 minutes):\n${link}\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>Hello ${user.full_name || ""},</p><p>Use this link to set a new password (valid for 45 minutes):</p><p><a href="${link}">${link}</a></p><p>If you did not request this, you can ignore this email.</p>`,
    });
  } catch (e) {
    return res.status(502).json({ error: `Could not send the email: ${e.message}` });
  }
  res.json(generic);
});

/** Step 2 — set the new password with the emailed token. */
router.post("/reset-password", async (req, res) => {
  const token = String(req.body?.token || "");
  const password = String(req.body?.password || "");
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  const row = await one(
    `SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()`,
    [sha256(token)],
  );
  if (!row) return res.status(400).json({ error: "This reset link is invalid or has expired" });

  await q("UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(password), row.user_id]);
  await q("UPDATE password_resets SET used_at = NOW() WHERE id = ?", [row.id]);
  const user = await one("SELECT email, full_name FROM users WHERE id = ?", [row.user_id]);
  sendMail({
    to: user.email,
    subject: "Your Library Register password was changed",
    text: "Your password was just changed. If this wasn't you, contact the platform owner immediately.",
  }).catch(() => {});
  res.json({ ok: true });
});

export default router;

