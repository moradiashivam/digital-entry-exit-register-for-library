import { Router } from "express";
import { q, one, uuid, kioskKey, today, plusYear } from "../db.js";
import { requireAuth, requireOwner, hashPassword, logAudit } from "../auth.js";

const router = Router();
router.use(requireAuth, requireOwner);

const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/** All universities with their kiosk key and member counts. */
router.get("/", async (_req, res) => {
  const rows = await q(`
    SELECT i.*, s.kiosk_key,
           (SELECT COUNT(*) FROM members m WHERE m.institute_id = i.id) AS members
    FROM institutes i
    LEFT JOIN institute_secrets s ON s.institute_id = i.id
    ORDER BY i.name`);
  res.json(rows);
});

router.post("/", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const slug = slugify(String(req.body?.slug || name));
  const start = req.body?.subscription_start || today();
  const end = req.body?.subscription_end || plusYear();
  if (!name || !slug) return res.status(400).json({ error: "Enter a university name" });
  if (end <= start) return res.status(400).json({ error: "End date must be after the start date" });
  if (await one("SELECT id FROM institutes WHERE slug = ?", [slug])) {
    return res.status(409).json({ error: "That kiosk link is already taken" });
  }

  const id = uuid();
  await q(
    `INSERT INTO institutes (id, slug, name, contact_email, contact_phone, address, subscription_start, subscription_end)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, slug, name, req.body?.contact_email || null, req.body?.contact_phone || null,
     req.body?.address || null, start, end],
  );
  await q("INSERT INTO institute_secrets (institute_id, kiosk_key) VALUES (?, ?)", [id, kioskKey()]);
  await q("INSERT INTO kiosk_settings (institute_id, institution_name) VALUES (?, ?)", [id, name]);
  await logAudit(req, id, "institute.create", "institutes", id, { name, slug });
  res.status(201).json(await one("SELECT * FROM institutes WHERE id = ?", [id]));
});

router.patch("/:id", async (req, res) => {
  const inst = await one("SELECT * FROM institutes WHERE id = ?", [req.params.id]);
  if (!inst) return res.status(404).json({ error: "University not found" });

  const fields = ["name", "contact_email", "contact_phone", "address", "subscription_start", "subscription_end"];
  const patch = {};
  for (const f of fields) if (req.body?.[f] !== undefined) patch[f] = req.body[f];
  const start = patch.subscription_start ?? inst.subscription_start;
  const end = patch.subscription_end ?? inst.subscription_end;
  if (end <= start) return res.status(400).json({ error: "End date must be after the start date" });
  if (!Object.keys(patch).length) return res.json(inst);

  await q(
    `UPDATE institutes SET ${Object.keys(patch).map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
    [...Object.values(patch), inst.id],
  );
  await logAudit(req, inst.id, "institute.update", "institutes", inst.id, patch);
  res.json(await one("SELECT * FROM institutes WHERE id = ?", [inst.id]));
});

/** Rotate the shared secret the C++ kiosk bridge sends. */
router.post("/:id/rotate-key", async (req, res) => {
  const key = kioskKey();
  await q(
    `INSERT INTO institute_secrets (institute_id, kiosk_key) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE kiosk_key = VALUES(kiosk_key)`,
    [req.params.id, key],
  );
  await logAudit(req, req.params.id, "institute.rotate_key", "institute_secrets", req.params.id, null);
  res.json({ kiosk_key: key });
});

/** University admin logins issued by the owner. */
router.get("/:id/admins", async (req, res) => {
  res.json(await q(
    `SELECT u.id, u.email, u.full_name, u.status, u.last_login_at, r.role
     FROM user_roles r JOIN users u ON u.id = r.user_id
     WHERE r.institute_id = ? ORDER BY u.email`,
    [req.params.id],
  ));
});

router.post("/:id/admins", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const fullName = String(req.body?.full_name || "").trim() || email.split("@")[0];
  const role = ["super_admin", "librarian", "report_viewer"].includes(req.body?.role)
    ? req.body.role : "super_admin";
  if (!email || password.length < 8) {
    return res.status(400).json({ error: "Email and a password of 8+ characters are required" });
  }
  const inst = await one("SELECT id FROM institutes WHERE id = ?", [req.params.id]);
  if (!inst) return res.status(404).json({ error: "University not found" });

  let user = await one("SELECT * FROM users WHERE email = ?", [email]);
  if (!user) {
    const id = uuid();
    await q(
      "INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)",
      [id, email, await hashPassword(password), fullName],
    );
    user = { id };
  } else {
    await q("UPDATE users SET password_hash = ?, status = 'Active' WHERE id = ?",
      [await hashPassword(password), user.id]);
  }
  await q(
    `INSERT IGNORE INTO user_roles (id, user_id, institute_id, role) VALUES (?, ?, ?, ?)`,
    [uuid(), user.id, inst.id, role],
  );
  await logAudit(req, inst.id, "institute.admin_create", "users", user.id, { email, role });
  res.status(201).json({ id: user.id, email, role });
});

router.post("/:id/admins/:userId/password", async (req, res) => {
  const password = String(req.body?.password || "");
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  await q("UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(password), req.params.userId]);
  await logAudit(req, req.params.id, "institute.admin_reset", "users", req.params.userId, null);
  res.json({ ok: true });
});

router.delete("/:id/admins/:userId", async (req, res) => {
  await q("DELETE FROM user_roles WHERE user_id = ? AND institute_id = ?", [req.params.userId, req.params.id]);
  await logAudit(req, req.params.id, "institute.admin_revoke", "users", req.params.userId, null);
  res.json({ ok: true });
});

export default router;
