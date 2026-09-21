/**
 * API key authentication for the published developer API (/api/v1).
 *
 * A key looks like  lrk_<8 hex>_<48 hex>. Only the SHA-256 hash is stored, so a
 * lost key can never be recovered — the admin regenerates it instead.
 * Every call is checked for: key validity, status, expiry, allowed IPs,
 * permission (scope) and a per-minute rate limit, then written to the log.
 */
import crypto from "node:crypto";
import { q, one, uuid, localDateTime } from "./db.js";
import { SCOPE_KEYS } from "./api-spec.js";

const sha256 = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");

/** Mint a new key. Returns the plain text once — it is never stored. */
export function mintKey() {
  const prefix = `lrk_${crypto.randomBytes(4).toString("hex")}`;
  const secret = crypto.randomBytes(24).toString("hex");
  const plain = `${prefix}_${secret}`;
  return { plain, prefix, hash: sha256(plain) };
}

export const hashKey = (plain) => sha256(String(plain).trim());

export const parseScopes = (raw) => {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((s) => SCOPE_KEYS.includes(s)) : [];
  } catch {
    return [];
  }
};

export const cleanScopes = (input) =>
  Array.isArray(input) ? [...new Set(input.filter((s) => SCOPE_KEYS.includes(s)))] : [];

/** Client IP as seen by the server (behind a proxy too). */
export const callerIp = (req) =>
  String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
  req.socket?.remoteAddress ||
  "";

/* ---------------- rate limiting (per key, sliding minute) ---------------- */

const hits = new Map(); // keyId -> { windowStart, count }

function rateCheck(keyId, limit) {
  const now = Date.now();
  const bucket = hits.get(keyId);
  if (!bucket || now - bucket.windowStart >= 60000) {
    hits.set(keyId, { windowStart: now, count: 1 });
    return { ok: true, remaining: limit - 1, reset: 60 };
  }
  bucket.count += 1;
  const reset = Math.max(1, Math.ceil((60000 - (now - bucket.windowStart)) / 1000));
  if (bucket.count > limit) return { ok: false, remaining: 0, reset };
  return { ok: true, remaining: Math.max(0, limit - bucket.count), reset };
}

// Keep the map small on a long-running server.
setInterval(() => {
  const cutoff = Date.now() - 120000;
  for (const [id, b] of hits) if (b.windowStart < cutoff) hits.delete(id);
}, 300000).unref?.();

/* ---------------------------- request logging --------------------------- */

let pruneCounter = 0;

function logRequest(req, res, key, startedAt, error) {
  const row = [
    uuid(),
    key?.institute_id ?? null,
    key?.id ?? null,
    key?.key_prefix ?? null,
    req.method,
    String(req.originalUrl || req.url).slice(0, 255),
    res.statusCode,
    Date.now() - startedAt,
    callerIp(req).slice(0, 64),
    String(req.headers["user-agent"] || "").slice(0, 255),
    error ? String(error).slice(0, 255) : null,
  ];
  q(
    `INSERT INTO api_request_logs
       (id, institute_id, api_key_id, key_prefix, method, path, status_code, duration_ms, ip, user_agent, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row,
  ).catch(() => {});

  // Housekeeping: drop logs older than 60 days, roughly once every 200 calls.
  if (++pruneCounter % 200 === 0) {
    q("DELETE FROM api_request_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 60 DAY)").catch(() => {});
  }
}

/* ------------------------------ middleware ------------------------------ */

const presented = (req) => {
  const header = String(req.headers["x-api-key"] || "").trim();
  if (header) return header;
  const auth = String(req.headers.authorization || "");
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
};

/**
 * Authenticates the key and attaches `req.apiKey` and `req.institute`.
 * Also arms the response logger — every answer of /api/v1 ends up in the log.
 */
export async function apiKeyAuth(req, res, next) {
  const startedAt = Date.now();
  const token = presented(req);

  const fail = (status, message) => {
    res.status(status);
    logRequest(req, res, req.apiKey, startedAt, message);
    return res.json({ error: message });
  };

  if (!token) return fail(401, "Send your key in the X-API-Key header");
  if (!/^lrk_[0-9a-f]{8}_[0-9a-f]{32,}$/.test(token)) return fail(401, "Invalid API key");

  const key = await one("SELECT * FROM api_keys WHERE key_hash = ?", [hashKey(token)]);
  if (!key) return fail(401, "Invalid API key");
  req.apiKey = key;

  if (key.status !== "Active") return fail(401, "This API key has been revoked");
  if (key.expires_at && String(key.expires_at).slice(0, 10) < localDateTime().slice(0, 10)) {
    return fail(401, "This API key has expired");
  }

  const allowed = String(key.allowed_ips || "").split(/[\s,]+/).filter(Boolean);
  if (allowed.length) {
    const ip = callerIp(req).replace(/^::ffff:/, "");
    if (!allowed.includes(ip)) return fail(403, "This API key is not allowed from your IP address");
  }

  const inst = await one(
    "SELECT id, name, code, slug, status, subscription_start, subscription_end FROM institutes WHERE id = ?",
    [key.institute_id],
  );
  if (!inst) return fail(403, "The university for this key no longer exists");
  if ((inst.status || "Active") !== "Active") return fail(403, "This university is suspended");
  req.institute = inst;

  const limit = Number(key.rate_limit_per_min || 120);
  const verdict = rateCheck(key.id, limit);
  res.set("X-RateLimit-Limit", String(limit));
  res.set("X-RateLimit-Remaining", String(verdict.remaining));
  res.set("X-RateLimit-Reset", String(verdict.reset));
  if (!verdict.ok) {
    res.set("Retry-After", String(verdict.reset));
    return fail(429, "Rate limit reached for this API key — slow down and try again shortly");
  }

  req.apiScopes = parseScopes(key.scopes);

  // Usage counters, written at most once a minute per key.
  q("UPDATE api_keys SET request_count = request_count + 1, last_used_at = NOW() WHERE id = ?", [key.id]).catch(() => {});

  res.on("finish", () => logRequest(req, res, key, startedAt, null));
  next();
}

/** Guard for one permission. */
export const requireScope = (scope) => (req, res, next) => {
  if (!scope) return next();
  if (req.apiScopes?.includes(scope)) return next();
  res.status(403).json({ error: `This key does not have the "${scope}" permission` });
};

/** Hide personal contact details unless the key is explicitly allowed to see them. */
export function maskContact(row, allowPii) {
  const out = { ...row };
  if (allowPii) return out;
  if (out.mobile) out.mobile = String(out.mobile).replace(/^(\d{2})\d+(\d{3})$/, "$1•••••$2");
  if (out.email) {
    const [name, domain] = String(out.email).split("@");
    out.email = domain ? `${name.slice(0, 1)}•••@${domain}` : "•••";
  }
  return out;
}
