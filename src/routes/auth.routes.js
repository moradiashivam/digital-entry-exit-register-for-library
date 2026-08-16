import { Router } from "express";
import { q, one, uuid } from "../db.js";
import {
  hashPassword,
  verifyPassword,
  signToken,
  requireAuth,
  logAudit,
} from "../auth.js";
import { sha256, randomToken } from "../crypto.js";
import { sendMail, smtpConfigured } from "../mailer.js";

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


router.post("/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });
  if (!rateLimit(`login:${req.ip}:${email}`, 10, 5 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many attempts — try again in a few minutes" });
  }


  const user = await one("SELECT * FROM users WHERE email = ?", [email]);
  if (!user || user.status !== "Active" || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  await q("UPDATE users SET last_login_at = NOW() WHERE id = ?", [user.id]);
  res.json({
    token: signToken(user),
    user: { id: user.id, email: user.email, full_name: user.full_name, is_platform_owner: !!user.is_platform_owner },
  });
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

