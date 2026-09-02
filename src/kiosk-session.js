/**
 * Admin-approved kiosk devices.
 *
 * Opening the kiosk URL on a new computer creates a *pending* session and
 * stores a cookie on that computer. Until an admin approves it the kiosk can
 * neither scan nor add visitor entries. Approval lasts `DEFAULT_DAYS` days and
 * can be extended or revoked from the admin panel at any time.
 */
import crypto from "node:crypto";
import { q, one, uuid, localDateTime } from "./db.js";

export const COOKIE_NAME = "ler_kiosk";
export const DEFAULT_DAYS = 45;

/** Minimal cookie-header parser — the app has no cookie middleware. */
export function readCookie(req, name = COOKIE_NAME) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function setSessionCookie(res, token, days = DEFAULT_DAYS) {
  const maxAge = Math.max(1, Number(days) || DEFAULT_DAYS) * 24 * 60 * 60;
  res.append(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; SameSite=Lax; HttpOnly`,
  );
}

const newToken = () => crypto.randomBytes(24).toString("hex").slice(0, 48);
const newCode = () => crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 6);

export async function logSessionEvent(instituteId, sessionId, action, user, days, note) {
  await q(
    `INSERT INTO kiosk_session_events (id, institute_id, session_id, action, admin_id, admin_email, days, note)
     VALUES (?,?,?,?,?,?,?,?)`,
    [uuid(), instituteId, sessionId, action, user?.id ?? null, user?.email ?? null,
     days ?? null, note ? String(note).slice(0, 250) : null],
  );
}

export const isLive = (s) =>
  !!s && s.status === "approved" && (!s.expires_at || localDateTime() <= localDateTime(new Date(s.expires_at)));

/** State of the calling device: creates a pending session when unknown. */
export async function resolveSession(req, res, institute, deviceId, { create = false } = {}) {
  const token = readCookie(req);
  let row = token
    ? await one("SELECT * FROM kiosk_sessions WHERE token = ? AND institute_id = ?", [token, institute.id])
    : null;

  if (!row && create) {
    const device = await one(
      "SELECT id, name, location FROM kiosk_devices WHERE institute_id = ? AND device_id = ?",
      [institute.id, deviceId],
    );
    const fresh = newToken();
    const id = uuid();
    await q(
      `INSERT INTO kiosk_sessions (id, institute_id, kiosk_id, device_id, token, code, status, label, user_agent, ip)
       VALUES (?,?,?,?,?,?,'pending',?,?,?)`,
      [id, institute.id, device?.id ?? null, deviceId, fresh, newCode(),
       device ? [device.name, device.location].filter(Boolean).join(" · ").slice(0, 150) : deviceId,
       String(req.headers["user-agent"] || "").slice(0, 250),
       String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim().slice(0, 60)],
    );
    setSessionCookie(res, fresh);
    row = await one("SELECT * FROM kiosk_sessions WHERE id = ?", [id]);
    await logSessionEvent(institute.id, id, "requested", null, null, row.label);
  }

  if (row) {
    await q("UPDATE kiosk_sessions SET last_seen_at = ? WHERE id = ?", [localDateTime(), row.id]);
    // Keep the cookie alive for the whole approved window.
    if (isLive(row)) setSessionCookie(res, row.token);
  }
  return row;
}

export function sessionState(row) {
  if (!row) return { status: "unknown", message: "This device is not registered for kiosk use." };
  if (row.status === "revoked") {
    return { status: "revoked", code: row.code, message: "This device was revoked by the library administrator." };
  }
  if (row.status === "pending") {
    return { status: "pending", code: row.code, message: "Waiting for administrator approval." };
  }
  if (!isLive(row)) {
    return { status: "expired", code: row.code, expires_at: row.expires_at, message: "Kiosk approval has expired — ask the administrator to extend it." };
  }
  return { status: "approved", code: row.code, expires_at: row.expires_at };
}
