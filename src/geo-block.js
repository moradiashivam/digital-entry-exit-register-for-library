/**
 * Platform-wide country restriction (Owner side).
 *
 * The owner decides in which countries the application may be used. Two modes:
 *   block  — everybody may use the app except the selected countries
 *   allow  — only the selected countries may use the app
 *
 * This is a platform layer and runs before the per-university geography / IP
 * checks in net-access.js. When it is disabled (the default) nothing changes.
 */
import { q, one } from "./db.js";
import { clientIp, lookupGeo, isPrivateIp } from "./net-access.js";

export const DEFAULT_GEO_BLOCK_MESSAGE =
  "Access denied. This service is not available in your country.";

/** ISO 3166-1 alpha-2 codes; names come from the runtime so no list to maintain. */
const CODES = ("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ "
  + "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR "
  + "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP "
  + "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ "
  + "NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW "
  + "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ "
  + "UA UG US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW").split(/\s+/);

let namer = null;
try {
  namer = new Intl.DisplayNames(["en"], { type: "region" });
} catch { /* fall back to the code itself */ }

export const COUNTRIES = CODES
  .map((code) => ({ code, name: (namer && namer.of(code)) || code }))
  .sort((a, b) => a.name.localeCompare(b.name));

const NAME_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c.name.toLowerCase()]));

/* ------------------------------------------------------------------ *
 * Configuration (platform_settings)                                   *
 * ------------------------------------------------------------------ */

const KEY = {
  enabled: "geo_block_enabled",
  mode: "geo_block_mode",
  countries: "geo_block_countries",
  message: "geo_block_message",
  allowPrivate: "geo_block_allow_private",
  failOpen: "geo_block_fail_open",
};

const readSetting = async (key) => {
  const row = await one("SELECT setting_value FROM platform_settings WHERE setting_key = ?", [key]);
  return row?.setting_value ?? null;
};

const writeSetting = (key, value) =>
  q(
    `INSERT INTO platform_settings (setting_key, setting_value) VALUES (?,?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [key, String(value)],
  );

const cleanCodes = (input) => {
  const list = Array.isArray(input) ? input : String(input || "").split(/[,\s]+/);
  const valid = new Set(CODES);
  return [...new Set(list.map((c) => String(c || "").trim().toUpperCase()).filter((c) => valid.has(c)))];
};

/** Current configuration, with safe defaults when nothing was saved yet. */
export async function getGeoBlock() {
  const [enabled, mode, countries, message, allowPrivate, failOpen] = await Promise.all(
    [KEY.enabled, KEY.mode, KEY.countries, KEY.message, KEY.allowPrivate, KEY.failOpen].map(readSetting),
  );
  let list = [];
  try { list = cleanCodes(JSON.parse(countries || "[]")); } catch { list = cleanCodes(countries); }
  return {
    enabled: enabled === "1",
    mode: mode === "allow" ? "allow" : "block",
    countries: list,
    message: message || DEFAULT_GEO_BLOCK_MESSAGE,
    allow_private: allowPrivate !== "0",
    fail_open: failOpen !== "0",
  };
}

export async function saveGeoBlock(patch) {
  await writeSetting(KEY.enabled, patch.enabled ? 1 : 0);
  await writeSetting(KEY.mode, patch.mode === "allow" ? "allow" : "block");
  await writeSetting(KEY.countries, JSON.stringify(cleanCodes(patch.countries)));
  await writeSetting(KEY.message, String(patch.message || DEFAULT_GEO_BLOCK_MESSAGE).slice(0, 400));
  await writeSetting(KEY.allowPrivate, patch.allow_private === false ? 0 : 1);
  await writeSetting(KEY.fail_open, patch.fail_open === false ? 0 : 1);
  cache = null;
  return getGeoBlock();
}

/* ------------------------------------------------------------------ *
 * Enforcement                                                         *
 * ------------------------------------------------------------------ */

let cache = null; // { at, config }
const CACHE_MS = 60_000;

async function config() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.config;
  const cfg = await getGeoBlock();
  cache = { at: Date.now(), config: cfg };
  return cfg;
}

const matches = (cfg, geo) => {
  const code = String(geo.country_code || "").toUpperCase();
  if (code) return cfg.countries.includes(code);
  const name = String(geo.country || "").trim().toLowerCase();
  return !!name && cfg.countries.some((c) => NAME_BY_CODE.get(c) === name);
};

/** Decides whether one request may use the application at all. */
export async function checkCountry(req) {
  let cfg;
  try { cfg = await config(); } catch { return { allowed: true }; }
  if (!cfg.enabled || !cfg.countries.length) return { allowed: true, config: cfg };

  const ip = clientIp(req);
  if (isPrivateIp(ip)) return { allowed: cfg.allow_private !== false, config: cfg, ip, reason: "local network" };

  const geo = await lookupGeo(ip);
  if (geo.failed) return { allowed: cfg.fail_open !== false, config: cfg, ip, geo, reason: "location unknown" };

  const hit = matches(cfg, geo);
  const allowed = cfg.mode === "allow" ? hit : !hit;
  return { allowed, config: cfg, ip, geo };
}

const EXEMPT = [
  "/api/health",
  "/api/owner",       // the owner must always be able to change the rule back
  "/api/auth",        // sign-in is needed to reach the owner console
];

/**
 * Express middleware. Signed-in platform owners and the owner APIs are never
 * blocked, so a mistake can always be undone.
 */
export async function countryGuard(req, res, next) {
  try {
    if (req.user?.is_platform_owner) return next();
    if (EXEMPT.some((p) => req.path === p || req.path.startsWith(`${p}/`))) return next();

    const verdict = await checkCountry(req);
    if (verdict.allowed) return next();

    const message = verdict.config?.message || DEFAULT_GEO_BLOCK_MESSAGE;
    if (req.path.startsWith("/api/")) {
      return res.status(403).json({ error: message, country_blocked: true });
    }
    return res.status(403).type("html").send(deniedPage(message));
  } catch {
    next();
  }
}

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function deniedPage(message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex" /><title>Access denied</title>
<style>
 body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f7fb;
   font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1f2937;padding:1.5rem}
 .card{max-width:32rem;background:#fff;border:1px solid #e5e7eb;border-radius:16px;
   padding:2rem;text-align:center;box-shadow:0 12px 40px rgba(15,23,42,.08)}
 h1{margin:.2rem 0 .8rem;font-size:1.4rem} p{margin:0;line-height:1.6;color:#4b5563}
 .icon{font-size:2.4rem}
</style></head><body><div class="card">
 <div class="icon">&#128683;</div><h1>Access denied</h1><p>${escape(message)}</p>
</div></body></html>`;
}
