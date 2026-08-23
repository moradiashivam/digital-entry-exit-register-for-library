/**
 * Master Setting — sublibrary user management.
 *
 * Everything here belongs to the University Administrator of the active
 * university (role `super_admin`), except `/me/access`, which any signed-in
 * member uses to learn what their own account may do.
 */
import { Router } from "express";
import { q, one, uuid } from "../db.js";
import {
  requireAuth,
  withInstitute,
  isMember,
  hashPassword,
  logAudit,
} from "../auth.js";
import { MODULES, MODULE_KEYS, ROLE_PRESETS, requireInstituteAdmin } from "../access.js";

const router = Router();
router.use(requireAuth);

const ROLES = Object.keys(ROLE_PRESETS);

/* ------------------------------------------------------------------ *
 * What the signed-in user may do in the active university.
 * ------------------------------------------------------------------ */
router.get("/me/access", withInstitute(isMember), (req, res) => {
  const a = req.access;
  res.json({
    admin: !!a.admin,
    roles: a.roles || [],
    viewer_only: !!a.viewer_only,
    allow_bulk_upload: !!a.allow_bulk_upload,
    allow_export: !!a.allow_export,
    modules: a.modules, // null = all modules
    sublibraries: a.sublibraries,
    locations: a.locations,
    kiosks: a.kiosks, // device ids, null = all kiosks
  });
});

/** Reference data for the Master Setting screen. */
router.get("/meta", withInstitute(isMember), requireInstituteAdmin, async (req, res) => {
  const [sublibraries, kiosks, locations] = await Promise.all([
    q("SELECT id, name, code, is_active FROM sublibraries WHERE institute_id = ? ORDER BY name", [req.institute.id]),
    q("SELECT id, device_id, name, location, sublibrary_id, is_active FROM kiosk_devices WHERE institute_id = ? ORDER BY name", [req.institute.id]),
    q("SELECT DISTINCT location FROM kiosk_devices WHERE institute_id = ? AND location IS NOT NULL AND location <> '' ORDER BY location", [req.institute.id]),
  ]);
  res.json({
    modules: MODULES,
    roles: ROLES.map((key) => ({ key, ...ROLE_PRESETS[key] })),
    sublibraries,
    kiosks,
    locations: locations.map((r) => r.location),
  });
});

/* ------------------------------------------------------------------ *
 * Sublibraries (libraries inside the university).
 * ------------------------------------------------------------------ */
router.get("/sublibraries", withInstitute(isMember), async (req, res) => {
  res.json(await q(
    `SELECT s.id, s.name, s.code, s.is_active,
            (SELECT COUNT(*) FROM kiosk_devices k WHERE k.sublibrary_id = s.id) AS kiosks
     FROM sublibraries s WHERE s.institute_id = ? ORDER BY s.name`,
    [req.institute.id],
  ));
});

router.post("/sublibraries", withInstitute(isMember), requireInstituteAdmin, async (req, res) => {
  const name = String(req.body?.name ?? "").trim().slice(0, 150);
  if (!name) return res.status(400).json({ error: "Library name is required" });
  const code = String(req.body?.code ?? "").trim().slice(0, 40) || null;
  const id = uuid();
  try {
    await q("INSERT INTO sublibraries (id, institute_id, name, code) VALUES (?,?,?,?)",
      [id, req.institute.id, name, code]);
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "That library already exists" });
    throw e;
  }
  await logAudit(req, req.institute.id, "sublibrary.create", "sublibraries", id, { name });
  res.status(201).json({ id, name, code, is_active: 1, kiosks: 0 });
});

router.patch("/sublibraries/:id", withInstitute(isMember), requireInstituteAdmin, async (req, res) => {
  const row = await one("SELECT * FROM sublibraries WHERE id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  if (!row) return res.status(404).json({ error: "Library not found" });
  const name = req.body?.name === undefined ? row.name : String(req.body.name).trim().slice(0, 150);
  if (!name) return res.status(400).json({ error: "Library name is required" });
  const code = req.body?.code === undefined ? row.code : (String(req.body.code).trim().slice(0, 40) || null);
  const isActive = req.body?.is_active === undefined ? row.is_active : (req.body.is_active ? 1 : 0);
  await q("UPDATE sublibraries SET name = ?, code = ?, is_active = ? WHERE id = ?", [name, code, isActive, row.id]);
  await logAudit(req, req.institute.id, "sublibrary.update", "sublibraries", row.id, { name, is_active: isActive });
  res.json({ id: row.id, name, code, is_active: isActive });
});

router.delete("/sublibraries/:id", withInstitute(isMember), requireInstituteAdmin, async (req, res) => {
  await q("DELETE FROM sublibraries WHERE id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  await logAudit(req, req.institute.id, "sublibrary.delete", "sublibraries", req.params.id, null);
  res.json({ ok: true });
});

/** Attach a kiosk to a sublibrary. */
router.patch("/kiosks/:id/sublibrary", withInstitute(isMember), requireInstituteAdmin, async (req, res) => {
  const kiosk = await one("SELECT * FROM kiosk_devices WHERE id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  if (!kiosk) return res.status(404).json({ error: "Kiosk not found" });
  const subId = req.body?.sublibrary_id || null;
  if (subId) {
    const lib = await one("SELECT id FROM sublibraries WHERE id = ? AND institute_id = ?", [subId, req.institute.id]);
    if (!lib) return res.status(400).json({ error: "Unknown library" });
  }
  await q("UPDATE kiosk_devices SET sublibrary_id = ? WHERE id = ?", [subId, kiosk.id]);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ *
 * Sublibrary users.
 * ------------------------------------------------------------------ */

const cleanModules = (list) =>
  Array.isArray(list) ? [...new Set(list.filter((m) => MODULE_KEYS.includes(m)))] : [];

function accessPayload(body = {}, userId) {
  const role = ROLES.includes(body.role) ? body.role : "operator";
  const preset = ROLE_PRESETS[role];
  return {
    role,
    modules: body.modules === undefined ? preset.modules : cleanModules(body.modules),
    viewer_only: body.viewer_only === undefined ? preset.viewer_only : (body.viewer_only ? 1 : 0),
    allow_bulk_upload: body.allow_bulk_upload === undefined ? preset.allow_bulk_upload : (body.allow_bulk_upload ? 1 : 0),
    allow_export: body.allow_export === undefined ? preset.allow_export : (body.allow_export ? 1 : 0),
    sublibraries: Array.isArray(body.sublibraries) ? body.sublibraries : [],
    locations: Array.isArray(body.locations) ? body.locations.map((l) => String(l).slice(0, 120)) : [],
    kiosks: Array.isArray(body.kiosks) ? body.kiosks : [],
    userId,
  };
}

async function saveAccess(instituteId, p) {
  await q(
    `INSERT INTO user_access (user_id, institute_id, viewer_only, allow_bulk_upload, allow_export, modules)
     VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE viewer_only = VALUES(viewer_only),
       allow_bulk_upload = VALUES(allow_bulk_upload), allow_export = VALUES(allow_export),
       modules = VALUES(modules)`,
    [p.userId, instituteId, p.viewer_only, p.allow_bulk_upload, p.allow_export, JSON.stringify(p.modules)],
  );

  await q("DELETE FROM user_sublibraries WHERE user_id = ? AND institute_id = ?", [p.userId, instituteId]);
  for (const id of p.sublibraries) {
    const lib = await one("SELECT id FROM sublibraries WHERE id = ? AND institute_id = ?", [id, instituteId]);
    if (lib) await q("INSERT IGNORE INTO user_sublibraries (user_id, institute_id, sublibrary_id) VALUES (?,?,?)", [p.userId, instituteId, lib.id]);
  }

  await q("DELETE FROM user_locations WHERE user_id = ? AND institute_id = ?", [p.userId, instituteId]);
  for (const loc of [...new Set(p.locations)].filter(Boolean)) {
    await q("INSERT IGNORE INTO user_locations (user_id, institute_id, location) VALUES (?,?,?)", [p.userId, instituteId, loc]);
  }

  await q("DELETE FROM user_kiosks WHERE user_id = ? AND institute_id = ?", [p.userId, instituteId]);
  for (const id of p.kiosks) {
    const k = await one("SELECT id FROM kiosk_devices WHERE id = ? AND institute_id = ?", [id, instituteId]);
    if (k) await q("INSERT IGNORE INTO user_kiosks (user_id, institute_id, kiosk_id) VALUES (?,?,?)", [p.userId, instituteId, k.id]);
  }

  await q("DELETE FROM user_roles WHERE user_id = ? AND institute_id = ?", [p.userId, instituteId]);
  await q("INSERT INTO user_roles (id, user_id, institute_id, role) VALUES (?,?,?,?)", [uuid(), p.userId, instituteId, p.role]);
}

/** Every account attached to this university with its permission envelope. */
router.get("/", withInstitute(isMember), requireInstituteAdmin, async (req, res) => {
  const rows = await q(
    `SELECT u.id, u.email, u.full_name, u.status, u.last_login_at, r.role,
            a.viewer_only, a.allow_bulk_upload, a.allow_export, a.modules
     FROM user_roles r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN user_access a ON a.user_id = u.id AND a.institute_id = r.institute_id
     WHERE r.institute_id = ? ORDER BY u.full_name, u.email`,
    [req.institute.id],
  );
  const [libs, locs, kiosks] = await Promise.all([
    q(`SELECT us.user_id, s.id, s.name FROM user_sublibraries us
       JOIN sublibraries s ON s.id = us.sublibrary_id WHERE us.institute_id = ?`, [req.institute.id]),
    q("SELECT user_id, location FROM user_locations WHERE institute_id = ?", [req.institute.id]),
    q(`SELECT uk.user_id, k.id, k.name, k.device_id FROM user_kiosks uk
       JOIN kiosk_devices k ON k.id = uk.kiosk_id WHERE uk.institute_id = ?`, [req.institute.id]),
  ]);
  res.json(rows.map((u) => ({
    ...u,
    is_admin: u.role === "super_admin",
    viewer_only: Number(u.viewer_only || 0),
    allow_bulk_upload: u.allow_bulk_upload === null ? 1 : Number(u.allow_bulk_upload),
    allow_export: u.allow_export === null ? 1 : Number(u.allow_export),
    modules: (() => { try { return JSON.parse(u.modules) || null; } catch { return null; } })(),
    sublibraries: libs.filter((r) => r.user_id === u.id).map((r) => ({ id: r.id, name: r.name })),
    locations: locs.filter((r) => r.user_id === u.id).map((r) => r.location),
    kiosks: kiosks.filter((r) => r.user_id === u.id).map((r) => ({ id: r.id, name: r.name, device_id: r.device_id })),
  })));
});

/** Create a sublibrary user. */
router.post("/", withInstitute(isMember), requireInstituteAdmin, async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const fullName = String(req.body?.full_name ?? "").trim().slice(0, 120);
  const password = String(req.body?.password ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address" });
  if (!fullName) return res.status(400).json({ error: "Full name is required" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

  let user = await one("SELECT id, is_platform_owner FROM users WHERE email = ?", [email]);
  if (user?.is_platform_owner) return res.status(400).json({ error: "That email belongs to the platform owner" });
  if (user) {
    const already = await one("SELECT 1 AS ok FROM user_roles WHERE user_id = ? AND institute_id = ?", [user.id, req.institute.id]);
    if (already) return res.status(409).json({ error: "This user already has access to your university" });
  } else {
    const id = uuid();
    await q(
      "INSERT INTO users (id, email, full_name, password_hash, status) VALUES (?,?,?,?, 'Active')",
      [id, email, fullName, await hashPassword(password)],
    );
    user = { id };
  }

  const payload = accessPayload(req.body, user.id);
  await saveAccess(req.institute.id, payload);
  await logAudit(req, req.institute.id, "user.create", "users", user.id, { email, role: payload.role });
  res.status(201).json({ id: user.id, email, full_name: fullName, role: payload.role });
});

/** Update a user's role, permissions and location access. */
router.patch("/:id", withInstitute(isMember), requireInstituteAdmin, async (req, res) => {
  const link = await one("SELECT * FROM user_roles WHERE user_id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  if (!link) return res.status(404).json({ error: "User not found in this university" });
  if (req.params.id === req.user.id) return res.status(400).json({ error: "You cannot change your own permissions" });

  if (req.body?.full_name !== undefined || req.body?.status !== undefined) {
    const current = await one("SELECT full_name, status FROM users WHERE id = ?", [req.params.id]);
    await q("UPDATE users SET full_name = ?, status = ? WHERE id = ?", [
      req.body.full_name === undefined ? current.full_name : String(req.body.full_name).trim().slice(0, 120),
      req.body.status === "Inactive" ? "Inactive" : (req.body.status === undefined ? current.status : "Active"),
      req.params.id,
    ]);
  }
  const payload = accessPayload({ role: link.role, ...req.body }, req.params.id);
  await saveAccess(req.institute.id, payload);
  await logAudit(req, req.institute.id, "user.update", "users", req.params.id, { role: payload.role });
  res.json({ ok: true });
});

/** Reset a user's password. */
router.post("/:id/password", withInstitute(isMember), requireInstituteAdmin, async (req, res) => {
  const link = await one("SELECT 1 AS ok FROM user_roles WHERE user_id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  if (!link) return res.status(404).json({ error: "User not found in this university" });
  const password = String(req.body?.password ?? "");
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  await q("UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(password), req.params.id]);
  await logAudit(req, req.institute.id, "user.password_reset", "users", req.params.id, null);
  res.json({ ok: true });
});

/** Remove a user's access to this university. */
router.delete("/:id", withInstitute(isMember), requireInstituteAdmin, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "You cannot remove your own access" });
  await q("DELETE FROM user_roles WHERE user_id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  await q("DELETE FROM user_access WHERE user_id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  await q("DELETE FROM user_sublibraries WHERE user_id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  await q("DELETE FROM user_locations WHERE user_id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  await q("DELETE FROM user_kiosks WHERE user_id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  await logAudit(req, req.institute.id, "user.remove", "users", req.params.id, null);
  res.json({ ok: true });
});

export default router;
