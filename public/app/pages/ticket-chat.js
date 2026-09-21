/**
 * Role-Based Support Ticketing & Chat — shared chat renderer.
 * Used by the university page (pages/tickets.js) and the owner inbox
 * (pages/owner-tickets.js). The layout is the same; the actions differ.
 */
import { getToken } from "/app/api.js";

const MAX_BYTES = 5 * 1024 * 1024;

/** Guarded attachment links carry the session token as a query parameter. */
const fileUrl = (a) => (a.url.startsWith("/api/") ? `${a.url}?token=${encodeURIComponent(getToken() || "")}` : a.url);

const STATUS_CLASS = {
  "Pending": "warn",
  "Approved by Main Librarian": "warn",
  "Rejected by Main Librarian": "bad",
  "Resolved": "ok",
  "Denied": "bad",
  "Accepted": "ok",
};

const ROLE_LABEL = {
  owner: "Platform owner", admin: "University admin",
  librarian: "Main librarian", sub: "Sub-library user", system: "System",
};

const readFile = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ name: file.name, data: r.result });
    r.onerror = () => reject(new Error(`Could not read ${file.name}`));
    r.readAsDataURL(file);
  });

const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const shortId = (t) => t.ticket_no || `TKT-${String(t.id).slice(0, 8).toUpperCase()}`;

function sinceLabel(value) {
  if (!value) return "";
  const diff = Date.now() - new Date(value).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

function countdown(value) {
  const left = new Date(value).getTime() - Date.now();
  if (left <= 0) return "any moment now";
  const h = Math.floor(left / 3600000);
  const d = Math.floor(h / 24);
  return d >= 1 ? `${d} day${d > 1 ? "s" : ""} ${h % 24} hours` : `${h} hours`;
}

const FILTERS = [
  ["all", "All"],
  ["waiting_me", "Waiting for me"],
  ["waiting_owner", "Waiting for owner"],
  ["Pending", "Pending"],
  ["Resolved", "Resolved"],
  ["Denied", "Denied"],
  ["Accepted", "Accepted"],
  ["rights", "Internal requests"],
  ["mine", "My tickets"],
];

export async function renderTicketApp(view, ctx, { owner = false } = {}) {
  const { api, esc, fmtDate, toast } = ctx;
  let data = await api(owner ? "/api/tickets/owner" : "/api/tickets");
  let presence = null;
  try { presence = await api("/api/tickets/presence/owner"); } catch { /* optional */ }

  const role = data.role;
  const isSub = role === "sub";
  let current = null;      // loaded ticket detail
  let filter = "all";
  let search = "";

  const presenceChip = () => {
    if (!presence) return "";
    const label = presence.state === "online"
      ? "Online"
      : presence.state === "away"
        ? `Away — last active ${esc(fmtDate(presence.last_active_at))}`
        : presence.last_active_at ? `Last active ${esc(fmtDate(presence.last_active_at))}` : "Offline";
    return `<span class="tk-presence ${presence.state}"><i></i>Owner · ${label}</span>`;
  };

  view.innerHTML = `
    <div class="tk-app">
      <header class="tk-topbar">
        <div class="tk-topbar-main">
          <input id="tkSearch" class="tk-search" type="search" placeholder="Search tickets, subject or number">
          <select id="tkFilter" class="tk-filter">
            ${FILTERS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
          </select>
        </div>
        <div class="tk-topbar-side">
          ${owner ? "" : presenceChip()}
          ${owner ? "" : `<button id="tkNew" class="tk-new">New ticket</button>`}
        </div>
      </header>

      <div class="tk-body">
        <aside class="tk-list" id="tkList"></aside>
        <section class="tk-chat" id="tkChat"></section>
      </div>

      <dialog class="tk-dialog" id="tkDialog">
        <form method="dialog" class="tk-dialog-form">
          <div class="tk-dialog-head">
            <h3>Raise a ticket</h3>
            <p class="muted">${isSub
              ? "Your ticket goes to the main librarian first. General tickets reach the platform owner only after the librarian approves them; rights requests stay inside your library."
              : `Your ticket goes straight to the platform owner. If you do not respond to the answer it is accepted automatically after ${data.auto_accept_days} days.`}</p>
          </div>
          <label class="tk-field"><span>Subject</span><input id="tkSubject" maxlength="200" placeholder="Short summary" autocomplete="off"></label>
          <div class="tk-dialog-grid ${isSub ? "" : "single"}">
            <label class="tk-field"><span>Priority</span><select id="tkPriority"><option>Normal</option><option>High</option><option>Low</option></select></label>
            ${isSub ? `<label class="tk-field"><span>Ticket type</span><select id="tkKind">
              <option value="general">General ticket (can reach the owner)</option>
              <option value="rights">Rights / permission request (librarian only)</option>
            </select></label>` : ""}
          </div>
          <label class="tk-field"><span>Details</span><textarea id="tkBody" rows="5" placeholder="Explain the issue or request"></textarea></label>
          <label class="tk-field tk-upload"><span>Attachments <small>JPG, PNG or PDF · max 5 MB each</small></span>
            <input id="tkFiles" type="file" multiple accept="image/*,application/pdf"></label>
          <div class="tk-dialog-actions">
            <button value="cancel" class="ghost" type="submit">Cancel</button>
            <button id="tkCreate" type="button">Submit ticket</button>
          </div>
        </form>
      </dialog>
    </div>`;

  const listEl = view.querySelector("#tkList");
  const chatEl = view.querySelector("#tkChat");
  const dialog = view.querySelector("#tkDialog");

  /* ---------------------------------------------------------- list ---- */

  const waitingForMe = (t) => (owner
    ? ["Pending", "Approved by Main Librarian"].includes(t.status) && t.visible_to_owner
    : (role !== "sub" && t.creator_role === "sub" && t.stage === "librarian")
      || (["Resolved", "Denied"].includes(t.status) && t.created_by === data.user_id));

  const visible = () => data.tickets.filter((t) => {
    if (search) {
      const hay = `${t.subject} ${shortId(t)} ${t.creator_name || ""} ${t.institute_name || ""}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (filter === "all") return true;
    if (filter === "mine") return t.created_by === data.user_id;
    if (filter === "rights") return t.kind === "rights";
    if (filter === "waiting_owner") return !!t.visible_to_owner && ["Pending", "Approved by Main Librarian"].includes(t.status);
    if (filter === "waiting_me") return waitingForMe(t);
    return t.status === filter;
  });

  const paintList = () => {
    const rows = visible();
    listEl.innerHTML = rows.length ? rows.map((t) => `
      <button class="tk-item ${current?.ticket?.id === t.id ? "active" : ""}" data-open="${t.id}">
        <span class="tk-dot ${STATUS_CLASS[t.status] || ""}"></span>
        <span class="tk-item-main">
          <span class="tk-item-top">
            <strong>${esc(owner ? `${t.institute_name || ""} — ${t.subject}` : t.subject)}</strong>
            <span class="muted">${esc(sinceLabel(t.last_message_at || t.created_at))}</span>
          </span>
          <span class="muted tk-item-sub">
            ${esc(shortId(t))} · ${esc(owner ? (t.creator_name || t.creator_email || ROLE_LABEL[t.creator_role] || "") : ROLE_LABEL[t.creator_role] || "")}
            ${t.kind === "rights" ? " · Internal" : ""}
          </span>
          <span class="tk-item-status">${esc(t.status)}</span>
        </span>
      </button>`).join("")
      : `<p class="muted tk-empty-list">No tickets match this filter.</p>`;

    for (const b of listEl.querySelectorAll("[data-open]")) {
      b.onclick = () => openTicket(b.dataset.open);
    }
  };

  /* ---------------------------------------------------------- chat ---- */

  const fileChip = (a) =>
    `<a class="tk-file" href="${esc(fileUrl(a))}" target="_blank" rel="noopener">📎 ${esc(a.file_name)}<span>${kb(a.size_bytes)}</span></a>`;

  const bubble = (m, mine) => `
    <div class="tk-msg ${mine ? "mine" : ""}">
      <div class="tk-msg-meta">${esc(m.sender_name || ROLE_LABEL[m.sender_role] || "")} · ${esc(fmtDate(m.created_at))}</div>
      ${m.message ? `<p>${esc(m.message)}</p>` : ""}
      ${m.attachments?.length ? `<div class="tk-files">${m.attachments.map(fileChip).join("")}</div>` : ""}
    </div>`;

  const historyLine = (h) => `<div class="tk-system">${esc(fmtDate(h.created_at))} · ${esc(
    {
      created: "Ticket created", librarian_approve: "Forwarded to the platform owner",
      librarian_reject: "Rejected by the main librarian", librarian_resolve: "Resolved by the main librarian",
      librarian_deny: "Denied by the main librarian", resolved: "Owner marked the ticket resolved",
      denied: "Owner denied the ticket", deadline_created: "5-day acceptance deadline created",
      accepted: "Accepted and closed", auto_accepted: "Accepted automatically by the system",
      shared_email: "Ticket shared over email",
    }[h.action] || h.action,
  )}</div>`;

  const paintChat = () => {
    if (!current) {
      chatEl.innerHTML = `<div class="tk-placeholder">
        <div class="tk-placeholder-icon">💬</div>
        <strong>Select a ticket</strong>
        <span class="muted">Pick a conversation on the left${owner ? "" : ", or raise a new ticket"}.</span>
      </div>`;
      return;
    }
    const t = current.ticket;
    const can = current.can;
    const feed = [
      ...current.messages.map((m) => ({ at: m.created_at, html: bubble(m, m.sender_user_id === current.user_id) })),
      ...current.history.map((h) => ({ at: h.created_at, html: historyLine(h) })),
    ].sort((a, b) => new Date(a.at) - new Date(b.at));

    const countdownBar = t.auto_accept_at && ["Resolved", "Denied"].includes(t.status)
      ? `<div class="tk-deadline">⏱ Awaiting acceptance — auto-accepts in ${esc(countdown(t.auto_accept_at))}</div>` : "";
    const acceptedBar = t.status === "Accepted" && t.accepted_at
      ? `<div class="tk-deadline done">✓ Accepted on ${esc(fmtDate(t.accepted_at))} · ${
          t.acceptance_type === "AUTO_5_DAYS" ? "System / 5-day auto acceptance" : `by ${esc(t.accepted_by || "user")}`}</div>` : "";

    chatEl.innerHTML = `
      <header class="tk-chat-head">
        <button class="tk-back ghost" id="tkBack">‹ Tickets</button>
        <div>
          <div class="tk-chat-title"><strong>${esc(owner ? `${(data.tickets.find((x) => x.id === t.id)?.institute_name) || t.institute_name || ""} — ${t.subject}` : t.subject)}</strong>
            <span class="pill ${STATUS_CLASS[t.status] || ""}">${esc(t.status)}</span></div>
          <div class="muted tk-chat-sub">
            ${esc(shortId(t))} · ${esc(t.creator_name || t.creator_email || "")}
            (${esc(ROLE_LABEL[t.creator_role] || "")}) · ${esc(fmtDate(t.created_at))}
            ${t.priority !== "Normal" ? ` · ${esc(t.priority)} priority` : ""}
          </div>
        </div>
        <div class="tk-chat-actions">
          ${can.respond ? `<button data-act="resolved">Issue resolved</button>
                           <button class="ghost" data-act="denied">Denied</button>` : ""}
          ${can.review ? (can.review_kind === "rights"
            ? `<button data-act="resolve">Resolve</button><button class="ghost" data-act="deny">Deny</button>`
            : `<button data-act="approve">Approve &amp; forward</button><button class="ghost" data-act="reject">Reject &amp; close</button>`) : ""}
          ${can.accept ? `<button data-act="accept">Accept &amp; close</button>` : ""}
          <button class="ghost" data-act="share">Share via email</button>
        </div>
      </header>
      ${countdownBar}${acceptedBar}
      <div class="tk-feed" id="tkFeed">
        <div class="tk-msg">
          <div class="tk-msg-meta">${esc(t.creator_name || t.creator_email || "")} · ${esc(fmtDate(t.created_at))}</div>
          ${t.body ? `<p>${esc(t.body)}</p>` : `<p class="muted">No description.</p>`}
          ${current.attachments.length ? `<div class="tk-files">${current.attachments.map(fileChip).join("")}</div>` : ""}
        </div>
        ${feed.map((f) => f.html).join("")}
      </div>
      <div class="tk-picked" id="tkPicked" hidden></div>
      <footer class="tk-composer">
        <input type="file" id="tkReplyFiles" multiple accept="image/*,application/pdf" hidden ${can.reply ? "" : "disabled"}>
        <button type="button" class="ghost tk-clip" id="tkClip" title="Attach a file" ${can.reply ? "" : "disabled"}>📎</button>
        <textarea id="tkReply" rows="1" placeholder="${can.reply ? "Type your response..." : "This ticket is closed"}" ${can.reply ? "" : "disabled"}></textarea>
        <button id="tkSend" ${can.reply ? "" : "disabled"}>➤</button>
      </footer>`;

    const feedEl = chatEl.querySelector("#tkFeed");
    feedEl.scrollTop = feedEl.scrollHeight;
    chatEl.querySelector("#tkBack").onclick = () => view.querySelector(".tk-app").classList.remove("show-chat");

    for (const btn of chatEl.querySelectorAll("[data-act]")) {
      btn.onclick = () => runAction(btn, t);
    }
    const picker = chatEl.querySelector("#tkReplyFiles");
    const picked = chatEl.querySelector("#tkPicked");
    chatEl.querySelector("#tkClip").onclick = () => picker.click();
    picker.onchange = () => {
      const files = [...(picker.files || [])];
      picked.hidden = !files.length;
      picked.innerHTML = files.length
        ? `${files.map((f) => `<span class="tk-file">📎 ${esc(f.name)}<span>${kb(f.size)}</span></span>`).join("")}
           <button type="button" class="ghost" id="tkClearFiles">Remove</button>`
        : "";
      const clear = picked.querySelector("#tkClearFiles");
      if (clear) clear.onclick = () => { picker.value = ""; picker.onchange(); };
    };
    chatEl.querySelector("#tkSend").onclick = sendReply;
    chatEl.querySelector("#tkReply").onkeydown = (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); }
    };
  };

  /* -------------------------------------------------------- actions ---- */

  async function refresh(keepId) {
    data = { ...data, ...(await api(owner ? "/api/tickets/owner" : "/api/tickets")) };
    if (keepId) current = await api(`/api/tickets/detail/${keepId}`);
    paintList();
    paintChat();
  }

  async function openTicket(id) {
    try {
      current = await api(`/api/tickets/detail/${id}`);
      view.querySelector(".tk-app").classList.add("show-chat");
      paintList();
      paintChat();
    } catch (e) { toast(e.message, true); }
  }

  async function sendReply() {
    const box = chatEl.querySelector("#tkReply");
    const picker = chatEl.querySelector("#tkReplyFiles");
    const files = [...(picker.files || [])];
    const text = box.value.trim();
    if (!text && !files.length) return;
    if (files.some((f) => f.size > MAX_BYTES)) {
      return toast("Attachments must be smaller than 5 MB — share bigger files over email", true);
    }
    box.disabled = true;
    try {
      await api(`/api/tickets/detail/${current.ticket.id}/messages`, {
        method: "POST",
        body: { message: text, attachments: await Promise.all(files.map(readFile)) },
      });
      box.value = "";
      picker.value = "";
      if (picker.onchange) picker.onchange();
      await refresh(current.ticket.id);
    } catch (e) { toast(e.message, true); }
    box.disabled = false;
  }

  async function runAction(btn, t) {
    const act = btn.dataset.act;
    btn.disabled = true;
    try {
      if (act === "share") {
        const email = prompt("Send this ticket to which email address?");
        if (!email) { btn.disabled = false; return; }
        await api(`/api/tickets/detail/${t.id}/share-email`, { method: "POST", body: { email } });
        toast("Ticket emailed");
      } else if (act === "accept") {
        await api(`/api/tickets/${t.id}/accept`, { method: "POST", body: {} });
        toast("Ticket closed");
      } else if (["resolved", "denied"].includes(act)) {
        const response = prompt("Message for the university (optional)") ?? "";
        await api(`/api/tickets/owner/${t.id}/respond`, { method: "POST", body: { decision: act, response } });
        toast("Response sent");
      } else {
        const note = prompt("Add a note (optional)") ?? "";
        await api(`/api/tickets/${t.id}/review`, { method: "POST", body: { decision: act, note } });
        toast("Ticket updated");
      }
      await refresh(t.id);
    } catch (e) {
      toast(e.message, true);
      btn.disabled = false;
    }
  }

  /* ----------------------------------------------------- new ticket ---- */

  if (!owner) {
    view.querySelector("#tkNew").onclick = () => dialog.showModal();
    view.querySelector("#tkCreate").onclick = async (ev) => {
      const subject = view.querySelector("#tkSubject").value.trim();
      if (!subject) return toast("Add a short subject", true);
      const picked = [...(view.querySelector("#tkFiles").files || [])];
      if (picked.some((f) => f.size > MAX_BYTES)) {
        return toast("Attachments must be smaller than 5 MB — share bigger files over email", true);
      }
      ev.target.disabled = true;
      try {
        const made = await api("/api/tickets", {
          method: "POST",
          body: {
            subject,
            body: view.querySelector("#tkBody").value,
            priority: view.querySelector("#tkPriority").value,
            kind: view.querySelector("#tkKind")?.value,
            attachments: await Promise.all(picked.map(readFile)),
          },
        });
        toast(`Ticket ${made.ticket_no || ""} submitted`);
        dialog.close();
        view.querySelector("#tkSubject").value = "";
        view.querySelector("#tkBody").value = "";
        view.querySelector("#tkFiles").value = "";
        data = await api("/api/tickets");
        paintList();
        await openTicket(made.id);
      } catch (e) { toast(e.message, true); }
      ev.target.disabled = false;
    };
  }

  view.querySelector("#tkFilter").onchange = (e) => { filter = e.target.value; paintList(); };
  view.querySelector("#tkSearch").oninput = (e) => { search = e.target.value.trim().toLowerCase(); paintList(); };

  paintList();
  paintChat();
}
