/**
 * API management for a university administrator: issue, inspect, restrict,
 * regenerate and revoke the keys used by the published developer API, plus
 * the request log and usage figures.
 *
 * Only a university administrator may manage keys — an operator or report
 * viewer must never be able to mint a key that outranks their own account.
 */
import { Router } from "express";
import { q, one, uuid } from "../db.js";
import { requireAuth, withInstitute, isInstituteAdmin, logAudit } from "../auth.js";
import { mintKey, cleanScopes, parseScopes } from "../api-keys.js";
import { SCOPES, ENDPOINTS, ERRORS, AUTH_NOTE, curlFor } from "../api-spec.js";

const router = Router();
router.use(requireAuth);

/** Every route below is limited to the administrator of the active university. */
const adminOnly = withInstitute(isInstituteAdmin);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IP_RE = /^[0-9a-fA-F.:]+$/;

const shape = (row) => ({
  id: row.id,
  name: row.name,
  key_prefix: row.key_prefix,
  scopes: parseScopes(row.scopes),
  allow_pii: !!row.allow_pii,
  rate_limit_per_min: Number(row.rate_limit_per_min),
  status: row.status,
  expires_at: row.expires_at ? String(row.expires_at).slice(0, 10) : null,
  allowed_ips: row.allowed_ips || "",
  request_count: Number(row.request_count || 0),
  last_used_at: row.last_used_at,
  created_by: row.created_by,
  created_at: row.created_at,
  revoked_at: row.revoked_at,
});

/** Validate the editable fields shared by create and update. */
function readSettings(body, current = {}) {
  const scopes = cleanScopes(body.scopes ?? parseScopes(current.scopes));
  const limit = Math.min(6000, Math.max(1, Number(body.rate_limit_per_min ?? current.rate_limit_per_min ?? 120) || 120));

  let expires = body.expires_at === undefined ? (current.expires_at ? String(current.expires_at).slice(0, 10) : null) : body.expires_at;
  if (expires === "" || expires === null) expires = null;
  else if (!DATE_RE.test(expires)) return { error: "The expiry date must look like 2026-12-31" };

  const rawIps = body.allowed_ips === undefined ? current.allowed_ips || "" : String(body.allowed_ips);
  const ips = rawIps.split(/[\s,]+/).filter(Boolean);
  if (ips.some((ip) => !IP_RE.test(ip) || ip.length > 45)) {
    return { error: "The allowed IP list may only contain IP addresses, separated by commas" };
  }

  return {
    scopes,
    limit,
    expires,
    ips: ips.join(","),
    allowPii: body.allow_pii === undefined ? (current.allow_pii ? 1 : 0) : body.allow_pii ? 1 : 0,
  };
}

/* --------------------------- documentation ------------------------------ */

/** Rendered by the admin panel, so the docs always match the running server. */
router.get("/docs", (_req, res) => {
  res.json({
    version: "v1",
    base_path: "/api/v1",
    authentication: AUTH_NOTE,
    scopes: SCOPES,
    errors: ERRORS,
    endpoints: ENDPOINTS.map((e) => ({ ...e, example_curl: curlFor(e) })),
  });
});

/* -------------------------------- keys ---------------------------------- */

router.get("/", adminOnly, async (req, res) => {
  const rows = await q(
    "SELECT * FROM api_keys WHERE institute_id = ? ORDER BY status = 'Revoked', created_at DESC",
    [req.institute.id],
  );
  res.json({ keys: rows.map(shape), scopes: SCOPES });
});

router.post("/", adminOnly, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Give the key a name so you can recognise it later" });
  if (name.length > 120) return res.status(400).json({ error: "That name is too long" });

  const active = await one(
    "SELECT COUNT(*) AS n FROM api_keys WHERE institute_id = ? AND status = 'Active'",
    [req.institute.id],
  );
  if (Number(active?.n || 0) >= 25) {
    return res.status(400).json({ error: "You already have 25 active keys — revoke one before creating another" });
  }

  const settings = readSettings(req.body || {});
  if (settings.error) return res.status(400).json({ error: settings.error });
  if (!settings.scopes.length) return res.status(400).json({ error: "Choose at least one permission for this key" });

  const { plain, prefix, hash } = mintKey();
  const id = uuid();
  await q(
    `INSERT INTO api_keys
       (id, institute_id, name, key_prefix, key_hash, scopes, allow_pii, rate_limit_per_min, expires_at, allowed_ips, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, req.institute.id, name, prefix, hash, JSON.stringify(settings.scopes),
      settings.allowPii, settings.limit, settings.expires, settings.ips, req.user.email],
  );
  await logAudit(req, req.institute.id, "api_key.create", "api_keys", id, { name, scopes: settings.scopes });

  // The plain key is shown once and then never again.
  res.status(201).json({ id, key: plain, prefix });
});

router.patch("/:id", adminOnly, async (req, res) => {
  const key = await one("SELECT * FROM api_keys WHERE id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  if (!key) return res.status(404).json({ error: "Key not found" });

  const body = req.body || {};
  const settings = readSettings(body, key);
  if (settings.error) return res.status(400).json({ error: settings.error });
  if (!settings.scopes.length) return res.status(400).json({ error: "Choose at least one permission for this key" });

  const name = body.name === undefined ? key.name : String(body.name).trim().slice(0, 120);
  if (!name) return res.status(400).json({ error: "The key needs a name" });

  await q(
    `UPDATE api_keys SET name = ?, scopes = ?, allow_pii = ?, rate_limit_per_min = ?, expires_at = ?, allowed_ips = ?
      WHERE id = ? AND institute_id = ?`,
    [name, JSON.stringify(settings.scopes), settings.allowPii, settings.limit, settings.expires, settings.ips,
      key.id, req.institute.id],
  );
  await logAudit(req, req.institute.id, "api_key.update", "api_keys", key.id, { name, scopes: settings.scopes });
  res.json({ updated: true });
});

/** Revoke — the key stops working immediately, the log is kept. */
router.post("/:id/revoke", adminOnly, async (req, res) => {
  const key = await one("SELECT * FROM api_keys WHERE id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  if (!key) return res.status(404).json({ error: "Key not found" });
  await q("UPDATE api_keys SET status = 'Revoked', revoked_at = NOW() WHERE id = ?", [key.id]);
  await logAudit(req, req.institute.id, "api_key.revoke", "api_keys", key.id, { name: key.name });
  res.json({ revoked: true });
});

/** Regenerate — same settings, brand new secret; the old one stops working. */
router.post("/:id/regenerate", adminOnly, async (req, res) => {
  const key = await one("SELECT * FROM api_keys WHERE id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  if (!key) return res.status(404).json({ error: "Key not found" });

  const { plain, prefix, hash } = mintKey();
  await q(
    `UPDATE api_keys SET key_prefix = ?, key_hash = ?, status = 'Active', revoked_at = NULL,
        request_count = 0, last_used_at = NULL WHERE id = ?`,
    [prefix, hash, key.id],
  );
  await logAudit(req, req.institute.id, "api_key.regenerate", "api_keys", key.id, { name: key.name });
  res.json({ key: plain, prefix });
});

router.delete("/:id", adminOnly, async (req, res) => {
  const key = await one("SELECT id, name FROM api_keys WHERE id = ? AND institute_id = ?", [req.params.id, req.institute.id]);
  if (!key) return res.status(404).json({ error: "Key not found" });
  await q("DELETE FROM api_keys WHERE id = ?", [key.id]);
  await logAudit(req, req.institute.id, "api_key.delete", "api_keys", key.id, { name: key.name });
  res.json({ deleted: true });
});

/* ------------------------------- usage ---------------------------------- */

router.get("/logs", adminOnly, async (req, res) => {
  const where = ["institute_id = ?"];
  const args = [req.institute.id];

  const keyId = String(req.query.api_key_id || "").trim();
  if (keyId) { where.push("api_key_id = ?"); args.push(keyId); }
  for (const [param, op] of [["from", ">="], ["to", "<="]]) {
    const value = String(req.query[param] || "").trim();
    if (!value) continue;
    if (!DATE_RE.test(value)) return res.status(400).json({ error: `${param} must look like 2026-01-31` });
    where.push(`created_at ${op} ?`);
    args.push(param === "from" ? `${value} 00:00:00` : `${value} 23:59:59`);
  }
  if (String(req.query.failed_only || "") === "1") where.push("status_code >= 400");

  const clause = where.join(" AND ");
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const rows = await q(
    `SELECT id, key_prefix, method, path, status_code, duration_ms, ip, error, created_at
       FROM api_request_logs WHERE ${clause} ORDER BY created_at DESC LIMIT ${limit}`,
    args,
  );
  res.json({ logs: rows });
});

/** Small summary shown above the key list. */
router.get("/usage", adminOnly, async (req, res) => {
  const [totals, daily, top] = await Promise.all([
    one(
      `SELECT COUNT(*) AS calls,
              SUM(status_code >= 400) AS failures,
              ROUND(AVG(duration_ms)) AS avg_ms
         FROM api_request_logs
        WHERE institute_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      [req.institute.id],
    ),
    q(
      `SELECT DATE(created_at) AS day, COUNT(*) AS calls
         FROM api_request_logs
        WHERE institute_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
        GROUP BY DATE(created_at) ORDER BY day`,
      [req.institute.id],
    ),
    q(
      `SELECT path, COUNT(*) AS calls FROM api_request_logs
        WHERE institute_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY path ORDER BY calls DESC LIMIT 8`,
      [req.institute.id],
    ),
  ]);
  res.json({
    calls_30d: Number(totals?.calls || 0),
    failures_30d: Number(totals?.failures || 0),
    avg_ms: Number(totals?.avg_ms || 0),
    daily,
    top_endpoints: top,
  });
});

export default router;
