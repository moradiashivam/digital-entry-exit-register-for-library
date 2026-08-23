import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { q, one, uuid } from "./db.js";
import { loadAccess, accessFor, WRITE_ROLES } from "./access.js";


const SECRET = process.env.JWT_SECRET || "dev-only-secret-change-me";
const HOURS = Number(process.env.JWT_HOURS || 12);

export const hashPassword = (plain) => bcrypt.hash(plain, 10);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, owner: !!user.is_platform_owner },
    SECRET,
    { expiresIn: `${HOURS}h` },
  );
}

/** Loads the user + their roles from the bearer token. Does not reject. */
export async function loadUser(req, _res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, SECRET);
    const user = await one(
      "SELECT id, email, full_name, status, is_platform_owner FROM users WHERE id = ?",
      [payload.sub],
    );
    if (!user || user.status !== "Active") return next();
    user.roles = await q(
      "SELECT institute_id, role FROM user_roles WHERE user_id = ?",
      [user.id],
    );
    user.access = await loadAccess(user.id);
    req.user = user;
  } catch {
    /* invalid or expired token — treated as signed out */
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Sign in required" });
  next();
}

export function requireOwner(req, res, next) {
  if (!req.user?.is_platform_owner) {
    return res.status(403).json({ error: "Platform owner only" });
  }
  next();
}

export const isOwner = (user) => !!user?.is_platform_owner;

export function rolesFor(user, instituteId) {
  if (!user) return [];
  return user.roles.filter((r) => r.institute_id === instituteId).map((r) => r.role);
}

/**
 * Data-isolation policy: the platform owner has NO access to a university's
 * operational data (members, logs, reports, imports, kiosk data). Owner rights
 * apply only to platform tables — universities, plans, payments, leads, settings.
 * These checks therefore never grant access just because someone is the owner.
 */
export const isStaff = (user, instituteId) => {
  if (!rolesFor(user, instituteId).some((r) => WRITE_ROLES.includes(r))) return false;
  return !accessFor(user, instituteId).viewer_only;
};

/** Anyone attached to the university may read reports (module rules apply after). */
export const canViewReports = (user, instituteId) => rolesFor(user, instituteId).length > 0;

/** University administrator of this institute. */
export const isInstituteAdmin = (user, instituteId) =>
  rolesFor(user, instituteId).includes("super_admin");

export const isMember = (user, instituteId) => rolesFor(user, instituteId).length > 0;


/**
 * Resolves the institute the request is acting on (header `x-institute-id`
 * or `?institute_id=`) and checks the caller belongs to it.
 */
export function withInstitute(check = isStaff) {
  return async (req, res, next) => {
    const id = req.headers["x-institute-id"] || req.query.institute_id || req.body?.institute_id;
    if (!id) return res.status(400).json({ error: "No university selected" });
    const inst = await one("SELECT * FROM institutes WHERE id = ?", [id]);
    if (!inst) return res.status(404).json({ error: "University not found" });
    if (!check(req.user, inst.id)) return res.status(403).json({ error: "Not allowed for this university" });
    req.institute = inst;
    req.access = accessFor(req.user, inst.id);
    next();
  };
}

export function subscriptionActive(inst) {
  const now = new Date().toISOString().slice(0, 10);
  return inst.subscription_start <= now && inst.subscription_end >= now;
}

/** Kiosk scanning is allowed only for an Active institute inside its subscription window. */
export function kioskEnabled(inst) {
  const status = inst.status || "Active";
  return status === "Active" && subscriptionActive(inst);
}


export async function logAudit(req, instituteId, action, table, targetId, details) {
  await q(
    `INSERT INTO audit_logs (id, institute_id, admin_id, admin_email, action, target_table, target_id, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuid(),
      instituteId ?? null,
      req.user?.id ?? null,
      req.user?.email ?? null,
      action,
      table ?? null,
      targetId ?? null,
      details ? JSON.stringify(details) : null,
    ],
  );
}
