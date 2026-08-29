/**
 * Version helpers shared by the updater and the GitHub update checker.
 *
 * The installed version is normally the one in package.json, but an upgrade
 * installed from GitHub (or from an uploaded ZIP) records the version it put in
 * place in `platform_settings.installed_version`, so the owner console keeps
 * showing the right number even when the running files report an older tag.
 */
import { q, one } from "./db.js";

/** "V3.10.0" -> [3, 10, 0] */
export function parseVersion(value) {
  const cleaned = String(value ?? "").trim().replace(/^[vV]/, "");
  const [core] = cleaned.split(/[-+]/);
  const parts = core.split(".").map((n) => Number.parseInt(n, 10));
  return [0, 1, 2].map((i) => (Number.isFinite(parts[i]) ? parts[i] : 0));
}

/** -1 when a < b, 0 when equal, 1 when a > b. */
export function compareVersions(a, b) {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (av[i] !== bv[i]) return av[i] < bv[i] ? -1 : 1;
  }
  return 0;
}

export const isNewer = (candidate, installed) => compareVersions(candidate, installed) > 0;

/** Normalised "3.10.0" string, or null when the value carries no digits. */
export const normalizeVersion = (value) => {
  const s = String(value ?? "").trim();
  if (!/\d/.test(s)) return null;
  return parseVersion(s).join(".");
};

export const getSetting = async (key) => {
  const row = await one("SELECT setting_value FROM platform_settings WHERE setting_key = ?", [key]);
  return row?.setting_value ?? null;
};

export const setSetting = async (key, value) => {
  await q(
    `INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [key, value == null ? null : String(value)],
  );
};

/** Remember the version an upgrade just installed. */
export async function recordInstalledVersion(value) {
  const v = normalizeVersion(value);
  if (v) await setSetting("installed_version", v);
  return v;
}

/** Version stored by the last successful upgrade, if any. */
export const storedVersion = () => getSetting("installed_version");
