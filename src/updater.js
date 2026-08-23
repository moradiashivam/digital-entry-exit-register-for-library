/**
 * Application updater.
 *
 * The platform owner uploads a ZIP of the new application version from the web
 * console. This module validates the package, backs up the current files and
 * database, replaces the application files (keeping configuration, photos and
 * backups untouched), runs any SQL migrations found in the package's `db`
 * folder exactly once, and can roll everything back when a step fails.
 *
 * Zip reading is done with Node's built-in zlib so the app needs no extra
 * dependency — installing packages on the server is exactly what we avoid.
 */
import zlib from "node:zlib";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { pool, q, one, uuid, localDateTime } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Root of the running application (folder that holds package.json). */
export const APP_ROOT = path.join(__dirname, "..");
export const BACKUP_ROOT = path.join(APP_ROOT, "backups");

/** Never overwritten by an update — configuration, data and backups. */
const PRESERVE = [
  ".env",
  ".env.local",
  ".env.test",
  ".env.production",
  "node_modules/",
  "backups/",
  "uploads/",
  "logs/",
  "public/photos/",
];

/** Skipped when copying the current app into the pre-update backup. */
const NO_BACKUP = ["node_modules", "backups", ".git", "photos"];

const isPreserved = (rel) =>
  PRESERVE.some((p) => (p.endsWith("/") ? rel === p.slice(0, -1) || rel.startsWith(p) : rel === p));

/* ------------------------------------------------------------------ *
 * Minimal ZIP reader (stored + deflate, the only methods zip tools use)
 * ------------------------------------------------------------------ */
export function readZip(buf) {
  let eocd = -1;
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a valid ZIP file (no end-of-archive record).");

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Corrupt ZIP directory.");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    entries.push({ name, method, csize, usize, offset, dir: name.endsWith("/") });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries.map((e) => ({ ...e, read: () => readEntry(buf, e) }));
}

function readEntry(buf, e) {
  if (e.dir) return Buffer.alloc(0);
  if (buf.readUInt32LE(e.offset) !== 0x04034b50) throw new Error(`Corrupt entry: ${e.name}`);
  const nameLen = buf.readUInt16LE(e.offset + 26);
  const extraLen = buf.readUInt16LE(e.offset + 28);
  const start = e.offset + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.csize);
  if (e.method === 0) return Buffer.from(raw);
  if (e.method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`Unsupported compression in ${e.name} (method ${e.method}).`);
}

/** Drop a single wrapping folder ("library-register-mysql/src/…" → "src/…"). */
function normalise(entries) {
  const names = entries.map((e) => e.name).filter((n) => !n.startsWith("__MACOSX/"));
  const tops = new Set(names.map((n) => n.split("/")[0]));
  const single = tops.size === 1 && names.some((n) => n.includes("/"));
  const prefix = single ? `${[...tops][0]}/` : "";
  return entries
    .filter((e) => !e.name.startsWith("__MACOSX/") && !e.name.split("/").pop().startsWith("._"))
    .map((e) => ({ ...e, path: prefix && e.name.startsWith(prefix) ? e.name.slice(prefix.length) : e.name }))
    .filter((e) => e.path && !e.path.startsWith("/") && !e.path.split("/").includes(".."));
}

/**
 * Validate a package. Returns { files, migrations, version, name }.
 * A valid package looks like the application: it has package.json and src/server.js.
 */
export function inspectPackage(buffer) {
  const entries = normalise(readZip(buffer));
  const files = entries.filter((e) => !e.dir);
  const byPath = new Map(files.map((f) => [f.path, f]));

  const pkgEntry = byPath.get("package.json");
  if (!pkgEntry) throw new Error("Package rejected: package.json is missing from the ZIP.");
  if (!byPath.get("src/server.js")) throw new Error("Package rejected: src/server.js is missing from the ZIP.");

  let pkg = {};
  try {
    pkg = JSON.parse(pkgEntry.read().toString("utf8"));
  } catch {
    throw new Error("Package rejected: package.json is not valid JSON.");
  }

  const migrations = files
    .filter((f) => /^db\/.+\.sql$/i.test(f.path))
    .sort((a, b) => a.path.localeCompare(b.path, "en"));

  return {
    entries: files,
    migrations,
    version: String(pkg.version || "unknown"),
    name: String(pkg.name || "application"),
    fileCount: files.length,
  };
}

/* ------------------------------------------------------------------ *
 * Backups
 * ------------------------------------------------------------------ */
const stamp = () => localDateTime().replace(/[: ]/g, "-");

async function copyTree(from, to) {
  const items = await fsp.readdir(from, { withFileTypes: true });
  await fsp.mkdir(to, { recursive: true });
  for (const item of items) {
    if (NO_BACKUP.includes(item.name)) continue;
    const src = path.join(from, item.name);
    const dst = path.join(to, item.name);
    if (item.isDirectory()) await copyTree(src, dst);
    else if (item.isFile()) await fsp.copyFile(src, dst);
  }
}

/** Copy the current application files somewhere safe. Returns the folder. */
export async function backupApplication() {
  const dir = path.join(BACKUP_ROOT, `app-${stamp()}`);
  await copyTree(APP_ROOT, dir);
  return dir;
}

/** Dump every table of the database to a JSON file. Returns the file path. */
export async function backupDatabase() {
  const tables = (
    await q(
      `SELECT table_name AS t FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name`,
    )
  ).map((r) => r.t ?? r.TABLE_NAME);

  const dump = { format: "library-register-master/1", created_at: localDateTime(), tables: {} };
  for (const table of tables) dump.tables[table] = await q(`SELECT * FROM \`${table}\``);

  await fsp.mkdir(BACKUP_ROOT, { recursive: true });
  const file = path.join(BACKUP_ROOT, `db-${stamp()}.json`);
  await fsp.writeFile(file, JSON.stringify(dump));
  return file;
}

/** Put a pre-update application backup back in place. */
export async function restoreApplication(dir) {
  await copyTree(dir, APP_ROOT);
}

/* ------------------------------------------------------------------ *
 * Migrations
 * ------------------------------------------------------------------ */
const splitSql = (sql) =>
  sql
    .split(/;\s*\r?\n/)
    .map((chunk) =>
      chunk
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);

/** Run every .sql file in the package's db folder that has not run before. */
async function runMigrations(migrations, updateId, log) {
  const applied = [];
  for (const file of migrations) {
    const sql = file.read().toString("utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    const done = await one("SELECT id FROM schema_migrations WHERE filename = ? AND status = 'Success'", [file.path]);
    if (done) {
      log(`Skipped ${file.path} — already applied.`);
      continue;
    }
    try {
      for (const statement of splitSql(sql)) await pool.query(statement);
      await q(
        `INSERT INTO schema_migrations (id, filename, checksum, update_id, status, applied_at)
         VALUES (?, ?, ?, ?, 'Success', ?)`,
        [uuid(), file.path, checksum, updateId, localDateTime()],
      );
      applied.push(file.path);
      log(`Applied ${file.path}`);
    } catch (e) {
      await q(
        `INSERT INTO schema_migrations (id, filename, checksum, update_id, status, error, applied_at)
         VALUES (?, ?, ?, ?, 'Failed', ?, ?)`,
        [uuid(), file.path, checksum, updateId, String(e.message).slice(0, 500), localDateTime()],
      );
      throw new Error(`Database migration ${file.path} failed: ${e.message}`);
    }
  }
  return applied;
}

/* ------------------------------------------------------------------ *
 * The upgrade itself
 * ------------------------------------------------------------------ */

/** Version of the code currently running. */
export async function currentVersion() {
  try {
    const pkg = JSON.parse(await fsp.readFile(path.join(APP_ROOT, "package.json"), "utf8"));
    return String(pkg.version || "unknown");
  } catch {
    return "unknown";
  }
}

/**
 * Install an uploaded package.
 * Every step is appended to `steps` so the owner sees exactly what happened.
 */
export async function installPackage({ buffer, filename, adminEmail }) {
  const steps = [];
  const log = (message, level = "info") => steps.push({ at: localDateTime(), level, message });

  const updateId = uuid();
  let pkg;
  let appBackup = null;
  let dbBackup = null;

  log(`Received ${filename} (${(buffer.length / 1048576).toFixed(2)} MB).`);

  try {
    pkg = inspectPackage(buffer);
    log(`Package validated: ${pkg.name} v${pkg.version}, ${pkg.fileCount} files, ${pkg.migrations.length} migration script(s).`);
  } catch (e) {
    log(e.message, "error");
    await recordUpdate({ updateId, filename, version: null, from: await currentVersion(), status: "Failed", error: e.message, steps, adminEmail });
    return { ok: false, id: updateId, error: e.message, steps };
  }

  const from = await currentVersion();

  await q(
    `INSERT INTO app_updates (id, filename, from_version, to_version, status, started_at, started_by, log)
     VALUES (?, ?, ?, ?, 'Running', ?, ?, ?)`,
    [updateId, filename, from, pkg.version, localDateTime(), adminEmail || "owner", JSON.stringify(steps)],
  );

  try {
    await fsp.mkdir(BACKUP_ROOT, { recursive: true });

    appBackup = await backupApplication();
    log(`Application backed up to ${path.relative(APP_ROOT, appBackup)}.`);

    dbBackup = await backupDatabase();
    log(`Database backed up to ${path.relative(APP_ROOT, dbBackup)}.`);

    // ---- replace files -------------------------------------------------
    let written = 0;
    let skipped = 0;
    for (const entry of pkg.entries) {
      if (isPreserved(entry.path)) { skipped++; continue; }
      const target = path.join(APP_ROOT, entry.path);
      if (!target.startsWith(APP_ROOT + path.sep)) throw new Error(`Unsafe path in package: ${entry.path}`);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, entry.read());
      written++;
    }
    log(`Extracted ${written} file(s); kept ${skipped} protected file(s) untouched.`);

    // ---- database ------------------------------------------------------
    const applied = await runMigrations(pkg.migrations, updateId, log);
    log(applied.length ? `Database upgraded (${applied.length} new migration(s)).` : "Database already up to date.");

    await q(
      `UPDATE app_updates SET status = 'Success', finished_at = ?, migrations_applied = ?,
        app_backup_path = ?, db_backup_path = ?, log = ? WHERE id = ?`,
      [localDateTime(), applied.length, appBackup, dbBackup, JSON.stringify(steps), updateId],
    );
    log("Upgrade completed. Restart the application to run the new version.", "success");
    await q("UPDATE app_updates SET log = ? WHERE id = ?", [JSON.stringify(steps), updateId]);

    return { ok: true, id: updateId, version: pkg.version, from, migrations: applied, steps };
  } catch (e) {
    log(e.message, "error");
    let rolledBack = false;
    if (appBackup) {
      try {
        await restoreApplication(appBackup);
        rolledBack = true;
        log("Application files rolled back to the previous version.", "warn");
      } catch (re) {
        log(`Rollback failed: ${re.message}. Restore manually from ${appBackup}.`, "error");
      }
    }
    if (dbBackup) log(`Database backup kept at ${path.relative(APP_ROOT, dbBackup)} — restore it from System settings if the schema is broken.`, "warn");

    await q(
      `UPDATE app_updates SET status = ?, finished_at = ?, error = ?, app_backup_path = ?,
        db_backup_path = ?, log = ? WHERE id = ?`,
      [rolledBack ? "Rolled back" : "Failed", localDateTime(), String(e.message).slice(0, 500), appBackup, dbBackup, JSON.stringify(steps), updateId],
    );
    return { ok: false, id: updateId, error: e.message, rolledBack, steps };
  }
}

async function recordUpdate({ updateId, filename, version, from, status, error, steps, adminEmail }) {
  await q(
    `INSERT INTO app_updates (id, filename, from_version, to_version, status, started_at, finished_at, started_by, error, log)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [updateId, filename, from, version, status, localDateTime(), localDateTime(), adminEmail || "owner", error?.slice(0, 500) || null, JSON.stringify(steps)],
  );
}

/** Restore an application backup taken before an update. */
export async function rollbackTo(backupPath) {
  if (!backupPath || !fs.existsSync(backupPath)) throw new Error("That backup folder no longer exists on the server.");
  await restoreApplication(backupPath);
}
