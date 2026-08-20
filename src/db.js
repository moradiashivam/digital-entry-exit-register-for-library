import mysql from "mysql2/promise";
import { randomUUID, randomBytes } from "node:crypto";
import "dotenv/config";

/** "+05:30" style offset of the computer running Node, for MySQL's session clock. */
function localOffset(date = new Date()) {
  const mins = -date.getTimezoneOffset();
  const sign = mins < 0 ? "-" : "+";
  const abs = Math.abs(mins);
  const pad = (v) => String(v).padStart(2, "0");
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "library_register",
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
  timezone: "local",
});

/**
 * Keep MySQL's clock (NOW(), CURDATE(), CURRENT_TIMESTAMP defaults) identical to
 * the computer running this app, so dashboard "today", durations and peak hour
 * match the times shown at the kiosk.
 */
pool.on("connection", (conn) => {
  conn.query(`SET time_zone = '${localOffset()}'`, () => {});
});


/** Run a query and return rows. */
export async function q(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/** Run a query and return the first row (or null). */
export async function one(sql, params = []) {
  const rows = await q(sql, params);
  return rows[0] ?? null;
}

export const uuid = () => randomUUID();
export const kioskKey = () => randomBytes(16).toString("hex");

/** MySQL DATETIME text using the local clock of the computer running Node. */
export function localDateTime(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Local calendar date of the computer running Node. */
export const localDate = (date = new Date()) => localDateTime(date).slice(0, 10);

export const today = () => localDate();
export const plusYear = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return localDate(d);
};

/** Add tables / columns introduced after the first release (safe on every boot). */
export async function ensureSchemaExtras() {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const dir = path.dirname(fileURLToPath(import.meta.url));

  // Platform (owner) tables.
  const sql = await readFile(path.join(dir, "..", "db", "platform.sql"), "utf8");
  for (const stmt of sql.split(/;\s*\n/)) {
    // Drop comment lines so a leading comment block never hides the statement.
    const s = stmt
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim();
    if (s) await pool.query(s);
  }


  const extras = [
    ["kiosk_settings", "theme", "ENUM('dark','light') NOT NULL DEFAULT 'light'"],
    ["kiosk_settings", "custom_css", "TEXT NULL"],
    ["institutes", "code", "VARCHAR(40) NULL"],
    ["institutes", "plan_id", "CHAR(36) NULL"],
    ["institutes", "status", "ENUM('Active','Suspended','Deactivated') NOT NULL DEFAULT 'Active'"],
    ["institutes", "auto_renew", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["institutes", "lead_id", "CHAR(36) NULL"],
    ["members", "import_batch_id", "CHAR(36) NULL"],
    ["bulk_import_logs", "duplicate_count", "INT NOT NULL DEFAULT 0"],
    ["bulk_import_logs", "updated_count", "INT NOT NULL DEFAULT 0"],
    ["bulk_import_logs", "skipped_count", "INT NOT NULL DEFAULT 0"],
  ];
  for (const [table, column, ddl] of extras) {
    const found = await one(
      `SELECT 1 AS ok FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
      [table, column],
    );
    if (!found) await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`);
  }

  // One-time: flip existing kiosks to the new light default (only rows still on dark).
  const needFlip = await one(`SELECT 1 AS ok FROM kiosk_settings WHERE theme = 'dark' LIMIT 1`);
  if (needFlip) await pool.query(`UPDATE kiosk_settings SET theme = 'light' WHERE theme = 'dark'`);

  // Give every existing university a short code.
  const missing = await q("SELECT id, slug FROM institutes WHERE code IS NULL OR code = ''");
  for (const inst of missing) {
    await q("UPDATE institutes SET code = ? WHERE id = ?", [
      inst.slug.replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase() || "INST",
      inst.id,
    ]);
  }

  // Default grace period.
  await q(
    `INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES ('grace_days', '5')`,
  );
}

