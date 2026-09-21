/**
 * Health / system status — deliberately open (no sign-in) so a university
 * administrator can check the server from any computer, even when the
 * database is down and nobody can sign in.
 *
 * Nothing sensitive is returned: no host names, users, passwords or record
 * counts — only up / down / warning for each part of the system.
 */
import { Router } from "express";
import { pool, hasDbConfig } from "../db.js";
import { setupComplete } from "../setup.js";
import { storedVersion } from "../version.js";

const router = Router();

const now = () => {
  const d = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** Slow but working counts as a warning, not a failure. */
const SLOW_MS = 1200;

async function timed(fn) {
  const started = Date.now();
  try {
    const value = await fn();
    return { ms: Date.now() - started, value };
  } catch (e) {
    return { ms: Date.now() - started, error: e?.message || "Failed" };
  }
}

/** Turn a technical error into something an administrator can act on. */
function friendly(message = "") {
  const m = String(message);
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(m)) return "The MySQL server is not responding. Check that MySQL is running.";
  if (/Access denied/i.test(m)) return "MySQL refused the sign-in details saved for this application.";
  if (/Unknown database/i.test(m)) return "The application database does not exist yet.";
  if (/PROTOCOL_CONNECTION_LOST|ECONNRESET/i.test(m)) return "The connection to MySQL dropped. It may be restarting.";
  return "The database could not be reached.";
}

router.get("/", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: process.env.DB_NAME });
  } catch (e) {
    res.status(503).json({ ok: false, error: friendly(e.message) });
  }
});

/** Full status used by the public Health page. */
router.get("/status", async (req, res) => {
  const startedAt = Date.now();
  const configured = hasDbConfig() && setupComplete();

  const ping = configured ? await timed(() => pool.query("SELECT 1")) : { ms: 0, error: "Not set up yet" };
  const dbUp = !ping.error;

  let server = { ms: 0, error: dbUp ? null : ping.error };
  let uptimeSeconds = null;
  let threads = null;
  if (dbUp) {
    server = await timed(async () => {
      const [[ver]] = await pool.query("SELECT VERSION() AS v");
      const [status] = await pool.query(
        "SHOW GLOBAL STATUS WHERE Variable_name IN ('Uptime','Threads_connected')",
      );
      for (const row of status) {
        if (row.Variable_name === "Uptime") uptimeSeconds = Number(row.Value);
        if (row.Variable_name === "Threads_connected") threads = Number(row.Value);
      }
      return ver?.v || "";
    });
  }

  const version = (dbUp ? await storedVersion().catch(() => null) : null) || process.env.npm_package_version || "1.0.0";
  const responseMs = Date.now() - startedAt;

  const stateOf = (up, slow) => (!up ? "down" : slow ? "warning" : "up");

  const checks = [
    {
      key: "application",
      label: "Application",
      status: "up",
      detail: `Running, version ${version}`,
    },
    {
      key: "database",
      label: "Database connection",
      status: !configured ? "warning" : stateOf(dbUp, ping.ms > SLOW_MS),
      detail: !configured
        ? "Database details are not saved yet — finish the setup wizard."
        : dbUp
          ? `Connected in ${ping.ms} ms`
          : friendly(ping.error),
    },
    {
      key: "mysql",
      label: "MySQL server",
      status: !configured ? "warning" : !dbUp ? "down" : server.error ? "warning" : "up",
      detail: !configured
        ? "Waiting for the database details from the setup wizard."
        : !dbUp
          ? "Not reachable"
        : server.error
          ? "Reachable, but the server status could not be read."
          : `MySQL ${server.value}` +
            (uptimeSeconds !== null ? ` · running for ${Math.floor(uptimeSeconds / 3600)} h` : "") +
            (threads !== null ? ` · ${threads} open connections` : ""),
    },
    {
      key: "api",
      label: "API service",
      status: stateOf(true, responseMs > SLOW_MS),
      detail: responseMs > SLOW_MS ? `Answering slowly (${responseMs} ms)` : `Answering normally (${responseMs} ms)`,
    },
  ];

  const worst = checks.some((c) => c.status === "down")
    ? "down"
    : checks.some((c) => c.status === "warning")
      ? "warning"
      : "healthy";

  res.set("Cache-Control", "no-store");
  res.status(worst === "down" ? 503 : 200).json({
    overall: worst,
    checks,
    response_ms: responseMs,
    database_ms: ping.ms,
    checked_at: now(),
    version,
  });
});

export default router;
