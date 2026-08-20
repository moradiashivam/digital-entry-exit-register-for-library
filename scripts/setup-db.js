/**
 * Creates the database, applies db/schema.sql and creates the platform owner.
 * Run once:  npm run setup
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbName = process.env.DB_NAME || "library_register";

const base = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  multipleStatements: true,
};

const run = async () => {
  const root = await mysql.createConnection(base);
  await root.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await root.end();
  console.log(`✔ database "${dbName}" ready`);

  const conn = await mysql.createConnection({ ...base, database: dbName });
  const schema = await fs.readFile(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
  await conn.query(schema);
  console.log("✔ tables created");

  // Contact details are optional — relax older databases that still have them NOT NULL.
  await conn.query("ALTER TABLE members MODIFY mobile VARCHAR(10) NULL, MODIFY email VARCHAR(200) NULL");
  console.log("✔ member contact fields optional");

  // Local time zone per university — added in a later version.
  const [tzCol] = await conn.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = 'kiosk_settings' AND column_name = 'timezone'",
    [dbName],
  );
  if (!tzCol.length) {
    await conn.query("ALTER TABLE kiosk_settings ADD COLUMN timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata' AFTER result_seconds");
    console.log("✔ kiosk_settings.timezone added");
  }


  // Camera barcode scanning at the kiosk — added in a later version.
  const [bcCol] = await conn.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = 'kiosk_settings' AND column_name = 'allow_barcode'",
    [dbName],
  );
  if (!bcCol.length) {
    await conn.query("ALTER TABLE kiosk_settings ADD COLUMN allow_barcode TINYINT(1) NOT NULL DEFAULT 1 AFTER allow_manual");
    console.log("✔ kiosk_settings.allow_barcode added");
  }

  const email = (process.env.OWNER_EMAIL || "owner@example.com").toLowerCase();
  const password = process.env.OWNER_PASSWORD || "ChangeThisOwnerPassword1!";
  const [rows] = await conn.query("SELECT id FROM users WHERE email = ?", [email]);
  if (rows.length) {
    await conn.query("UPDATE users SET password_hash = ?, is_platform_owner = 1, status = 'Active' WHERE email = ?", [
      await bcrypt.hash(password, 10), email,
    ]);
    console.log(`✔ platform owner updated: ${email}`);
  } else {
    await conn.query(
      "INSERT INTO users (id, email, password_hash, full_name, is_platform_owner) VALUES (?,?,?,?,1)",
      [randomUUID(), email, await bcrypt.hash(password, 10), process.env.OWNER_NAME || "Platform Owner"],
    );
    console.log(`✔ platform owner created: ${email}`);
  }
  await conn.end();
  console.log(`\nDone. Start the app with:  npm start\n`);
};

run().catch((e) => {
  console.error("\n✖ Setup failed:", e.message);
  console.error("  Check the DB_* values in your .env file and that MySQL is running.\n");
  process.exit(1);
});
