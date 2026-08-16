import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, ensureSchemaExtras } from "./db.js";
import { loadUser } from "./auth.js";
import authRoutes from "./routes/auth.routes.js";
import instituteRoutes from "./routes/institutes.routes.js";
import memberRoutes from "./routes/members.routes.js";
import masterRoutes from "./routes/masters.routes.js";
import reportRoutes from "./routes/reports.routes.js";
import settingsRoutes from "./routes/settings.routes.js";
import publicRoutes from "./routes/public.routes.js";
import ownerRoutes from "./routes/owner.routes.js";
import { startScheduler } from "./jobs.js";


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(loadUser);

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: process.env.DB_NAME });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.use("/api/public", publicRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/institutes", instituteRoutes);
app.use("/api/members", memberRoutes);
app.use("/api/masters", masterRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/owner", ownerRoutes);


app.use(express.static(path.join(__dirname, "..", "public")));
app.get("/kiosk/:slug", (_req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.sendFile(path.join(__dirname, "..", "public", "kiosk.html"));
});
app.get("/login", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "login.html")));
app.get("/contact", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "contact.html")));
app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "admin.html")));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Server error" });
});

await ensureSchemaExtras().catch((e) => console.error("Schema upgrade skipped:", e.message));
startScheduler();


const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`\n  Library Register (MySQL) running`);
  console.log(`  Admin  : http://localhost:${port}/admin`);
  console.log(`  Kiosk  : http://localhost:${port}/kiosk/<university-link>\n`);
});
