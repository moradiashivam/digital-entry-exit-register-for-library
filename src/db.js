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
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000),
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

  // Platform (owner) tables + Master Setting (sublibrary access) tables.
  for (const file of ["platform.sql", "access.sql", "display.sql"]) {
    const sql = await readFile(path.join(dir, "..", "db", file), "utf8");
    for (const stmt of sql.split(/;\s*\n/)) {
      // Drop comment lines so a leading comment block never hides the statement.
      const s = stmt
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim();
      if (s) await pool.query(s);
    }
  }

  // Per-user saved preferences (dashboard filters etc.) — follows the login
  // across computers instead of living in one browser's localStorage.
  await pool.query(`CREATE TABLE IF NOT EXISTS user_preferences (
    user_id CHAR(36) NOT NULL,
    institute_id CHAR(36) NOT NULL,
    pref_key VARCHAR(60) NOT NULL,
    pref_value TEXT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, institute_id, pref_key)
  )`);

  const extras = [
    ["kiosk_settings", "theme", "ENUM('dark','light') NOT NULL DEFAULT 'light'"],
    ["kiosk_settings", "custom_css", "TEXT NULL"],
    ["kiosk_settings", "kiosk_template", "VARCHAR(40) NOT NULL DEFAULT 'classic'"],
    ["kiosk_settings", "multi_kiosk_transfer", "TINYINT(1) NOT NULL DEFAULT 1"],
    // “Did You Know?” student insights on the kiosk result screen.
    ["kiosk_settings", "insights_enabled", "TINYINT(1) NOT NULL DEFAULT 1"],
    ["kiosk_settings", "insights_on_entry", "TINYINT(1) NOT NULL DEFAULT 1"],
    ["kiosk_settings", "insights_on_exit", "TINYINT(1) NOT NULL DEFAULT 1"],
    ["kiosk_settings", "insights_title", "VARCHAR(120) NOT NULL DEFAULT 'Did You Know?'"],
    ["kiosk_settings", "insights_count", "INT NOT NULL DEFAULT 2"],
    ["kiosk_settings", "insights_categories", "VARCHAR(255) NOT NULL DEFAULT 'time,visits,streak,milestone,progress,stats,next'"],
    ["kiosk_settings", "insights_goal", "INT NOT NULL DEFAULT 0"],
    ["kiosk_settings", "insights_item_html", "TEXT NULL"],
    // Idle screen: library activities / services shown when nobody is scanning.
    ["kiosk_settings", "display_enabled", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["kiosk_settings", "display_idle_seconds", "INT NOT NULL DEFAULT 30"],
    ["kiosk_settings", "display_slide_seconds", "INT NOT NULL DEFAULT 10"],
    ["institutes", "code", "VARCHAR(40) NULL"],
    ["institutes", "plan_id", "CHAR(36) NULL"],
    ["institutes", "status", "ENUM('Active','Suspended','Deactivated') NOT NULL DEFAULT 'Active'"],
    ["institutes", "auto_renew", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["institutes", "lead_id", "CHAR(36) NULL"],
    ["members", "import_batch_id", "CHAR(36) NULL"],
    // Two-digit master data codes used by the bulk import mapper.
    ["courses", "code", "CHAR(2) NULL"],
    ["departments", "code", "CHAR(2) NULL"],
    ["academic_years", "code", "CHAR(2) NULL"],
    ["kiosk_devices", "sublibrary_id", "CHAR(36) NULL"],
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

  // Master Setting adds sublibrary roles to the existing role list.
  const roleCol = await one(
    `SELECT COLUMN_TYPE AS t FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'user_roles' AND column_name = 'role'`,
  );
  if (roleCol && !String(roleCol.t).includes("sublibrary_admin")) {
    await pool.query(
      `ALTER TABLE user_roles MODIFY COLUMN role
       ENUM('super_admin','librarian','report_viewer','sublibrary_admin','operator','viewer')
       NOT NULL DEFAULT 'operator'`,
    );
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

  // Two-digit codes on master data: give every existing row a code, then make
  // the code unique inside each university so bulk import can map rows safely.
  for (const [table, index] of [
    ["courses", "uq_course_code"],
    ["departments", "uq_department_code"],
    ["academic_years", "uq_year_code"],
  ]) {
    const rows = await q(
      `SELECT id, institute_id FROM \`${table}\` WHERE code IS NULL OR code = '' ORDER BY institute_id, name`,
    );
    const used = new Map();
    for (const row of rows) {
      if (!used.has(row.institute_id)) {
        const taken = await q(
          `SELECT code FROM \`${table}\` WHERE institute_id = ? AND code IS NOT NULL AND code <> ''`,
          [row.institute_id],
        );
        used.set(row.institute_id, new Set(taken.map((t) => String(t.code))));
      }
      const set = used.get(row.institute_id);
      let code = null;
      for (let n = 1; n <= 99; n++) {
        const candidate = String(n).padStart(2, "0");
        if (!set.has(candidate)) { code = candidate; break; }
      }
      if (!code) continue;
      set.add(code);
      await q(`UPDATE \`${table}\` SET code = ? WHERE id = ?`, [code, row.id]);
    }

    const hasIndex = await one(
      `SELECT 1 AS ok FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
      [table, index],
    );
    if (!hasIndex) {
      try {
        await pool.query(`ALTER TABLE \`${table}\` ADD UNIQUE KEY \`${index}\` (institute_id, code)`);
      } catch { /* duplicate legacy codes — keep running without the index */ }
    }
  }
}


