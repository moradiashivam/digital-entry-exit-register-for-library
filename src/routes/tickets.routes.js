/**
 * Role-based support ticketing & chat API.
 *
 *  University admin / main librarian -> owner            (kind 'standard')
 *  Sub-library user  -> main librarian -> owner          (kind 'general')
 *  Sub-library user  -> main librarian only              (kind 'rights')
 *
 * After the owner (or the librarian on a rights request) answers, the ticket
 * waits five days for the creator; after that the scheduler accepts it.
 */
import { Router } from "express";
import fs from "node:fs";
import { q, one, uuid } from "../db.js";
import { requireAuth, requireOwner, withInstitute, isMember, rolesFor, logAudit, loadUser } from "../auth.js";
import { sendMail } from "../mailer.js";
import {
  STATUS, AUTO_ACCEPT_DAYS, ticketRole, reviewsSubTickets, saveAttachments,
  logTicketEvent, attachmentsFor, autoAcceptStamp, canSeeTicket, nextTicketNo,
  addTicketMessage, messagesFor, attachmentPath,
} from "../tickets.service.js";

const router = Router();

const tenant = [requireAuth, withInstitute(isMember)];

/* ------------------------------------------------------------------ *
 * Owner presence — "online / away / last active".                      *
 * ------------------------------------------------------------------ */
router.get("/presence/owner", requireAuth, async (_req, res) => {
  const row = await one(
    `SELECT full_name, email, last_seen_at FROM users
      WHERE is_platform_owner = 1 AND status = 'Active'
      ORDER BY last_seen_at IS NULL, last_seen_at DESC LIMIT 1`,
  );
  const last = row?.last_seen_at ? new Date(row.last_seen_at) : null;
  const minutes = last ? (Date.now() - last.getTime()) / 60000 : null;
  const state = minutes === null ? "offline" : minutes < 5 ? "online" : minutes < 60 ? "away" : "offline";
  res.json({
    name: row?.full_name || "Platform owner",
    email: row?.email || null,
    last_seen_at: row?.last_seen_at || null,
    last_active_at: row?.last_seen_at || null,
    state,
    online: state === "online",
  });
});

/* ------------------------------------------------------------------ *
 * Owner inbox.                                                         *
 * ------------------------------------------------------------------ */
router.get("/owner", requireAuth, requireOwner, async (req, res) => {
  const status = String(req.query.status || "");
  const params = [];
  let where = "t.visible_to_owner = 1 AND t.kind <> 'rights'";
  if (status) { where += " AND t.status = ?"; params.push(status); }
  const rows = await q(
    `SELECT t.*, i.name AS institute_name FROM tickets t
     JOIN institutes i ON i.id = t.institute_id
     WHERE ${where} ORDER BY COALESCE(t.last_message_at, t.created_at) DESC LIMIT 500`,
    params,
  );
  const files = await attachmentsFor(rows.map((r) => r.id));
  res.json({
    role: "owner",
    user_id: req.user.id,
    auto_accept_days: AUTO_ACCEPT_DAYS,
    max_attachment_mb: 5,
    tickets: rows.map((r) => ({ ...r, attachments: files.get(r.id) || [] })),
  });
});

router.post("/owner/:id/respond", requireAuth, requireOwner, async (req, res) => {
  const decision = String(req.body?.decision || "");
  if (!["resolved", "denied"].includes(decision)) {
    return res.status(400).json({ error: "Choose Issue resolved or Denied" });
  }
  const ticket = await one(
    "SELECT * FROM tickets WHERE id = ? AND visible_to_owner = 1 AND kind <> 'rights'",
    [req.params.id],
  );
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });
  if (ticket.status === STATUS.ACCEPTED) return res.status(400).json({ error: "This ticket is already closed" });

  const status = decision === "resolved" ? STATUS.RESOLVED : STATUS.DENIED;
  const response = String(req.body?.response || "").slice(0, 4000) || null;
  await q(
    `UPDATE tickets SET status = ?, owner_response = ?, owner_responded_at = NOW(),
            auto_accept_at = ?, stage = 'owner' WHERE id = ?`,
    [status, response, autoAcceptStamp(), ticket.id],
  );
  if (response) await addTicketMessage(ticket.id, req.user, "owner", response);
  await logTicketEvent(ticket.id, req.user, "owner", decision, response, ticket.status, status);
  await logTicketEvent(
    ticket.id, null, "system", "deadline_created",
    `${AUTO_ACCEPT_DAYS}-day acceptance deadline created`, status, status,
  );
  res.json({ ok: true, status, auto_accept_days: AUTO_ACCEPT_DAYS });
});

/* ------------------------------------------------------------------ *
 * University side.                                                     *
 * ------------------------------------------------------------------ */

/** Tickets the signed-in account may see inside this university. */
router.get("/", ...tenant, async (req, res) => {
  const role = ticketRole(req.user, req.institute.id);
  const params = [req.institute.id];
  let where = "institute_id = ?";
  if (role === "sub") {
    where += " AND created_by = ?";
    params.push(req.user.id);
  } else if (role === "librarian") {
    // The main librarian sees their own tickets and everything raised to them.
    where += " AND (created_by = ? OR creator_role = 'sub')";
    params.push(req.user.id);
  } else {
    // The university administrator sees every ticket in the university except
    // the main librarian's private tickets to the owner.
    where += " AND (created_by = ? OR creator_role <> 'librarian')";
    params.push(req.user.id);
  }
  const rows = await q(
    `SELECT * FROM tickets WHERE ${where} ORDER BY COALESCE(last_message_at, created_at) DESC LIMIT 500`,
    params,
  );
  const files = await attachmentsFor(rows.map((r) => r.id));
  res.json({
    role,
    user_id: req.user.id,
    max_attachment_mb: 5,
    auto_accept_days: AUTO_ACCEPT_DAYS,
    tickets: rows.map((r) => ({ ...r, attachments: files.get(r.id) || [] })),
  });
});

/* ------------------------------------------------------------------ *
 * Single ticket (chat view) — one authorisation rule for everybody.    *
 * ------------------------------------------------------------------ */

/** Loads the ticket and decides what the caller may see and do with it. */
async function loadTicket(req, res, next) {
  const ticket = await one("SELECT * FROM tickets WHERE id = ?", [req.params.id]);
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });
  const owner = !!req.user.is_platform_owner;
  const role = owner ? "owner" : ticketRole(req.user, ticket.institute_id);
  if (!owner && !rolesFor(req.user, ticket.institute_id).length) {
    return res.status(403).json({ error: "Not your ticket" });
  }
  if (!canSeeTicket(req.user, role, ticket, { owner })) {
    return res.status(403).json({ error: "Not your ticket" });
  }
  req.ticket = ticket;
  req.ticketRole = role;
  next();
}

function permissions(user, role, t) {
  const open = ![STATUS.ACCEPTED, STATUS.REJECTED].includes(t.status) && t.stage !== "closed";
  const mine = t.created_by === user.id;
  return {
    reply: open || t.status === STATUS.RESOLVED || t.status === STATUS.DENIED,
    respond: role === "owner" && !!t.visible_to_owner
      && [STATUS.PENDING, STATUS.APPROVED].includes(t.status),
    review: role !== "owner" && reviewsSubTickets(role) && t.creator_role === "sub" && t.stage === "librarian",
    review_kind: t.kind === "rights" ? "rights" : "general",
    accept: [STATUS.RESOLVED, STATUS.DENIED].includes(t.status)
      && (mine || (role === "librarian" && t.creator_role === "sub") || role === "admin"),
    share: true,
    open,
  };
}

router.get("/detail/:id", requireAuth, loadTicket, async (req, res) => {
  const { messages, opening } = await messagesFor(req.ticket.id);
  const history = await q(
    "SELECT * FROM ticket_events WHERE ticket_id = ? ORDER BY created_at",
    [req.ticket.id],
  );
  await q(
    "UPDATE ticket_messages SET read_at = NOW() WHERE ticket_id = ? AND read_at IS NULL AND (sender_user_id IS NULL OR sender_user_id <> ?)",
    [req.ticket.id, req.user.id],
  );
  res.json({
    ticket: req.ticket,
    role: req.ticketRole,
    user_id: req.user.id,
    auto_accept_days: AUTO_ACCEPT_DAYS,
    attachments: opening,
    messages,
    history,
    can: permissions(req.user, req.ticketRole, req.ticket),
  });
});

/** Chat reply on a ticket. */
router.post("/detail/:id/messages", requireAuth, loadTicket, async (req, res) => {
  const can = permissions(req.user, req.ticketRole, req.ticket);
  if (!can.reply) return res.status(400).json({ error: "This ticket is closed" });
  const text = String(req.body?.message || "").trim();
  const files = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
  if (!text && !files.length) return res.status(400).json({ error: "Write a message first" });
  try {
    const msg = await addTicketMessage(req.ticket.id, req.user, req.ticketRole, text, files);
    res.json({ ok: true, id: msg.id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** Share the whole ticket over email. */
router.post("/detail/:id/share-email", requireAuth, loadTicket, async (req, res) => {
  const to = String(req.body?.email || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ error: "Enter a valid email address" });
  const t = req.ticket;
  const { messages, opening } = await messagesFor(t.id);
  const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const line = (m) =>
    `<p style="margin:.5rem 0"><b>${esc(m.sender_name || m.sender_role || "")}</b>
      <span style="color:#888">${esc(new Date(m.created_at).toLocaleString())}</span><br>
      ${esc(m.message || "")}</p>`;
  const fileList = [...opening, ...messages.flatMap((m) => m.attachments)]
    .map((a) => `<li>${esc(a.file_name)} (${Math.round(a.size_bytes / 1024)} KB)</li>`).join("");
  const html = `
    <h2>Library Support Ticket ${esc(t.ticket_no || "")}</h2>
    <p><b>Subject:</b> ${esc(t.subject)}<br>
       <b>Created by:</b> ${esc(t.creator_name || t.creator_email || "")}<br>
       <b>Created:</b> ${esc(new Date(t.created_at).toLocaleString())}<br>
       <b>Status:</b> ${esc(t.status)}</p>
    ${t.body ? `<p>${esc(t.body)}</p>` : ""}
    <hr>${messages.map(line).join("")}
    ${t.owner_response ? `<p><b>Owner response:</b> ${esc(t.owner_response)}</p>` : ""}
    ${t.librarian_note ? `<p><b>Main librarian:</b> ${esc(t.librarian_note)}</p>` : ""}
    ${fileList ? `<p><b>Attachments</b></p><ul>${fileList}</ul>` : ""}`;
  try {
    await sendMail({ to, subject: `Library Support Ticket ${t.ticket_no || ""} — ${t.subject}`, html });
    await logTicketEvent(t.id, req.user, req.ticketRole, "shared_email", to, t.status, t.status);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** Guarded attachment download — permissions are checked on every file. */
/** Links in the chat cannot send a header, so a ?token= is accepted here too. */
function tokenFromQuery(req, res, next) {
  if (!req.user && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
    return loadUser(req, res, next);
  }
  next();
}

router.get("/attachments/:fileId", tokenFromQuery, requireAuth, async (req, res) => {
  const file = await one("SELECT * FROM ticket_attachments WHERE id = ?", [req.params.fileId]);
  if (!file) return res.status(404).json({ error: "File not found" });
  const ticket = await one("SELECT * FROM tickets WHERE id = ?", [file.ticket_id]);
  const owner = !!req.user.is_platform_owner;
  const role = owner ? "owner" : ticketRole(req.user, ticket?.institute_id);
  if (!owner && !rolesFor(req.user, ticket?.institute_id).length) {
    return res.status(403).json({ error: "Not allowed" });
  }
  if (!canSeeTicket(req.user, role, ticket, { owner })) return res.status(403).json({ error: "Not allowed" });
  const full = attachmentPath(file);
  if (!fs.existsSync(full)) return res.status(404).json({ error: "File not found" });
  res.setHeader("Content-Type", file.mime);
  res.setHeader("Content-Disposition", `inline; filename="${file.file_name.replace(/"/g, "")}"`);
  fs.createReadStream(full).pipe(res);
});

router.get("/:id/events", ...tenant, async (req, res) => {
  const ticket = await one("SELECT * FROM tickets WHERE id = ? AND institute_id = ?", [
    req.params.id, req.institute.id,
  ]);
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });
  const role = ticketRole(req.user, req.institute.id);
  if (!canSeeTicket(req.user, role, ticket)) return res.status(403).json({ error: "Not your ticket" });
  res.json(await q("SELECT * FROM ticket_events WHERE ticket_id = ? ORDER BY created_at", [ticket.id]));
});

/** Raise a ticket. Where it goes is decided by the caller's role. */
router.post("/", ...tenant, async (req, res) => {
  const role = ticketRole(req.user, req.institute.id);
  const subject = String(req.body?.subject || "").trim();
  if (!subject) return res.status(400).json({ error: "Add a short subject" });

  let kind = "standard";
  if (role === "sub") kind = req.body?.kind === "rights" ? "rights" : "general";

  const toLibrarian = role === "sub";
  const id = uuid();
  const ticketNo = await nextTicketNo();
  await q(
    `INSERT INTO tickets (id, ticket_no, institute_id, created_by, creator_email, creator_name, creator_role,
       kind, subject, body, priority, status, stage, visible_to_owner, last_message_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      id, ticketNo, req.institute.id, req.user.id, req.user.email, req.user.full_name || null, role,
      kind, subject.slice(0, 200), String(req.body?.body || "").slice(0, 8000) || null,
      ["Low", "Normal", "High"].includes(req.body?.priority) ? req.body.priority : "Normal",
      STATUS.PENDING, toLibrarian ? "librarian" : "owner", toLibrarian ? 0 : 1,
    ],
  );
  try {
    await saveAttachments(id, Array.isArray(req.body?.attachments) ? req.body.attachments : []);
  } catch (e) {
    await q("DELETE FROM tickets WHERE id = ?", [id]);
    return res.status(400).json({ error: e.message });
  }
  await logTicketEvent(id, req.user, role, "created", subject, null, STATUS.PENDING);
  await logAudit(req, req.institute.id, "ticket.create", "tickets", id, { kind, subject });
  res.json({ ok: true, id, ticket_no: ticketNo });
});

/** Main librarian / university admin decides on a sub-library user's ticket. */
router.post("/:id/review", ...tenant, async (req, res) => {
  const role = ticketRole(req.user, req.institute.id);
  if (!reviewsSubTickets(role)) return res.status(403).json({ error: "Main librarian only" });
  const ticket = await one("SELECT * FROM tickets WHERE id = ? AND institute_id = ?", [
    req.params.id, req.institute.id,
  ]);
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });
  if (!canSeeTicket(req.user, role, ticket)) return res.status(403).json({ error: "Not your ticket" });
  if (ticket.creator_role !== "sub") return res.status(400).json({ error: "This ticket is not for review" });
  if (ticket.stage !== "librarian") return res.status(400).json({ error: "This ticket has already been reviewed" });

  const decision = String(req.body?.decision || "");
  const note = String(req.body?.note || "").slice(0, 4000) || null;

  if (ticket.kind === "rights") {
    // Internal request — the librarian closes it, it never reaches the owner.
    if (!["resolve", "deny"].includes(decision)) {
      return res.status(400).json({ error: "Choose Resolve or Deny" });
    }
    const status = decision === "resolve" ? STATUS.RESOLVED : STATUS.DENIED;
    await q(
      `UPDATE tickets SET status = ?, librarian_note = ?, librarian_acted_at = NOW(),
              stage = 'closed', auto_accept_at = ? WHERE id = ?`,
      [status, note, autoAcceptStamp(), ticket.id],
    );
    if (note) await addTicketMessage(ticket.id, req.user, role, note);
    await logTicketEvent(ticket.id, req.user, role, `librarian_${decision}`, note, ticket.status, status);
    return res.json({ ok: true, status });
  }

  if (!["approve", "reject"].includes(decision)) {
    return res.status(400).json({ error: "Choose Approve or Reject" });
  }
  const status = decision === "approve" ? STATUS.APPROVED : STATUS.REJECTED;
  if (decision === "approve") {
    await q(
      `UPDATE tickets SET status = ?, librarian_note = ?, librarian_acted_at = NOW(),
              stage = 'owner', visible_to_owner = 1 WHERE id = ?`,
      [status, note, ticket.id],
    );
  } else {
    await q(
      `UPDATE tickets SET status = ?, librarian_note = ?, librarian_acted_at = NOW(),
              stage = 'closed', closed_at = NOW() WHERE id = ?`,
      [status, note, ticket.id],
    );
  }
  if (note) await addTicketMessage(ticket.id, req.user, role, note);
  await logTicketEvent(ticket.id, req.user, role, `librarian_${decision}`, note, ticket.status, status);
  await logAudit(req, req.institute.id, `ticket.${decision}`, "tickets", ticket.id, { note });
  res.json({ ok: true });
});

/** The creator closes the ticket after the answer (otherwise done automatically). */
router.post("/:id/accept", ...tenant, async (req, res) => {
  const ticket = await one("SELECT * FROM tickets WHERE id = ? AND institute_id = ?", [
    req.params.id, req.institute.id,
  ]);
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });
  const role = ticketRole(req.user, req.institute.id);
  if (!canSeeTicket(req.user, role, ticket)) return res.status(403).json({ error: "Not your ticket" });
  const mayClose = ticket.created_by === req.user.id || role === "admin"
    || (role === "librarian" && ticket.creator_role === "sub");
  if (!mayClose) return res.status(403).json({ error: "Not your ticket" });
  if (![STATUS.RESOLVED, STATUS.DENIED].includes(ticket.status)) {
    return res.status(400).json({ error: "Nothing to accept yet" });
  }
  await q(
    `UPDATE tickets SET status = ?, stage = 'closed', closed_at = NOW(), accepted_at = NOW(),
            accepted_by = ?, acceptance_type = 'MANUAL', auto_accept_at = NULL
      WHERE id = ?`,
    [STATUS.ACCEPTED, req.user.full_name || req.user.email, ticket.id],
  );
  await logTicketEvent(ticket.id, req.user, role, "accepted", req.body?.note || null, ticket.status, STATUS.ACCEPTED);
  res.json({ ok: true });
});

export default router;
