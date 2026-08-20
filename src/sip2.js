/**
 * SIP2 client — one kiosk codebase, many universities.
 *
 * Every university (institute) stores its own LMS connection in `sip2_settings`
 * (Koha, SirsiDynix Symphony, Ex Libris Alma, Sierra, Libsys, …). At the gate we:
 *   1. open a socket (TCP or TLS) to that university's SIP2 server,
 *   2. login (message 93 -> 94),
 *   3. ask for patron information (message 63 -> 64),
 *   4. read BL (valid patron), AE (name) and the expiry field (PA / PC / PD …).
 *
 * Field codes are configurable per university because vendors are inconsistent
 * about which optional field carries the expiry date.
 */
import net from "node:net";
import tls from "node:tls";
import { decrypt } from "./crypto.js";

export const DEFAULT_FIELD_MAP = {
  patron_id: "AA",
  patron_name: "AE",
  valid_flag: "BL",
  auth_flag: "CQ",
  expiry_date: "PA",
  screen_message: "AF",
  fee_amount: "BV",
  charged_items_count: "CA",
};

export const SIP2_DEFAULTS = {
  port: 6001,
  use_ssl: 0,
  encoding: "UTF-8",
  timeout_ms: 5000,
  retry_count: 3,
  retry_delay_ms: 1000,
  checksum_required: 1,
  delimiter: "|",
  line_terminator: "\r",
};

/** `${VAULT:KEY}` placeholders resolve from the process environment / secrets manager. */
export function resolveSecret(value) {
  const raw = String(value ?? "");
  const m = raw.match(/^\$\{VAULT:([A-Za-z0-9_]+)\}$/);
  if (m) return process.env[m[1]] || "";
  return raw;
}

/** Stored passwords are AES-encrypted; they may also be a ${VAULT:…} pointer. */
export function secretFromColumn(encrypted) {
  return resolveSecret(decrypt(encrypted));
}

const pad = (n, w) => String(n).padStart(w, "0");

/** SIP2 timestamp: YYYYMMDDZZZZHHMMSS (ZZZZ = 4 spaces for local time). */
export function sipTimestamp(d = new Date()) {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}    ` +
    `${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}${pad(d.getSeconds(), 2)}`
  );
}

/** Standard SIP2 checksum: two's complement of the 16-bit sum, as 4 hex chars. */
export function checksum(message) {
  let sum = 0;
  for (const ch of message) sum += ch.charCodeAt(0) & 0xff;
  return ((-sum) >>> 0 & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

function withChecksum(body, seq, cfg) {
  if (!Number(cfg.checksum_required)) return body;
  const withSeq = `${body}AY${seq % 10}AZ`;
  return `${withSeq}${checksum(withSeq)}`;
}

/** Split a SIP2 response into { code, fields } using the configured delimiter. */
export function parseResponse(raw, cfg = SIP2_DEFAULTS) {
  const line = String(raw).replace(/[\r\n]+$/, "");
  const code = line.slice(0, 2);
  const parts = line.split(cfg.delimiter || "|");
  const fields = {};
  // The first chunk is the fixed-length head; variable fields follow.
  for (const part of parts.slice(1)) {
    if (part.length < 2) continue;
    const key = part.slice(0, 2);
    if (!(key in fields)) fields[key] = part.slice(2);
  }
  // Fixed head of a 64 (patron information response) carries the status flags.
  if (code === "64") fields.__status = line.slice(2, 16);
  if (code === "94") fields.__ok = line.slice(2, 3);
  if (code === "98") fields.__ok = "1";
  return { code, fields, raw: line };
}

/** Parse LMS date strings (YYYYMMDD or YYYY-MM-DD, optional time) to YYYY-MM-DD. */
export function parseSipDate(value) {
  const v = String(value || "").trim();
  if (!v) return null;
  const digits = v.replace(/[^0-9]/g, "");
  if (digits.length < 8) return null;
  const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** Merge stored per-university row with the global defaults. */
export function mergeConfig(row = {}) {
  const cfg = { ...SIP2_DEFAULTS, ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== "")) };
  let map = row.field_map;
  if (typeof map === "string") { try { map = JSON.parse(map); } catch { map = null; } }
  cfg.field_map = { ...DEFAULT_FIELD_MAP, ...(map || {}) };
  return cfg;
}

function connect(cfg) {
  return new Promise((resolve, reject) => {
    const opts = { host: cfg.host, port: Number(cfg.port) || 6001 };
    const socket = Number(cfg.use_ssl)
      ? tls.connect({
          ...opts,
          rejectUnauthorized: false,
          ...(net.isIP(String(cfg.host)) ? {} : { servername: String(cfg.host) }),
        }, () => resolve(socket))
      : net.connect(opts, () => resolve(socket));
    socket.setTimeout(Number(cfg.timeout_ms) || 5000);
    socket.once("error", reject);
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("SIP2 connection timed out"));
    });
  });
}

function request(socket, message, cfg) {
  const term = cfg.line_terminator || "\r";
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk) => {
      buf += chunk.toString(cfg.encoding === "UTF-8" ? "utf8" : "latin1");
      if (buf.includes("\r") || buf.includes("\n")) {
        socket.off("data", onData);
        resolve(buf.split(/[\r\n]/).filter(Boolean)[0] || "");
      }
    };
    socket.on("data", onData);
    socket.once("error", reject);
    socket.once("timeout", () => reject(new Error("SIP2 response timed out")));
    socket.write(message + term, cfg.encoding === "UTF-8" ? "utf8" : "latin1");
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function isTlsHandshakeFailure(error) {
  const message = String(error?.message || "");
  return error?.code === "ERR_SSL_WRONG_VERSION_NUMBER"
    || error?.code === "ERR_SSL_PACKET_LENGTH_TOO_LONG"
    || /before secure TLS connection was established|TLS handshake|wrong version number|packet length too long/i.test(message);
}

function connectionError(error, cfg) {
  const host = String(cfg.host || "the SIP2 server");
  const port = Number(cfg.port) || 6001;
  let message;

  if (isTlsHandshakeFailure(error)) {
    message = `The server closed the TLS handshake on ${host}:${port}. This port is probably plain SIP2; turn off Use SSL/TLS and test again.`;
  } else if (error?.code === "ECONNREFUSED") {
    message = `Connection refused by ${host}:${port}. Check the SIP2 host and port, and confirm the LMS SIP service is running.`;
  } else if (error?.code === "ENOTFOUND" || error?.code === "EAI_AGAIN") {
    message = `The SIP2 hostname “${host}” could not be found. Check the hostname and DNS/network connection.`;
  } else if (error?.code === "ETIMEDOUT" || /timed out/i.test(String(error?.message || ""))) {
    message = `Connection to ${host}:${port} timed out. Check the firewall/VPN and ask the LMS provider to whitelist this server's IP address.`;
  } else if (error?.code === "ECONNRESET") {
    message = `The SIP2 server at ${host}:${port} dropped the connection. Check SSL/TLS mode and whether this server's IP address is whitelisted.`;
  } else {
    return error instanceof Error ? error : new Error(String(error || "SIP2 connection failed"));
  }

  const friendly = new Error(message, { cause: error });
  friendly.code = error?.code;
  friendly.sip2TlsHandshakeFailure = isTlsHandshakeFailure(error);
  return friendly;
}

function shouldRetry(error) {
  return !isTlsHandshakeFailure(error)
    && !["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ERR_SSL_WRONG_VERSION_NUMBER", "ERR_SSL_PACKET_LENGTH_TOO_LONG"]
      .includes(error?.code);
}

/**
 * Ask one university's LMS about a card/barcode.
 * Returns { granted, name, valid, expiry, reason, raw }.
 */
export async function patronInformation(row, cardId, { terminal } = {}) {
  const cfg = mergeConfig(row);
  if (!cfg.host) throw new Error("SIP2 host is not configured");

  const user = resolveSecret(cfg.sip_username);
  const password = secretFromColumn(cfg.sip_password_encrypted);
  const termPassword = secretFromColumn(cfg.terminal_password_encrypted);
  const d = cfg.delimiter || "|";
  const attempts = Math.max(1, Number(cfg.retry_count) || 1);
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let socket;
    try {
      socket = await connect(cfg);

      if (user) {
        const login = `9300CN${user}${d}CO${password}${d}${cfg.location_code ? `CP${cfg.location_code}${d}` : ""}`;
        const loginRes = parseResponse(await request(socket, withChecksum(login, 1, cfg), cfg), cfg);
        if (loginRes.code === "94" && loginRes.fields.__ok !== "1") throw new Error("SIP2 login rejected by the LMS");
      }

      const req =
        `63001${sipTimestamp()}          ` +
        `AO${cfg.institution_id || ""}${d}AA${cardId}${d}AC${termPassword}${d}AD${d}BP0${d}BQ9999${d}`;
      const res = parseResponse(await request(socket, withChecksum(req, 2, cfg), cfg), cfg);
      socket.end();

      if (res.code !== "64") throw new Error(`Unexpected SIP2 response (${res.code || "empty"})`);

      const fm = cfg.field_map;
      const name = String(res.fields[fm.patron_name] || "").trim();
      const validFlag = res.fields[fm.valid_flag];
      const valid = validFlag === undefined ? !!name : validFlag === "Y";
      const expiry = parseSipDate(res.fields[fm.expiry_date]);
      const today = new Date().toISOString().slice(0, 10);
      const notExpired = !expiry || expiry >= today;
      const granted = valid && notExpired;

      return {
        granted,
        valid,
        name,
        expiry,
        terminal: terminal || null,
        fee_amount: res.fields[fm.fee_amount] || null,
        charged_items: res.fields[fm.charged_items_count] || null,
        reason: granted
          ? null
          : (String(res.fields[fm.screen_message] || "").trim() || "Membership expired/invalid"),
        raw: cfg.log_transactions === 0 ? undefined : res.raw,
      };
    } catch (e) {
      lastError = e;
      try { socket?.destroy(); } catch { /* ignore */ }
      if (!shouldRetry(e)) break;
      if (attempt < attempts) await sleep(Number(cfg.retry_delay_ms) || 1000);
    }
  }
  throw connectionError(lastError || new Error("SIP2 request failed"), cfg);
}

/** Hide the card number in logs when the university asks for it. */
export const maskId = (id) => String(id || "").replace(/.(?=.{4})/g, "•");
