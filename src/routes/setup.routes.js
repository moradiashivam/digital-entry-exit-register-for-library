/** API used by the first-run Database Setup Wizard (/setup). */
import { Router } from "express";
import {
  setupComplete,
  refreshSetupState,
  testConnection,
  saveAndMigrate,
  createOwner,
  ownerExists,
} from "../setup.js";
import { dbConfig, hasDbConfig } from "../db.js";

const router = Router();

/** Everything except the status check is blocked once the app is set up. */
const onlyDuringSetup = async (_req, res, next) => {
  if (setupComplete()) {
    const state = await refreshSetupState();
    if (state.complete) return res.status(403).json({ error: "This application is already set up" });
  }
  next();
};

router.get("/status", async (_req, res) => {
  const state = await refreshSetupState();
  const cfg = dbConfig();
  res.json({
    ...state,
    configured: hasDbConfig(),
    ownerExists: state.step === "ready" ? true : await ownerExists(),
    suggestion: {
      host: cfg.host,
      port: cfg.port,
      user: hasDbConfig() ? cfg.user : "root",
      database: cfg.database,
    },
  });
});

function readConfig(body) {
  return {
    host: String(body?.host || "").trim(),
    port: Number(body?.port || 3306),
    user: String(body?.user || "").trim(),
    password: String(body?.password ?? ""),
    database: String(body?.database || "").trim(),
    ssl: !!body?.ssl,
  };
}

const invalid = (cfg) => {
  if (!cfg.host) return "Enter the database host (for example 127.0.0.1)";
  if (!cfg.port || cfg.port < 1 || cfg.port > 65535) return "Enter a valid port number";
  if (!cfg.user) return "Enter the database username";
  if (!/^[A-Za-z0-9_$-]+$/.test(cfg.database)) return "Enter a database name (letters, numbers and _ only)";
  return null;
};

router.post("/test", onlyDuringSetup, async (req, res) => {
  const cfg = readConfig(req.body);
  const bad = invalid(cfg);
  if (bad) return res.status(400).json({ ok: false, error: bad });
  const out = await testConnection(cfg);
  res.status(out.ok ? 200 : 400).json(out);
});

router.post("/save", onlyDuringSetup, async (req, res) => {
  const cfg = readConfig(req.body);
  const bad = invalid(cfg);
  if (bad) return res.status(400).json({ ok: false, error: bad });
  const out = await saveAndMigrate(cfg);
  if (!out.ok) return res.status(400).json(out);
  res.json({ ok: true, ownerExists: await ownerExists() });
});

router.post("/owner", onlyDuringSetup, async (req, res) => {
  const out = await createOwner(req.body || {});
  if (!out.ok) return res.status(400).json(out);
  // Background jobs were skipped at boot because there was no database yet.
  try {
    const { startScheduler } = await import("../jobs.js");
    startScheduler();
  } catch (e) {
    console.error("Scheduler start skipped:", e.message);
  }
  res.json({ ok: true });
});

export default router;
