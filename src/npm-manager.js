/**
 * Owner-side Node module (npm dependency) management.
 *
 * Lets the platform owner see which npm packages are outdated, which ones have
 * known security advisories, and update them from the browser — without opening
 * a terminal on the server. Everything runs inside the application folder.
 */
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { APP_ROOT } from "./updater.js";

const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const MAX_BUFFER = 32 * 1024 * 1024;

/** Run an npm command; npm uses non-zero exit codes for normal results, so we never throw on those. */
function runNpm(args, { timeout = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    execFile(
      NPM,
      args,
      { cwd: APP_ROOT, maxBuffer: MAX_BUFFER, timeout, windowsHide: true, shell: process.platform === "win32" },
      (error, stdout, stderr) => {
        resolve({
          code: error?.code ?? 0,
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
          failed: Boolean(error && error.killed),
          error: error && error.killed ? "The npm command timed out." : null,
        });
      },
    );
  });
}

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** Package names declared in package.json (so we never touch anything unexpected). */
async function declaredPackages() {
  try {
    const pkg = JSON.parse(await fsp.readFile(path.join(APP_ROOT, "package.json"), "utf8"));
    return new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})]);
  } catch {
    return new Set();
  }
}

/** True when the name looks like a normal npm package (no flags, no paths). */
export const isSafePackageName = (name) =>
  typeof name === "string" && /^(@[a-z0-9-~][\w.-]*\/)?[a-z0-9-~][\w.-]*$/i.test(name);

/**
 * Outdated packages + npm audit summary.
 * Returns a single object the owner UI can render directly.
 */
export async function scanModules() {
  const declared = await declaredPackages();
  const [outdatedRun, auditRun] = await Promise.all([
    runNpm(["outdated", "--json", "--long"]),
    runNpm(["audit", "--json"]),
  ]);

  const outdatedRaw = parseJson(outdatedRun.stdout) || {};
  const outdated = Object.entries(outdatedRaw)
    .filter(([name]) => declared.has(name))
    .map(([name, info]) => ({
      name,
      current: info.current || null,
      wanted: info.wanted || null,
      latest: info.latest || null,
      type: info.type || (info.dependent ? "dependencies" : ""),
      homepage: info.homepage || null,
      major: Boolean(info.wanted && info.latest && info.wanted !== info.latest),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const auditRaw = parseJson(auditRun.stdout) || {};
  const vulnObj = auditRaw.vulnerabilities || {};
  const vulnerabilities = Object.values(vulnObj)
    .filter((v) => v && v.name)
    .map((v) => ({
      name: v.name,
      severity: v.severity || "unknown",
      direct: Boolean(v.isDirect),
      fix_available: Boolean(v.fixAvailable),
      fix_is_major: Boolean(v.fixAvailable && typeof v.fixAvailable === "object" && v.fixAvailable.isSemVerMajor),
      via: (Array.isArray(v.via) ? v.via : [])
        .map((x) => (typeof x === "string" ? x : x?.title))
        .filter(Boolean)
        .slice(0, 3),
      url: (Array.isArray(v.via) ? v.via : []).find((x) => x && typeof x === "object" && x.url)?.url || null,
    }))
    .sort((a, b) => {
      const order = { critical: 0, high: 1, moderate: 2, low: 3, info: 4, unknown: 5 };
      return (order[a.severity] ?? 9) - (order[b.severity] ?? 9) || a.name.localeCompare(b.name);
    });

  const counts = auditRaw.metadata?.vulnerabilities || {};
  return {
    checked_at: new Date().toISOString(),
    node: process.version,
    outdated,
    outdated_count: outdated.length,
    vulnerabilities,
    severity_counts: {
      critical: Number(counts.critical || 0),
      high: Number(counts.high || 0),
      moderate: Number(counts.moderate || 0),
      low: Number(counts.low || 0),
      info: Number(counts.info || 0),
      total: Number(counts.total || vulnerabilities.length || 0),
    },
    total_dependencies: Number(auditRaw.metadata?.dependencies?.total || declared.size),
    errors: [outdatedRun.error, auditRun.error].filter(Boolean),
  };
}

/**
 * Apply an update.
 *  - mode "audit-fix"        → npm audit fix
 *  - mode "audit-fix-force"  → npm audit fix --force (may install breaking majors)
 *  - mode "update"           → npm update (safe, within semver range)
 *  - mode "install"          → npm install <pkg>@latest for the listed packages
 */
export async function updateModules({ mode = "update", packages = [] } = {}) {
  const steps = [];
  const log = (message, level = "info") => steps.push({ at: new Date().toISOString(), message, level });

  let args;
  if (mode === "audit-fix") args = ["audit", "fix"];
  else if (mode === "audit-fix-force") args = ["audit", "fix", "--force"];
  else if (mode === "update") args = ["update"];
  else if (mode === "install") {
    const declared = await declaredPackages();
    const clean = [...new Set(packages)].filter((p) => isSafePackageName(p) && declared.has(p));
    if (!clean.length) return { ok: false, error: "No valid packages were selected.", steps };
    args = ["install", ...clean.map((p) => `${p}@latest`)];
    log(`Installing latest: ${clean.join(", ")}`);
  } else {
    return { ok: false, error: "Unknown update mode.", steps };
  }

  log(`Running: npm ${args.join(" ")}`);
  const run = await runNpm([...args, "--no-fund", "--no-audit"], { timeout: 20 * 60 * 1000 });
  const output = `${run.stdout}\n${run.stderr}`.trim();
  output
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-80)
    .forEach((line) => log(line));

  if (run.error) {
    log(run.error, "error");
    return { ok: false, error: run.error, steps, output };
  }
  const ok = run.code === 0;
  log(ok ? "npm finished successfully. Restart the application to load the new modules." : `npm exited with code ${run.code}.`, ok ? "success" : "error");
  return { ok, code: run.code, steps, output };
}
