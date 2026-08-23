/**
 * Master Setting — permission model.
 *
 * The University Administrator (role `super_admin`) always has full access to
 * their own university. Every other account can be limited to:
 *   - a set of modules (module-wise permission),
 *   - a set of sublibraries / locations / kiosks (location-wise access),
 *   - viewer-only mode (no create / edit / delete anywhere),
 *   - bulk upload and export switches.
 *
 * The envelope lives in `user_access` (+ the three mapping tables). Accounts
 * created before Master Setting existed have no row and stay unrestricted so
 * nothing breaks on upgrade.
 */
import { q } from "./db.js";

export const MODULES = [
  { key: "dashboard", label: "Dashboard" },
  { key: "members", label: "Member management" },
  { key: "entry_exit", label: "Entry / exit register" },
  { key: "reports", label: "Reports" },
  { key: "kiosks", label: "Kiosk settings" },
  { key: "master_data", label: "Master data (courses, departments, years)" },
  { key: "master_setting", label: "Master setting (users & sublibraries)" },
  { key: "audit", label: "Audit trail" },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);

/** Roles that may create / edit / delete inside a university. */
export const WRITE_ROLES = ["super_admin", "librarian", "sublibrary_admin", "operator"];
/** Roles that own the whole university (Master Setting, staff, billing view). */
export const ADMIN_ROLES = ["super_admin"];

export const ROLE_PRESETS = {
  super_admin: { label: "University administrator", modules: MODULE_KEYS, viewer_only: 0, allow_bulk_upload: 1, allow_export: 1 },
  librarian: { label: "Library manager", modules: MODULE_KEYS.filter((m) => m !== "master_setting"), viewer_only: 0, allow_bulk_upload: 1, allow_export: 1 },
  sublibrary_admin: { label: "Sublibrary administrator", modules: ["dashboard", "members", "entry_exit", "reports", "kiosks"], viewer_only: 0, allow_bulk_upload: 1, allow_export: 1 },
  operator: { label: "Kiosk operator", modules: ["dashboard", "entry_exit"], viewer_only: 0, allow_bulk_upload: 0, allow_export: 0 },
  report_viewer: { label: "Report viewer", modules: ["dashboard", "reports"], viewer_only: 1, allow_bulk_upload: 0, allow_export: 1 },
  viewer: { label: "Viewer only", modules: ["dashboard"], viewer_only: 1, allow_bulk_upload: 0, allow_export: 0 },
};

const parseModules = (raw) => {
  if (!raw) return null;
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((m) => MODULE_KEYS.includes(m)) : null;
  } catch {
    return null;
  }
};

/** Loads every access row of a user, keyed by institute id. */
export async function loadAccess(userId) {
  const [rows, libs, locs, kiosks] = await Promise.all([
    q("SELECT * FROM user_access WHERE user_id = ?", [userId]),
    q("SELECT institute_id, sublibrary_id FROM user_sublibraries WHERE user_id = ?", [userId]),
    q("SELECT institute_id, location FROM user_locations WHERE user_id = ?", [userId]),
    q(
      `SELECT k.institute_id, k.id, k.device_id FROM user_kiosks u
       JOIN kiosk_devices k ON k.id = u.kiosk_id WHERE u.user_id = ?`,
      [userId],
    ),
  ]);
  const map = new Map();
  for (const r of rows) {
    map.set(r.institute_id, {
      configured: true,
      viewer_only: !!Number(r.viewer_only),
      allow_bulk_upload: !!Number(r.allow_bulk_upload),
      allow_export: !!Number(r.allow_export),
      modules: parseModules(r.modules),
      sublibraries: [],
      locations: [],
      kiosks: [],
      kiosk_ids: [],
    });
  }
  for (const r of libs) map.get(r.institute_id)?.sublibraries.push(r.sublibrary_id);
  for (const r of locs) map.get(r.institute_id)?.locations.push(r.location);
  for (const r of kiosks) {
    const a = map.get(r.institute_id);
    if (!a) continue;
    a.kiosks.push(r.device_id);
    a.kiosk_ids.push(r.id);
  }
  return map;
}

const FULL = {
  configured: false,
  admin: true,
  viewer_only: false,
  allow_bulk_upload: true,
  allow_export: true,
  modules: null, // null = every module
  sublibraries: null, // null = every sublibrary
  locations: null,
  kiosks: null, // null = every kiosk
  kiosk_ids: null,
};

/** The effective permission envelope of `user` inside `instituteId`. */
export function accessFor(user, instituteId) {
  if (!user) return { ...FULL, admin: false, modules: [], kiosks: [] };
  const roles = (user.roles || []).filter((r) => r.institute_id === instituteId).map((r) => r.role);
  if (roles.includes("super_admin")) return { ...FULL, roles };
  const row = user.access?.get(instituteId);
  if (!row) return { ...FULL, admin: false, roles }; // legacy account — unrestricted
  return {
    ...row,
    admin: false,
    roles,
    sublibraries: row.sublibraries.length ? row.sublibraries : null,
    locations: row.locations.length ? row.locations : null,
    kiosks: row.kiosks.length ? row.kiosks : null,
    kiosk_ids: row.kiosk_ids.length ? row.kiosk_ids : null,
  };
}

export const hasModule = (access, key) => !access.modules || access.modules.includes(key);
export const canWrite = (access) => !access.viewer_only;

/** Express guard: the request needs a module permission (after withInstitute). */
export const requireModule = (key) => (req, res, next) => {
  if (!req.access || hasModule(req.access, key)) return next();
  res.status(403).json({ error: "You do not have access to this section" });
};

/** Express guard: blocks viewer-only accounts from write requests. */
export function requireWrite(req, res, next) {
  const readOnly = req.method === "GET" || req.method === "HEAD";
  if (readOnly || !req.access || canWrite(req.access)) return next();
  res.status(403).json({ error: "Your account is viewer-only" });
}

export function requireBulk(req, res, next) {
  if (!req.access || req.access.allow_bulk_upload) return next();
  res.status(403).json({ error: "Bulk upload is not enabled for your account" });
}

export function requireExport(req, res, next) {
  const wantsExport = String(req.query?.export || "") === "1";
  if (!wantsExport || !req.access || req.access.allow_export) return next();
  res.status(403).json({ error: "Downloads are not enabled for your account" });
}

export function requireInstituteAdmin(req, res, next) {
  if (req.access?.admin) return next();
  res.status(403).json({ error: "University administrator only" });
}

/**
 * SQL fragment restricting rows to the kiosks a user may see.
 * `column` is the device_id column (e.g. "l.device_id").
 */
export function kioskScope(access, column) {
  if (!access || access.kiosks === null || access.admin) return { sql: "", params: [] };
  if (!access.kiosks.length) return { sql: " AND 1 = 0", params: [] };
  return {
    sql: ` AND ${column} IN (${access.kiosks.map(() => "?").join(",")})`,
    params: [...access.kiosks],
  };
}
