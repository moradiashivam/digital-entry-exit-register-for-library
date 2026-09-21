/**
 * Shared "universities using the register" counter.
 *
 * Every installation reports its own number of active universities to one
 * central counter and reads back the combined total, so each public home page
 * shows the same network-wide figure. Only an anonymous installation id and a
 * count ever leave this server — no names, contacts or member data.
 */
import crypto from "node:crypto";
import { q } from "./db.js";
import { getSetting, setSetting, storedVersion } from "./version.js";

const DEFAULT_HUB = "https://palm-guard-log.lovable.app";
const REPORT_MS = 6 * 60 * 60 * 1000; // every 6 hours
const TIMEOUT_MS = 5000;

const hubUrl = () => {
  const raw = String(process.env.NETWORK_HUB_URL ?? DEFAULT_HUB).trim();
  if (!raw || raw.toLowerCase() === "off") return null;
  return `${raw.replace(/\/+$/, "")}/api/public/network-stats`;
};

/** Stable anonymous id for this installation, created once and kept in settings. */
export async function nodeId() {
  let id = await getSetting("network_node_id");
  if (!id) {
    id = crypto.randomBytes(16).toString("hex");
    await setSetting("network_node_id", id);
  }
  return id;
}

/** Active universities held by this installation. */
export async function localCount() {
  const rows = await q("SELECT COUNT(*) AS n FROM institutes WHERE status = 'Active'");
  return Number(rows[0]?.n || 0);
}

let cache = { total: 0, installations: 0, self: 0, source: "local", at: 0 };

/** Sends this installation's count to the hub and caches the combined total. */
export async function report() {
  const self = await localCount();
  cache = { ...cache, self, at: Date.now() };

  const url = hubUrl();
  if (!url) {
    cache = { total: self, installations: 1, self, source: "local", at: Date.now() };
    await setSetting("network_total", String(self));
    return cache;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        node_id: await nodeId(),
        institute_count: self,
        app_version: (await storedVersion().catch(() => null)) || process.env.npm_package_version || "1.0.0",
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`hub responded ${res.status}`);
    const data = await res.json();
    const total = Math.max(Number(data.total) || 0, self);
    cache = {
      total,
      installations: Number(data.installations) || 1,
      self,
      source: "network",
      at: Date.now(),
    };
    await setSetting("network_total", String(total));
    await setSetting("network_total_at", new Date().toISOString());
  } catch {
    // Offline or hub unreachable — fall back to the last known total.
    const stored = Number(await getSetting("network_total").catch(() => null)) || 0;
    cache = {
      total: Math.max(stored, self),
      installations: cache.installations || 1,
      self,
      source: stored ? "cached" : "local",
      at: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
  return cache;
}

/** Cached figures for the public page — never waits on the internet. */
export async function stats() {
  if (!cache.at) {
    const stored = Number(await getSetting("network_total").catch(() => null)) || 0;
    const self = await localCount().catch(() => 0);
    cache = {
      total: Math.max(stored, self),
      installations: cache.installations || 1,
      self,
      source: stored ? "cached" : "local",
      at: Date.now(),
    };
  }
  return { total: cache.total, installations: cache.installations, self: cache.self, source: cache.source };
}

export const REPORT_INTERVAL_MS = REPORT_MS;
