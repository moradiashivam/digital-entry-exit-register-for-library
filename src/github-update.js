/**
 * GitHub-based automatic updates.
 *
 * The application checks the project's GitHub releases once a day, compares the
 * released tag with the installed version using semantic version rules, and can
 * download + install the release ZIP with the normal updater pipeline (backup →
 * extract → migrations → rollback on failure).
 */
import { q, one, localDateTime } from "./db.js";
import { installPackage, currentVersion } from "./updater.js";

export const GITHUB_REPO =
  process.env.GITHUB_REPO || "moradiashivam/digital-entry-exit-register-for-library";
const RELEASE_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const DAY_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ *
 * Settings helpers (platform_settings is a simple key/value table)
 * ------------------------------------------------------------------ */
const getSetting = async (key) => {
  const row = await one("SELECT setting_value FROM platform_settings WHERE setting_key = ?", [key]);
  return row?.setting_value ?? null;
};

const setSetting = async (key, value) => {
  await q(
    `INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [key, value == null ? null : String(value)],
  );
};

/* ------------------------------------------------------------------ *
 * Semantic version comparison — "V3.9.0" < "V3.10.0"
 * ------------------------------------------------------------------ */
export function parseVersion(value) {
  const cleaned = String(value ?? "").trim().replace(/^[vV]/, "");
  const [core] = cleaned.split(/[-+]/);
  const parts = core.split(".").map((n) => Number.parseInt(n, 10));
  return [0, 1, 2].map((i) => (Number.isFinite(parts[i]) ? parts[i] : 0));
}

/** -1 when a < b, 0 when equal, 1 when a > b. */
export function compareVersions(a, b) {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (av[i] !== bv[i]) return av[i] < bv[i] ? -1 : 1;
  }
  return 0;
}

export const isNewer = (candidate, installed) => compareVersions(candidate, installed) > 0;

/* ------------------------------------------------------------------ *
 * GitHub API
 * ------------------------------------------------------------------ */
async function githubFetch(url, extraHeaders = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "library-entry-exit-register",
    ...extraHeaders,
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers, redirect: "follow" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub request failed [${res.status}] ${body.slice(0, 200)}`);
  }
  return res;
}

/**
 * GitHub's API archive endpoint rejects application/octet-stream. Release
 * assets, when present, are normal browser downloads and may use it.
 */
const downloadHeaders = (url) =>
  String(url).startsWith("https://api.github.com/")
    ? { Accept: "application/vnd.github+json" }
    : { Accept: "application/octet-stream" };

/** Latest release as { tag, name, notes, published_at, zip_url, asset_name }. */
export async function fetchLatestRelease() {
  const res = await githubFetch(RELEASE_URL);
  const rel = await res.json();
  const assets = Array.isArray(rel.assets) ? rel.assets : [];
  const zip = assets.find((a) => /\.zip$/i.test(a.name || ""));
  return {
    tag: String(rel.tag_name || "").trim(),
    name: rel.name || rel.tag_name || "",
    notes: (rel.body || "").slice(0, 4000),
    published_at: rel.published_at || null,
    html_url: rel.html_url || null,
    zip_url: zip?.browser_download_url || rel.zipball_url || null,
    asset_name: zip?.name || `${rel.tag_name || "release"}.zip`,
  };
}

/* ------------------------------------------------------------------ *
 * Status (cached, refreshed at most once a day unless forced)
 * ------------------------------------------------------------------ */
export async function getUpdateStatus({ force = false } = {}) {
  const installed = await currentVersion();
  const lastCheckIso = await getSetting("github_last_check_iso");
  const cachedRaw = await getSetting("github_latest_release");
  let cached = null;
  try {
    cached = cachedRaw ? JSON.parse(cachedRaw) : null;
  } catch {
    cached = null;
  }

  const stale = !lastCheckIso || Date.now() - Date.parse(lastCheckIso) > DAY_MS || !cached;
  let checkError = await getSetting("github_last_error");

  if (force || stale) {
    try {
      cached = await fetchLatestRelease();
      checkError = null;
      await setSetting("github_latest_release", JSON.stringify(cached));
      await setSetting("github_last_error", null);
      await setSetting("github_last_check_iso", new Date().toISOString());
      await setSetting("github_last_check", localDateTime());
    } catch (e) {
      checkError = e.message;
      await setSetting("github_last_error", e.message);
      await setSetting("github_last_check_iso", new Date().toISOString());
      await setSetting("github_last_check", localDateTime());
    }
  }

  const pendingStatus = await getSetting("github_update_state");
  const latest = cached?.tag || null;
  const available = latest ? isNewer(latest, installed) : false;

  let status = "Up to Date";
  if (checkError && !latest) status = "Check Failed";
  else if (pendingStatus === "Updating") status = "Updating";
  else if (available) status = "Update Available";

  return {
    repo: GITHUB_REPO,
    installed_version: installed,
    latest_version: latest,
    update_available: available,
    status,
    release: cached,
    last_checked: await getSetting("github_last_check"),
    error: checkError || null,
  };
}

/* ------------------------------------------------------------------ *
 * One-click install from GitHub
 * ------------------------------------------------------------------ */
export async function installLatestRelease({ adminEmail } = {}) {
  const steps = [];
  const log = (message, level = "info") => steps.push({ at: localDateTime(), level, message });

  log("Checking the latest release on GitHub…");
  let release;
  try {
    release = await fetchLatestRelease();
  } catch (e) {
    log(e.message, "error");
    return { ok: false, error: e.message, steps };
  }
  if (!release.tag) {
    const error = "GitHub did not return a release tag.";
    log(error, "error");
    return { ok: false, error, steps };
  }
  log(`Latest release: ${release.tag}`);

  const installed = await currentVersion();
  if (!isNewer(release.tag, installed)) {
    log(`Installed version v${installed} is already up to date.`, "success");
    return { ok: true, upToDate: true, version: installed, steps };
  }
  if (!release.zip_url) {
    const error = "The release has no downloadable ZIP asset.";
    log(error, "error");
    return { ok: false, error, steps };
  }

  await setSetting("github_update_state", "Updating");
  try {
    log("Downloading the release package…");
    const res = await githubFetch(release.zip_url, downloadHeaders(release.zip_url));
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length) throw new Error("The downloaded package is empty.");
    log(`Downloaded ${release.asset_name} (${(buffer.length / 1048576).toFixed(2)} MB).`);

    // Backup, extract, migrate, rollback-on-failure all happen here.
    const result = await installPackage({ buffer, filename: release.asset_name, adminEmail });
    const merged = steps.concat(result.steps || []);

    await setSetting("github_update_state", result.ok ? "Update Completed" : "Update Failed");
    if (result.ok) await setSetting("github_installed_tag", release.tag);

    return { ...result, tag: release.tag, steps: merged };
  } catch (e) {
    log(e.message, "error");
    await setSetting("github_update_state", "Update Failed");
    return { ok: false, error: e.message, steps };
  }
}

/** Daily background check — records the result so the console can show it. */
export async function runGithubCheckJob() {
  const s = await getUpdateStatus();
  return { latest: s.latest_version, available: s.update_available, error: s.error };
}
