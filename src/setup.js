/**
 * First-run Database Setup Wizard.
 *
 * When the app starts without usable database details (or the saved details no
 * longer work) every page is sent to /setup instead of showing a raw error.
 * The wizard tests the connection, saves it to .env, creates the tables and
 * the platform owner account, then hands over to the normal login page.
 */
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { pool, hasDbConfig, resetPool, ensureSchemaExtras } from "./db.js";
import { APP_ROOT, DATA_ROOT, moduleDir } from "./runtime-paths.js";

const __dirname = moduleDir(import.meta.url);
const ROOT = APP_ROOT;
const ENV_FILE = path.join(DATA_ROOT, ".env");

/** Cached answer so every request does not hit MySQL. */
let ready = false;

export const setupComplete = () => ready;

const dbError = (e) => {
  const code = String(e?.code || "");
  if (code === "ER_ACCESS_DENIED_ERROR") return "Username or password was refused by MySQL.";
  if (code === "ER_BAD_DB_ERROR") return "That database name does not exist on the server.";
  if (code === "ECONNREFUSED") return "Nothing is listening on that host and port — is MySQL running?";
  if (code === "ETIMEDOUT" || code === "ENOTFOUND") return "Could not reach that host — check the host name and port.";
  return e?.message || "Could not connect to the database.";
};

/** Re-check whether the app is fully set up (config + tables + owner account). */
export async function refreshSetupState() {
  ready = false;
  if (!hasDbConfig()) return status(false, "not-configured");
  try {
    const [tables] = await pool.query(
      `SELECT COUNT(*) AS n FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name IN ('users','institutes')`,
    );
    if (Number(tables[0]?.n || 0) < 2) return status(false, "no-tables");
    const [owners] = await pool.query("SELECT COUNT(*) AS n FROM users WHERE is_platform_owner = 1");
    if (!Number(owners[0]?.n || 0)) return status(false, "no-owner");
    ready = true;
    return status(true, "ready");
  } catch (e) {
    return status(false, "cannot-connect", dbError(e));
  }
}

const status = (complete, step, message) => ({ complete, step, message: message || null });

/** Try a set of connection details without touching the saved configuration. */
export async function testConnection(cfg) {
  const base = {
    host: cfg.host,
    port: Number(cfg.port || 3306),
    user: cfg.user,
    password: cfg.password || "",
    connectTimeout: 10000,
    ...(cfg.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  };
  let conn;
  try {
    conn = await mysql.createConnection(base);
  } catch (e) {
    return { ok: false, error: dbError(e) };
  }
  try {
    const [rows] = await conn.query("SELECT SCHEMA_NAME FROM information_schema.schemata WHERE SCHEMA_NAME = ?", [
      cfg.database,
    ]);
    return { ok: true, databaseExists: rows.length > 0 };
  } catch (e) {
    return { ok: false, error: dbError(e) };
  } finally {
    await conn.end().catch(() => {});
  }
}

/** Merge values into .env (creating it when missing) and into this process. */
export async function writeEnv(values) {
  let text = "";
  try {
    text = await fs.readFile(ENV_FILE, "utf8");
  } catch {
    try {
      text = await fs.readFile(path.join(ROOT, ".env.example"), "utf8");
    } catch { text = ""; }
  }
  const lines = text.split(/\r?\n/);
  for (const [key, raw] of Object.entries(values)) {
    const value = String(raw ?? "");
    const line = `${key}=${value}`;
    const at = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
    if (at >= 0) lines[at] = line;
    else lines.push(line);
    process.env[key] = value;
  }
  await fs.writeFile(ENV_FILE, lines.join("\n").replace(/\n{3,}/g, "\n\n"), "utf8");
}

/** Create the database when needed, save the details and build every table. */
export async function saveAndMigrate(cfg) {
  const test = await testConnection(cfg);
  if (!test.ok) return { ok: false, error: test.error };

  const conn = await mysql.createConnection({
    host: cfg.host,
    port: Number(cfg.port || 3306),
    user: cfg.user,
    password: cfg.password || "",
    multipleStatements: true,
    connectTimeout: 15000,
    ...(cfg.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  try {
    if (!test.databaseExists) {
      await conn.query(
        `CREATE DATABASE IF NOT EXISTS \`${String(cfg.database).replace(/`/g, "")}\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );
    }
    await conn.query(`USE \`${String(cfg.database).replace(/`/g, "")}\``);
    const schema = await fs.readFile(path.join(ROOT, "db", "schema.sql"), "utf8");
    await conn.query(schema);
    // Contact details are optional on members.
    await conn.query("ALTER TABLE members MODIFY mobile VARCHAR(10) NULL, MODIFY email VARCHAR(200) NULL")
      .catch(() => {});
  } catch (e) {
    return { ok: false, error: dbError(e) };
  } finally {
    await conn.end().catch(() => {});
  }

  await writeEnv({
    DB_HOST: cfg.host,
    DB_PORT: String(cfg.port || 3306),
    DB_USER: cfg.user,
    DB_PASSWORD: cfg.password || "",
    DB_NAME: cfg.database,
    DB_SSL: cfg.ssl ? "true" : "false",
  });
  if (!process.env.JWT_SECRET) await writeEnv({ JWT_SECRET: randomUUID().replace(/-/g, "") });
  resetPool();

  try {
    await ensureSchemaExtras();
  } catch (e) {
    return { ok: false, error: `Tables created, but the upgrade step failed: ${e.message}` };
  }
  const state = await refreshSetupState();
  return { ok: true, state };
}

/** Whether an owner account already exists (wizard skips the last step then). */
export async function ownerExists() {
  try {
    const [rows] = await pool.query("SELECT COUNT(*) AS n FROM users WHERE is_platform_owner = 1");
    return Number(rows[0]?.n || 0) > 0;
  } catch {
    return false;
  }
}

/** Create the first platform-owner login. Only allowed while none exists. */
export async function createOwner({ name, email, password }) {
  const mail = String(email || "").trim().toLowerCase();
  const pass = String(password || "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return { ok: false, error: "Enter a valid email address" };
  if (pass.length < 8) return { ok: false, error: "Password must be at least 8 characters" };
  if (await ownerExists()) return { ok: false, error: "An owner account already exists — sign in instead" };

  const [existing] = await pool.query("SELECT id FROM users WHERE email = ?", [mail]);
  const hash = await bcrypt.hash(pass, 10);
  if (existing.length) {
    await pool.query(
      "UPDATE users SET password_hash = ?, is_platform_owner = 1, status = 'Active', full_name = ? WHERE id = ?",
      [hash, String(name || "").trim() || "Platform Owner", existing[0].id],
    );
  } else {
    await pool.query(
      "INSERT INTO users (id, email, password_hash, full_name, is_platform_owner) VALUES (?,?,?,?,1)",
      [randomUUID(), mail, hash, String(name || "").trim() || "Platform Owner"],
    );
  }
  await refreshSetupState();
  return { ok: true };
}
