/**
 * Owner-only application management: upload a new version as a ZIP, upgrade the
 * database from the package's db folder, review history, and restart the app.
 */
import { Router } from "express";
import fsp from "node:fs/promises";
import path from "node:path";
import { q, one, localDateTime } from "../db.js";
import { requireAuth, requireOwner, logAudit } from "../auth.js";
import { installPackage, inspectPackage, currentVersion, rollbackTo, APP_ROOT, BACKUP_ROOT } from "../updater.js";
import { getUpdateStatus, installLatestRelease } from "../github-update.js";

const router = Router();
router.use(requireAuth, requireOwner);

const parseUpload = (body) => {
  const filename = String(body?.filename || "package.zip").replace(/[^\w.\-]/g, "_");
  if (!/\.zip$/i.test(filename)) throw new Error("Only .zip packages can be uploaded.");
  const base64 = String(body?.data || "").split(",").pop();
  if (!base64) throw new Error("No file data received.");
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) throw new Error("The uploaded file is empty.");
  if (buffer.length > 200 * 1024 * 1024) throw new Error("Package is larger than 200 MB.");
  return { filename, buffer };
};

/** Version, migration state and last upgrade. */
router.get("/status", async (_req, res) => {
  const last = await one("SELECT * FROM app_updates ORDER BY started_at DESC LIMIT 1");
  const migrations = await q(
    "SELECT filename, status, applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 25",
  );
  const [counts] = await q(
    `SELECT SUM(status = 'Success') AS ok, SUM(status = 'Failed') AS failed FROM schema_migrations`,
  );
  let backups = [];
  try {
    backups = (await fsp.readdir(BACKUP_ROOT, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && d.name.startsWith("app-"))
      .map((d) => ({ name: d.name, path: path.join(BACKUP_ROOT, d.name) }))
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, 10);
  } catch {
    /* no backups yet */
  }
  res.json({
    version: await currentVersion(),
    node: process.version,
    started_at: localDateTime(new Date(Date.now() - process.uptime() * 1000)),
    app_root: APP_ROOT,
    last_update: last || null,
    migrations,
    migration_counts: { applied: Number(counts?.ok || 0), failed: Number(counts?.failed || 0) },
    backups,
  });
});

/** GitHub release check — cached, refreshed at most once a day. */
router.get("/github", async (_req, res) => {
  try {
    res.json(await getUpdateStatus());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Force a fresh check against the GitHub releases API. */
router.post("/github/check", async (_req, res) => {
  try {
    res.json(await getUpdateStatus({ force: true }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** One-click: download the latest release, back up, extract, migrate. */
router.post("/github/install", async (req, res) => {
  const result = await installLatestRelease({ adminEmail: req.user.email });
  await logAudit(req, null, result.ok ? "app_update_success" : "app_update_failed", "app_updates", result.id || null, {
    source: "github",
    tag: result.tag || null,
    error: result.error || null,
  }).catch(() => {});
  res.status(result.ok ? 200 : 500).json(result);
});

/** Every upgrade attempt, newest first. */
router.get("/history", async (_req, res) => {
  res.json(await q("SELECT * FROM app_updates ORDER BY started_at DESC LIMIT 100"));
});

/** Validate a package without installing it. */
router.post("/validate", async (req, res) => {
  try {
    const { filename, buffer } = parseUpload(req.body);
    const pkg = inspectPackage(buffer);
    res.json({
      ok: true,
      filename,
      name: pkg.name,
      version: pkg.version,
      files: pkg.fileCount,
      migrations: pkg.migrations.map((m) => m.path),
      size_mb: Number((buffer.length / 1048576).toFixed(2)),
      current_version: await currentVersion(),
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** Upload + upgrade: backup, extract, migrate, rollback on failure. */
router.post("/install", async (req, res) => {
  let upload;
  try {
    upload = parseUpload(req.body);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const result = await installPackage({ ...upload, adminEmail: req.user.email });
  await logAudit(req, null, result.ok ? "app_update_success" : "app_update_failed", "app_updates", result.id, {
    filename: upload.filename,
    version: result.version || null,
    error: result.error || null,
  }).catch(() => {});

  res.status(result.ok ? 200 : 500).json(result);
});

/** Put an earlier application backup back in place. */
router.post("/rollback", async (req, res) => {
  try {
    const target = String(req.body?.path || "");
    if (!path.resolve(target).startsWith(path.resolve(BACKUP_ROOT))) {
      return res.status(400).json({ error: "Only folders inside backups/ can be restored." });
    }
    await rollbackTo(target);
    await logAudit(req, null, "app_rollback", "app_updates", null, { path: target }).catch(() => {});
    res.json({ ok: true, message: "Previous application files restored. Restart the application." });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Restart the running app. The process exits with code 42; start.bat (Windows)
 * and any supervisor (pm2 / systemd / start-loop.sh) start it again straight away.
 */
router.post("/restart", async (req, res) => {
  await logAudit(req, null, "app_restart", "app_updates", null, {}).catch(() => {});
  res.json({ ok: true, message: "Restarting — the application will be back in a few seconds." });
  setTimeout(() => {
    console.log("Restart requested from the owner console. Exiting with code 42.");
    process.exit(42);
  }, 400);
});

export default router;
