/**
 * Role-based support ticketing & chat — shared helpers.
 *
 * Who is who inside a university:
 *   admin      — university administrator (super_admin)
 *   librarian  — main librarian
 *   sub        — sublibrary / operator / viewer accounts
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { q, one, uuid, localDateTime } from "./db.js";
import { rolesFor } from "./auth.js";

const __dirname = moduleDir(import.meta.url);
import { DATA_ROOT, moduleDir } from "./runtime-paths.js";
/** Attachments live outside /public so they can only be fetched through the guarded route. */
const UPLOAD_ROOT = path.join(DATA_ROOT, "storage", "tickets");

/** Anything bigger is refused — the user is asked to share it over email. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const EXT = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/gif": "gif",
  "image/webp": "webp", "application/pdf": "pdf",
};

export const STATUS = {
  PENDING: "Pending",
  APPROVED: "Approved by Main Librarian",
  REJECTED: "Rejected by Main Librarian",
  RESOLVED: "Resolved",
  DENIED: "Denied",
  ACCEPTED: "Accepted",
};

/** Days a ticket waits for the creator before it is accepted automatically. */
export const AUTO_ACCEPT_DAYS = 5;

export function ticketRole(user, instituteId) {
  const roles = rolesFor(user, instituteId);
  if (roles.includes("super_admin")) return "admin";
  if (roles.includes("librarian")) return "librarian";
  return "sub";
}

/** Main librarians and the university administrator review sub-user tickets. */
export const reviewsSubTickets = (role) => role === "admin" || role === "librarian";

/** TKT-2026-00125 — sequential inside the calendar year. */
export async function nextTicketNo() {
  const year = new Date().getFullYear();
  const row = await one(
    `SELECT MAX(CAST(SUBSTRING(ticket_no, 10) AS UNSIGNED)) AS n
       FROM tickets WHERE ticket_no LIKE ?`,
    [`TKT-${year}-%`],
  );
  return `TKT-${year}-${String((row?.n || 0) + 1).padStart(5, "0")}`;
}

/**
 * Single visibility rule used by every ticket route, so nobody can reach
 * another ticket by changing the id in the URL.
 *   owner            — only tickets forwarded to the owner
 *   university admin — every ticket of the university except the main
 *                      librarian's private tickets to the owner
 *   main librarian   — own tickets + every sub-library ticket
 *   sub-library user — own tickets only
 */
export function canSeeTicket(user, role, ticket, { owner = false } = {}) {
  if (!ticket) return false;
  if (owner) return !!ticket.visible_to_owner && ticket.kind !== "rights";
  if (role === "sub") return ticket.created_by === user.id;
  if (role === "librarian") return ticket.created_by === user.id || ticket.creator_role === "sub";
  if (role === "admin") {
    return ticket.creator_role !== "librarian" || ticket.created_by === user.id;
  }
  return false;
}

export async function saveAttachments(ticketId, files = [], messageId = null) {
  const saved = [];
  for (const file of files.slice(0, 5)) {
    const raw = String(file?.data || "");
    const match = raw.match(/^data:([\w/+.-]+);base64,/i);
    if (!match) throw new Error("Attach a photo, screenshot or PDF file");
    const mime = match[1].toLowerCase();
    const ext = EXT[mime];
    if (!ext) throw new Error("Only photos (JPG, PNG, GIF, WEBP) and PDF files can be attached");
    const buffer = Buffer.from(raw.slice(raw.indexOf(",") + 1), "base64");
    if (!buffer.length) throw new Error("The attached file is empty");
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      throw new Error("Attachments must be smaller than 5 MB — please share bigger files over email");
    }
    const dir = path.join(UPLOAD_ROOT, ticketId);
    await fs.mkdir(dir, { recursive: true });
    const stored = `${uuid()}.${ext}`;
    const full = path.join(dir, stored);
    await fs.writeFile(full, buffer);
    const row = {
      id: uuid(),
      ticket_id: ticketId,
      message_id: messageId,
      // The original name is shown only as a label; it is never used on disk.
      file_name: String(file.name || `attachment.${ext}`).replace(/[\\/]/g, "_").slice(0, 200),
      mime,
      size_bytes: buffer.length,
      url: "",
      file_path: path.join(ticketId, stored),
    };
    row.url = `/api/tickets/attachments/${row.id}`;
    await q(
      `INSERT INTO ticket_attachments (id, ticket_id, message_id, file_name, mime, size_bytes, url, file_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.ticket_id, row.message_id, row.file_name, row.mime, row.size_bytes, row.url, row.file_path],
    );
    saved.push(row);
  }
  return saved;
}

/** Absolute path of a stored attachment (legacy rows still live under /public). */
export function attachmentPath(row) {
  if (row.file_path) return path.join(UPLOAD_ROOT, row.file_path);
  return path.join(DATA_ROOT, "public", row.url.replace(/^\//, ""));
}

export async function logTicketEvent(ticketId, user, role, action, note, oldStatus = null, newStatus = null) {
  await q(
    `INSERT INTO ticket_events (id, ticket_id, actor_id, actor_email, actor_role, action, old_status, new_status, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uuid(), ticketId, user?.id ?? null, user?.email ?? null, role ?? null, action, oldStatus, newStatus, note || null],
  );
}

/** Adds a chat message (and optional files) to a ticket. */
export async function addTicketMessage(ticketId, user, role, text, files = []) {
  const id = uuid();
  await q(
    `INSERT INTO ticket_messages (id, ticket_id, sender_user_id, sender_role, sender_name, message)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, ticketId, user?.id ?? null, role ?? null, user?.full_name || user?.email || null,
      String(text || "").slice(0, 8000) || null],
  );
  const attachments = await saveAttachments(ticketId, files, id);
  await q("UPDATE tickets SET last_message_at = NOW() WHERE id = ?", [ticketId]);
  return { id, attachments };
}

export async function messagesFor(ticketId) {
  const [messages, files] = await Promise.all([
    q("SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at", [ticketId]),
    q("SELECT * FROM ticket_attachments WHERE ticket_id = ?", [ticketId]),
  ]);
  return {
    messages: messages.map((m) => ({ ...m, attachments: files.filter((f) => f.message_id === m.id) })),
    opening: files.filter((f) => !f.message_id),
  };
}

export async function attachmentsFor(ticketIds) {
  if (!ticketIds.length) return new Map();
  const rows = await q(
    `SELECT * FROM ticket_attachments WHERE ticket_id IN (${ticketIds.map(() => "?").join(",")})`,
    ticketIds,
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.ticket_id)) map.set(r.ticket_id, []);
    map.get(r.ticket_id).push(r);
  }
  return map;
}

/** DATETIME text five days from now, on the computer's own clock. */
export function autoAcceptStamp(days = AUTO_ACCEPT_DAYS) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDateTime(d);
}

/** Tickets waiting on their creator longer than five days become "Accepted". */
export async function runTicketAutoAcceptJob() {
  const due = await q(
    `SELECT id, status FROM tickets
      WHERE status IN (?, ?) AND auto_accept_at IS NOT NULL AND auto_accept_at <= NOW()`,
    [STATUS.RESOLVED, STATUS.DENIED],
  );
  for (const t of due) {
    await q(
      `UPDATE tickets SET status = ?, stage = 'closed', closed_at = NOW(), accepted_at = NOW(),
              accepted_by = 'SYSTEM', acceptance_type = 'AUTO_5_DAYS', auto_accept_at = NULL
        WHERE id = ?`,
      [STATUS.ACCEPTED, t.id],
    );
    await logTicketEvent(
      t.id, null, "system", "auto_accepted",
      `No response within ${AUTO_ACCEPT_DAYS} days`, t.status, STATUS.ACCEPTED,
    );
  }
  return { accepted: due.length };
}
