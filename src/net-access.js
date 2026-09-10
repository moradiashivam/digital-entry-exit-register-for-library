/**
 * University Access Control — geographical (owner) + IP address (university).
 *
 * Order of checks:  owner geography  →  university IP list  →  application.
 * A university without a configuration row is unrestricted, so upgrading an
 * existing installation never locks anybody out.
 */
import { q, one, uuid } from "./db.js";

export const DENY_MESSAGE =
  "Access denied. You are not accessing the system from an authorized location or IP address.";

/* ------------------------------------------------------------------ *
 * Client IP                                                           *
 * ------------------------------------------------------------------ */

/** Real client IP, honouring one reverse proxy (X-Forwarded-For). */
export function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const raw = fwd || req.ip || req.socket?.remoteAddress || "";
  return normaliseIp(raw);
}

export function normaliseIp(raw) {
  let ip = String(raw || "").trim();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  if (ip === "::1") ip = "127.0.0.1";
  return ip;
}

const v4 = (ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip);
const toLong = (ip) => ip.split(".").reduce((acc, part) => acc * 256 + (Number(part) & 255), 0);

/** True for loopback / LAN addresses, where public geo lookup is meaningless. */
export function isPrivateIp(ip) {
  if (!ip) return true;
  if (!v4(ip)) return ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80");
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/**
 * Matches an IP against one rule. Supported forms:
 *   203.0.113.7            single address (IPv4 or IPv6 exact text)
 *   203.0.113.0/24         CIDR block
 *   203.0.113.1-203.0.113.50   range
 *   203.0.113.*            wildcard
 */
export function ipMatches(ip, rule) {
  const value = String(rule || "").trim();
  if (!ip || !value) return false;
  if (value.includes("/")) {
    const [base, bitsRaw] = value.split("/");
    const bits = Number(bitsRaw);
    if (!v4(ip) || !v4(base) || !Number.isFinite(bits) || bits < 0 || bits > 32) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (toLong(ip) & mask) === (toLong(base) & mask);
  }
  if (value.includes("-")) {
    const [from, to] = value.split("-").map((s) => s.trim());
    if (!v4(ip) || !v4(from) || !v4(to)) return false;
    const n = toLong(ip);
    return n >= toLong(from) && n <= toLong(to);
  }
  if (value.includes("*")) {
    const re = new RegExp(`^${value.split(".").map((p) => (p === "*" ? "\\d{1,3}" : p.replace(/[^\d]/g, ""))).join("\\.")}$`);
    return re.test(ip);
  }
  return normaliseIp(value).toLowerCase() === ip.toLowerCase();
}

/** Basic validation for the admin panel. */
export function validIpRule(value) {
  const v = String(value || "").trim();
  if (!v || v.length > 120) return false;
  if (v.includes("/")) {
    const [base, bits] = v.split("/");
    return v4(base) && Number.isFinite(Number(bits)) && Number(bits) >= 0 && Number(bits) <= 32;
  }
  if (v.includes("-")) {
    const [a, b] = v.split("-").map((s) => s.trim());
    return v4(a) && v4(b) && toLong(a) <= toLong(b);
  }
  if (v.includes("*")) return /^(\d{1,3}|\*)(\.(\d{1,3}|\*)){3}$/.test(v);
  return v4(v) || /^[0-9a-fA-F:]{3,}$/.test(v);
}

/* ------------------------------------------------------------------ *
 * Geo lookup (cached, never blocks the request for long)              *
 * ------------------------------------------------------------------ */

const geoCache = new Map(); // ip -> { at, geo }
const GEO_TTL = Number(process.env.GEOIP_TTL_MS || 6 * 60 * 60 * 1000);
const GEO_TIMEOUT = Number(process.env.GEOIP_TIMEOUT_MS || 4000);
const GEO_URL = process.env.GEOIP_URL
  || "http://ip-api.com/json/{ip}?fields=status,country,countryCode,regionName,city,query";

export async function lookupGeo(ip) {
  if (!ip || isPrivateIp(ip)) return { private: true };
  const hit = geoCache.get(ip);
  if (hit && Date.now() - hit.at < GEO_TTL) return hit.geo;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEO_TIMEOUT);
  try {
    const resp = await fetch(GEO_URL.replace("{ip}", encodeURIComponent(ip)), { signal: controller.signal });
    const data = await resp.json();
    const geo = data && (data.status === "success" || data.country)
      ? {
        country: data.country || "",
        country_code: String(data.countryCode || data.country_code || "").toUpperCase(),
        state: data.regionName || data.region || "",
        city: data.city || "",
      }
      : { failed: true };
    geoCache.set(ip, { at: Date.now(), geo });
    return geo;
  } catch {
    const geo = { failed: true };
    geoCache.set(ip, { at: Date.now(), geo });
    return geo;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * Configuration                                                       *
 * ------------------------------------------------------------------ */

export const splitList = (raw) =>
  String(raw || "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const inList = (list, value) => !list.length || list.some((item) => same(item, value));

export async function getAccessConfig(instituteId) {
  const row = await one("SELECT * FROM institute_access_control WHERE institute_id = ?", [instituteId]);
  const rules = await q(
    "SELECT id, label, value, active, created_at FROM institute_ip_rules WHERE institute_id = ? ORDER BY created_at",
    [instituteId],
  );
  return {
    institute_id: instituteId,
    geo_enabled: !!Number(row?.geo_enabled || 0),
    geo_countries: row?.geo_countries || "",
    geo_states: row?.geo_states || "",
    geo_cities: row?.geo_cities || "",
    geo_note: row?.geo_note || "",
    geo_allow_private: row ? !!Number(row.geo_allow_private) : true,
    geo_fail_open: row ? !!Number(row.geo_fail_open) : true,
    ip_enabled: !!Number(row?.ip_enabled || 0),
    ip_mode: row?.ip_mode === "selected" ? "selected" : "all",
    rules,
  };
}

export async function saveGeoConfig(instituteId, patch) {
  await q(
    `INSERT INTO institute_access_control
       (institute_id, geo_enabled, geo_countries, geo_states, geo_cities, geo_note, geo_allow_private, geo_fail_open)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE geo_enabled = VALUES(geo_enabled), geo_countries = VALUES(geo_countries),
       geo_states = VALUES(geo_states), geo_cities = VALUES(geo_cities), geo_note = VALUES(geo_note),
       geo_allow_private = VALUES(geo_allow_private), geo_fail_open = VALUES(geo_fail_open)`,
    [
      instituteId,
      patch.geo_enabled ? 1 : 0,
      splitList(patch.geo_countries).join(", "),
      splitList(patch.geo_states).join(", "),
      splitList(patch.geo_cities).join(", "),
      String(patch.geo_note || "").slice(0, 255),
      patch.geo_allow_private === false ? 0 : 1,
      patch.geo_fail_open === false ? 0 : 1,
    ],
  );
  return getAccessConfig(instituteId);
}

export async function saveIpConfig(instituteId, patch) {
  await q(
    `INSERT INTO institute_access_control (institute_id, ip_enabled, ip_mode)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE ip_enabled = VALUES(ip_enabled), ip_mode = VALUES(ip_mode)`,
    [instituteId, patch.ip_enabled ? 1 : 0, patch.ip_mode === "selected" ? "selected" : "all"],
  );
  return getAccessConfig(instituteId);
}

export async function addIpRule(instituteId, value, label) {
  const id = uuid();
  await q("INSERT INTO institute_ip_rules (id, institute_id, label, value) VALUES (?, ?, ?, ?)", [
    id,
    instituteId,
    String(label || "").slice(0, 120) || null,
    String(value).trim(),
  ]);
  return id;
}

export async function updateIpRule(instituteId, id, patch) {
  await q(
    "UPDATE institute_ip_rules SET label = ?, value = ?, active = ? WHERE id = ? AND institute_id = ?",
    [String(patch.label || "").slice(0, 120) || null, String(patch.value).trim(), patch.active === false ? 0 : 1, id, instituteId],
  );
}

export const removeIpRule = (instituteId, id) =>
  q("DELETE FROM institute_ip_rules WHERE id = ? AND institute_id = ?", [id, instituteId]);

/* ------------------------------------------------------------------ *
 * The check                                                           *
 * ------------------------------------------------------------------ */

/**
 * Evaluates both layers for one university.
 * Returns { allowed, reason, layer, ip, geo, config }.
 */
export async function evaluateAccess(instituteId, req) {
  const ip = clientIp(req);
  let config;
  try {
    config = await getAccessConfig(instituteId);
  } catch {
    return { allowed: true, ip, skipped: true }; // table not created yet
  }

  // 1 — Owner geographical layer.
  if (config.geo_enabled) {
    const countries = splitList(config.geo_countries);
    const states = splitList(config.geo_states);
    const cities = splitList(config.geo_cities);
    if (countries.length || states.length || cities.length) {
      const geo = await lookupGeo(ip);
      if (geo.private) {
        if (!config.geo_allow_private) {
          return { allowed: false, layer: "geo", ip, geo, reason: "Location could not be verified for this network", config };
        }
      } else if (geo.failed) {
        if (!config.geo_fail_open) {
          return { allowed: false, layer: "geo", ip, geo, reason: "Location could not be verified", config };
        }
      } else if (!(inList(countries, geo.country) && inList(states, geo.state) && inList(cities, geo.city))) {
        return {
          allowed: false,
          layer: "geo",
          ip,
          geo,
          reason: `Sign-in from ${[geo.city, geo.state, geo.country].filter(Boolean).join(", ") || "this location"} is not permitted`,
          config,
        };
      }
    }
  }

  // 2 — University IP layer.
  if (config.ip_enabled && config.ip_mode === "selected") {
    const active = config.rules.filter((r) => Number(r.active));
    if (!active.some((r) => ipMatches(ip, r.value))) {
      return { allowed: false, layer: "ip", ip, reason: `IP address ${ip || "unknown"} is not in the permitted list`, config };
    }
  }

  return { allowed: true, ip, config };
}

/** Every university the user belongs to; used at sign-in. */
export async function evaluateLoginAccess(userId, req) {
  const roles = await q("SELECT DISTINCT institute_id FROM user_roles WHERE user_id = ?", [userId]);
  if (!roles.length) return { allowed: true, ip: clientIp(req) };
  const results = [];
  for (const r of roles) results.push(await evaluateAccess(r.institute_id, req));
  const ok = results.find((x) => x.allowed);
  if (ok) return ok;
  return results[0];
}
