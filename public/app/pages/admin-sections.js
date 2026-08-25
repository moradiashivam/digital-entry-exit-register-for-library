/**
 * Shared university-administration panels used by the Master Setting page:
 * kiosks / terminals, library working hours, staff, backup & restore and SIP2.
 * Each renderer paints into the element it is given and wires its own events.
 */
import { state } from "/app/admin.js";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* ---------------- Kiosks / terminals ---------------- */

export function kiosksPanel(box, { api, esc, toast }) {
  const slug = state.institute?.slug ?? "";
  box.innerHTML = `
    <div class="panel">
      <h3>Kiosks / terminals</h3>
      <p class="muted">Create one entry for every kiosk computer (main gate, reading hall, second floor…),
        rename them any time, and open each kiosk with its own link. The kiosk name is stored with every
        scan so location-wise reports stay readable.</p>
      <div id="kiosksBox" class="muted">Loading…</div>
      <div class="row" style="margin-top:.8rem;align-items:center;flex-wrap:wrap">
        <input id="newKioskName" placeholder="New kiosk name, e.g. Reading hall" />
        <input id="newKioskLoc" placeholder="Location (optional)" />
        <button id="addKiosk">Add kiosk</button>
      </div>
    </div>`;

  const kiosksBox = box.querySelector("#kiosksBox");
  const kioskLink = (deviceId) => `/kiosk/${slug}?device=${encodeURIComponent(deviceId)}`;

  const paintKiosks = (list) => {
    kiosksBox.classList.remove("muted");
    kiosksBox.innerHTML = list.length
      ? `<table><thead><tr><th>Name</th><th>Location</th><th>Kiosk link</th><th>Active</th><th></th></tr></thead>
        <tbody>${list.map((k) => `<tr data-id="${esc(k.id)}">
          <td><input class="k-name" value="${esc(k.name)}" /></td>
          <td><input class="k-loc" value="${esc(k.location ?? "")}" placeholder="e.g. Main gate" /></td>
          <td><a href="${esc(kioskLink(k.device_id))}" target="_blank">${esc(kioskLink(k.device_id))}</a></td>
          <td style="text-align:center"><input type="checkbox" class="k-active" ${k.is_active ? "checked" : ""} /></td>
          <td class="row" style="gap:.35rem">
            <button class="k-save">Save</button>
            <button class="ghost k-del">Delete</button>
          </td></tr>`).join("")}</tbody></table>`
      : `<p class="muted">No kiosk added yet.</p>`;

    for (const tr of kiosksBox.querySelectorAll("tbody tr")) {
      const id = tr.dataset.id;
      tr.querySelector(".k-save").onclick = async () => {
        try {
          await api(`/api/settings/kiosks/${id}`, {
            method: "PATCH",
            body: {
              name: tr.querySelector(".k-name").value,
              location: tr.querySelector(".k-loc").value,
              is_active: tr.querySelector(".k-active").checked,
            },
          });
          toast("Kiosk saved");
          loadKiosks();
        } catch (e) {
          toast(e.message, true);
        }
      };
      tr.querySelector(".k-del").onclick = async () => {
        if (!confirm("Remove this kiosk? Past scans keep their records.")) return;
        try {
          await api(`/api/settings/kiosks/${id}`, { method: "DELETE" });
          toast("Kiosk removed");
          loadKiosks();
        } catch (e) {
          toast(e.message, true);
        }
      };
    }
  };

  const loadKiosks = () => api("/api/settings/kiosks").then(paintKiosks).catch(() => {
    kiosksBox.textContent = "Could not load kiosks.";
  });
  loadKiosks();

  box.querySelector("#addKiosk").onclick = async () => {
    const name = box.querySelector("#newKioskName").value.trim();
    if (!name) return toast("Give the kiosk a name first", true);
    try {
      await api("/api/settings/kiosks", {
        method: "POST",
        body: { name, location: box.querySelector("#newKioskLoc").value },
      });
      box.querySelector("#newKioskName").value = "";
      box.querySelector("#newKioskLoc").value = "";
      toast("Kiosk added");
      loadKiosks();
    } catch (e) {
      toast(e.message, true);
    }
  };
}

/* ---------------- Library working hours ---------------- */

export function hoursPanel(box, { api, esc, toast }) {
  box.innerHTML = `
    <div class="panel">
      <h3>Library working hours</h3>
      <p class="muted">Set opening and closing time for each day. Anyone still marked inside is
        automatically exited at that day's closing time.</p>
      <div id="hoursBox" class="muted">Loading…</div>
    </div>
    <div class="panel" style="margin-top:1rem">
      <h3>Holiday &amp; special-day calendar</h3>
      <p class="muted">Pick any date to mark it a holiday / closed day, or to give it custom opening
        and closing times. A calendar day always overrides the weekly hours above.</p>
      <div id="specialBox" class="muted">Loading…</div>
    </div>`;

  const hoursBox = box.querySelector("#hoursBox");
  specialDaysPanel(box.querySelector("#specialBox"), { api, esc, toast });

  const paintHours = (days) => {
    hoursBox.classList.remove("muted");
    hoursBox.innerHTML = `
      <table class="hours-table">
        <thead><tr><th>Day</th><th>Opening</th><th>Closing</th><th>Closed</th><th>Auto exit</th></tr></thead>
        <tbody>${days.map((d) => `<tr data-day="${d.weekday}">
          <td>${DAY_NAMES[d.weekday]}</td>
          <td><input type="time" class="h-open" value="${esc(d.open_time)}" ${d.is_closed ? "disabled" : ""} /></td>
          <td><input type="time" class="h-close" value="${esc(d.close_time)}" ${d.is_closed ? "disabled" : ""} /></td>
          <td><input type="checkbox" class="h-closed" ${d.is_closed ? "checked" : ""} /></td>
          <td><input type="checkbox" class="h-auto" ${d.auto_exit ? "checked" : ""} /></td>
        </tr>`).join("")}</tbody>
      </table>
      <div class="row" style="margin-top:.8rem">
        <button id="saveHours">Save working hours</button>
        <button class="ghost" id="runAutoExit">Run auto exit now</button>
      </div>
      <p class="muted" id="hoursStatus" style="margin-top:.5rem"></p>`;

    for (const cb of hoursBox.querySelectorAll(".h-closed")) {
      cb.onchange = () => {
        const tr = cb.closest("tr");
        tr.querySelector(".h-open").disabled = cb.checked;
        tr.querySelector(".h-close").disabled = cb.checked;
      };
    }

    const collect = () => [...hoursBox.querySelectorAll("tbody tr")].map((tr) => ({
      weekday: Number(tr.dataset.day),
      open_time: tr.querySelector(".h-open").value || "09:00",
      close_time: tr.querySelector(".h-close").value || "18:00",
      is_closed: tr.querySelector(".h-closed").checked ? 1 : 0,
      auto_exit: tr.querySelector(".h-auto").checked ? 1 : 0,
    }));

    hoursBox.querySelector("#saveHours").onclick = async () => {
      try {
        await api("/api/settings/hours", { method: "PUT", body: { days: collect() } });
        toast("Working hours saved");
      } catch (e) {
        toast(e.message, true);
      }
    };
    hoursBox.querySelector("#runAutoExit").onclick = async (e) => {
      e.target.disabled = true;
      try {
        const r = await api("/api/settings/hours/auto-exit", { method: "POST" });
        hoursBox.querySelector("#hoursStatus").textContent =
          r.closed ? `Closed ${r.closed} open visit(s).` : "Nobody needed an automatic exit.";
      } catch (err) {
        toast(err.message, true);
      } finally {
        e.target.disabled = false;
      }
    };
  };

  api("/api/settings/hours").then(paintHours).catch(() => {
    hoursBox.textContent = "Could not load working hours.";
  });
}

/* ---------------- Holiday / special-day calendar ---------------- */

const ymdOf = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function specialDaysPanel(box, { api, esc, toast }) {
  let cursor = new Date();
  cursor.setDate(1);
  let days = new Map(); // "YYYY-MM-DD" -> override row
  let selected = ymdOf(new Date());

  const load = async () => {
    const rows = await api("/api/settings/special-days").catch(() => []);
    days = new Map((rows || []).map((r) => [r.day, r]));
    paint();
  };

  const paint = () => {
    box.classList.remove("muted");
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const total = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const today = ymdOf(new Date());
    const monthLabel = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });

    const cells = [];
    for (let i = 0; i < first.getDay(); i++) cells.push(`<div></div>`);
    for (let d = 1; d <= total; d++) {
      const key = ymdOf(new Date(cursor.getFullYear(), cursor.getMonth(), d));
      const row = days.get(key);
      const cls = ["rep-cal-day"];
      if (row) cls.push("has-records");
      if (key === today) cls.push("is-today");
      if (key === selected) cls.push("is-selected");
      const note = row ? (row.is_closed ? "Closed" : `${row.open_time}–${row.close_time}`) : "";
      cells.push(`<button type="button" class="${cls.join(" ")}" data-day="${key}"
        title="${esc(row?.reason || note || "")}">${d}
        <span class="rep-cal-count">${esc(note)}</span></button>`);
    }

    const cur = days.get(selected) || null;
    box.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:center">
        <button class="ghost" id="spPrev" type="button">‹</button>
        <strong>${esc(monthLabel)}</strong>
        <button class="ghost" id="spNext" type="button">›</button>
      </div>
      <div class="rep-cal-grid">
        ${["S", "M", "T", "W", "T", "F", "S"].map((d) => `<div class="rep-cal-dow">${d}</div>`).join("")}
        ${cells.join("")}
      </div>
      <div style="margin-top:1rem;border-top:1px solid var(--line);padding-top:.8rem">
        <div class="row" style="gap:.6rem;flex-wrap:wrap;align-items:end">
          <label>Date<input type="date" id="spDate" value="${esc(selected)}" /></label>
          <label>Reason
            <input id="spReason" maxlength="160" placeholder="Holiday, exam day, maintenance…"
              value="${esc(cur?.reason || "")}" /></label>
          <label style="align-self:center"><input type="checkbox" id="spClosed"
            ${!cur || cur.is_closed ? "checked" : ""} /> Closed all day</label>
          <label>Opening<input type="time" id="spOpen" value="${esc(cur?.open_time || "09:00")}" /></label>
          <label>Closing<input type="time" id="spClose" value="${esc(cur?.close_time || "18:00")}" /></label>
          <label style="align-self:center"><input type="checkbox" id="spAuto"
            ${!cur || cur.auto_exit ? "checked" : ""} /> Auto exit</label>
        </div>
        <div class="row" style="margin-top:.8rem">
          <button id="spSave" type="button">Save this day</button>
          ${cur ? `<button class="ghost" id="spDelete" type="button">Remove override</button>` : ""}
        </div>
      </div>
      ${days.size ? `<table style="margin-top:1rem"><thead><tr><th>Date</th><th>Status</th><th>Reason</th></tr></thead>
        <tbody>${[...days.values()].map((r) => `<tr><td>${esc(r.day)}</td>
          <td>${r.is_closed ? "Closed" : `${esc(r.open_time)} – ${esc(r.close_time)}`}</td>
          <td>${esc(r.reason || "—")}</td></tr>`).join("")}</tbody></table>`
        : `<p class="muted" style="margin-top:1rem">No special days added yet.</p>`}`;

    const toggleTimes = () => {
      const off = box.querySelector("#spClosed").checked;
      box.querySelector("#spOpen").disabled = off;
      box.querySelector("#spClose").disabled = off;
    };
    box.querySelector("#spClosed").onchange = toggleTimes;
    toggleTimes();

    box.querySelector("#spPrev").onclick = () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); paint(); };
    box.querySelector("#spNext").onclick = () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); paint(); };
    for (const btn of box.querySelectorAll(".rep-cal-day")) {
      btn.onclick = () => { selected = btn.dataset.day; paint(); };
    }
    box.querySelector("#spDate").onchange = (e) => {
      if (!e.target.value) return;
      selected = e.target.value;
      cursor = new Date(`${selected}T00:00:00`);
      cursor.setDate(1);
      paint();
    };

    box.querySelector("#spSave").onclick = async () => {
      try {
        await api("/api/settings/special-days", {
          method: "PUT",
          body: {
            day: box.querySelector("#spDate").value,
            reason: box.querySelector("#spReason").value,
            is_closed: box.querySelector("#spClosed").checked ? 1 : 0,
            open_time: box.querySelector("#spOpen").value || "09:00",
            close_time: box.querySelector("#spClose").value || "18:00",
            auto_exit: box.querySelector("#spAuto").checked ? 1 : 0,
          },
        });
        toast("Calendar day saved");
        await load();
      } catch (e) {
        toast(e.message, true);
      }
    };
    const del = box.querySelector("#spDelete");
    if (del) del.onclick = async () => {
      try {
        await api(`/api/settings/special-days/${selected}`, { method: "DELETE" });
        toast("Override removed");
        await load();
      } catch (e) {
        toast(e.message, true);
      }
    };
  };

  load();
}



/* ---------------- Staff with access ---------------- */

export async function staffPanel(box, { api, esc }) {
  box.innerHTML = `
    <div class="panel">
      <h3>Staff with access</h3>
      <table><thead><tr><th>Email</th><th>Role</th><th>Last login</th></tr></thead>
        <tbody id="staff"><tr><td colspan="3" class="muted">Loading…</td></tr></tbody></table>
      <p class="muted" style="margin-top:.6rem">Logins are issued by the platform owner.</p>
    </div>`;
  const staff = (await api("/api/settings/staff").catch(() => [])) || [];
  box.querySelector("#staff").innerHTML = staff.length
    ? staff.map((u) => `<tr><td>${esc(u.email)}</td><td>${esc(u.role)}</td>
        <td>${esc(u.last_login_at ? String(u.last_login_at).slice(0, 16) : "never")}</td></tr>`).join("")
    : `<tr><td colspan="3" class="muted">No staff accounts yet.</td></tr>`;
}

/* ---------------- Backup & restore ---------------- */

export function backupPanel(box, { api, toast }) {
  const slug = state.institute?.slug ?? "";
  box.innerHTML = `
    <div class="panel">
      <h3>Data backup &amp; restore</h3>
      <p class="muted">Downloads a JSON backup of <strong>this university only</strong> — members, palm templates,
        entry/exit logs, imports, master data, audit trail and kiosk settings. Login accounts, passwords and
        other universities are never included.</p>
      <div class="row">
        <button id="bkDownload">Download backup</button>
      </div>
      <hr style="border:none;border-top:1px solid var(--line);margin:1rem 0" />
      <div class="field"><label for="bkMode">Restore mode</label>
        <select id="bkMode">
          <option value="replace">Replace — delete current data, then load the backup</option>
          <option value="merge">Merge — add missing records, keep existing ones</option>
        </select></div>
      <div class="row" style="margin-top:.6rem;align-items:center">
        <input type="file" id="bkFile" accept="application/json,.json" />
        <button class="ghost" id="bkRestore">Restore backup</button>
      </div>
      <p class="muted" style="margin-top:.6rem;color:var(--danger)">Warning: restoring in replace mode permanently
        deletes this university's current records. Deleted data cannot be recovered without a backup file.</p>
      <p class="muted" id="bkStatus"></p>
    </div>`;

  const bkStatus = box.querySelector("#bkStatus");
  const saveJson = (name, data) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  box.querySelector("#bkDownload").onclick = async () => {
    bkStatus.textContent = "Preparing backup…";
    try {
      const data = await api("/api/backup/export");
      const counts = Object.entries(data.tables).map(([k, v]) => `${k}: ${v.length}`).join(", ");
      saveJson(`backup-${slug || "university"}-${new Date().toISOString().slice(0, 10)}.json`, data);
      bkStatus.textContent = `Backup downloaded (${counts}).`;
      toast("Backup downloaded");
    } catch (e) {
      bkStatus.textContent = `Failed: ${e.message}`;
      toast(e.message, true);
    }
  };

  box.querySelector("#bkRestore").onclick = async () => {
    const file = box.querySelector("#bkFile").files?.[0];
    if (!file) return toast("Choose a backup file first", true);
    const mode = box.querySelector("#bkMode").value;
    let backup;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      return toast("That file is not a valid backup", true);
    }
    const from = backup?.institute?.name ? ` taken from "${backup.institute.name}"` : "";
    if (!confirm(`Restore this backup${from} into ${state.institute?.name ?? "this university"} using "${mode}" mode?`)) return;
    if (mode === "replace" && !confirm("This permanently deletes the current members, logs and settings of this university. Deleted data cannot be recovered without a backup. Continue?")) return;
    bkStatus.textContent = "Restoring…";
    try {
      const r = await api("/api/backup/restore", { method: "POST", body: { backup, mode } });
      bkStatus.textContent = `Restored (${Object.entries(r.summary).map(([k, v]) => `${k}: ${v}`).join(", ")}).`;
      toast("Backup restored");
    } catch (e) {
      bkStatus.textContent = `Failed: ${e.message}`;
      toast(e.message, true);
    }
  };
}

/* ---------------- SIP2 / LMS ---------------- */

export function sip2Panel(box, { api, esc, toast }) {
  box.innerHTML = `
    <div class="panel">
      <h3>SIP2 / LMS connection</h3>
      <p class="muted">Verify cards live against this university's library system (Koha, Symphony, Alma, Sierra, Libsys…).
        When a card is unknown locally, the kiosk asks the LMS (message 63) and reads the name (AE), valid flag (BL) and expiry.</p>
      <div id="sipBox" class="muted">Loading…</div>
    </div>`;

  const FIELD_KEYS = [
    ["patron_id", "AA"], ["patron_name", "AE"], ["valid_flag", "BL"], ["auth_flag", "CQ"],
    ["expiry_date", "PA"], ["screen_message", "AF"], ["fee_amount", "BV"], ["charged_items_count", "CA"],
  ];
  const SIP_TEXT = [
    ["host", "SIP2 host / IP"], ["institution_id", "Institution ID (AO)"], ["location_code", "Location code (CP)"],
    ["sip_username", "SIP username"], ["allowed_terminals", "Allowed terminals (comma separated)"],
  ];
  const SIP_NUM = [["port", "Port"], ["timeout_ms", "Timeout (ms)"], ["retry_count", "Retries"], ["retry_delay_ms", "Retry delay (ms)"]];
  const SIP_BOOL = [
    ["enabled", "Enable SIP2 for this university"], ["use_ssl", "Use SSL/TLS (only for a provider-supplied TLS port)"], ["checksum_required", "Send SIP2 checksum"],
    ["auto_create_members", "Create member record from LMS on first scan"],
    ["fallback_to_local", "Allow local members if the LMS is unreachable"],
    ["log_transactions", "Log SIP2 transactions"], ["mask_patron_id_in_logs", "Mask card numbers in logs"],
  ];

  const paintSip = (c) => {
    const sipBox = box.querySelector("#sipBox");
    sipBox.classList.remove("muted");
    sipBox.innerHTML = `
      <div class="sip-section">
        <h4 class="sip-sub">Connection</h4>
        <div class="field-grid">
          <div class="field"><label for="sip_lms_vendor">LMS vendor</label>
            <select id="sip_lms_vendor">
              ${["Koha", "SirsiDynix Symphony", "Ex Libris Alma", "Sierra", "Libsys", "Other"]
                .map((v) => `<option${c.lms_vendor === v ? " selected" : ""}>${esc(v)}</option>`).join("")}
            </select></div>
          <div class="field"><label for="sip_host">SIP2 host / IP</label>
            <input id="sip_host" value="${esc(c.host ?? "")}" /></div>
          <div class="field"><label for="sip_port">Port</label>
            <input id="sip_port" type="number" value="${esc(c.port ?? "")}" /></div>
          <div class="field"><label for="sip_institution_id">Institution ID (AO)</label>
            <input id="sip_institution_id" value="${esc(c.institution_id ?? "")}" /></div>
          <div class="field"><label for="sip_location_code">Location code (CP)</label>
            <input id="sip_location_code" value="${esc(c.location_code ?? "")}" /></div>
        </div>
      </div>

      <div class="sip-section">
        <h4 class="sip-sub">Credentials</h4>
        <div class="field-grid">
          <div class="field"><label for="sip_sip_username">SIP username</label>
            <input id="sip_sip_username" value="${esc(c.sip_username ?? "")}" /></div>
          <div class="field"><label for="sip_sip_password">SIP password ${c.has_sip_password ? "(saved)" : ""}</label>
            <input id="sip_sip_password" type="password" placeholder="leave blank to keep, or \${VAULT:KEY}" /></div>
          <div class="field"><label for="sip_terminal_password">Terminal password (AC) ${c.has_terminal_password ? "(saved)" : ""}</label>
            <input id="sip_terminal_password" type="password" placeholder="leave blank to keep, or \${VAULT:KEY}" /></div>
          <div class="field"><label for="sip_allowed_terminals">Allowed terminals (comma separated)</label>
            <input id="sip_allowed_terminals" value="${esc(c.allowed_terminals ?? "")}" /></div>
        </div>
        <p class="muted" style="margin-top:.5rem">Store secrets outside the database with <code>\${VAULT:KEY}</code> — read from the server environment at scan time.</p>
      </div>

      <div class="sip-section">
        <h4 class="sip-sub">Timeouts & retries</h4>
        <div class="field-grid">
          ${SIP_NUM.filter(([k]) => k !== "port").map(([k, l]) =>
            `<div class="field"><label for="sip_${k}">${l}</label>
             <input id="sip_${k}" type="number" value="${esc(c[k] ?? "")}" /></div>`).join("")}
          <div class="field"><label for="sip_delimiter_char">Field delimiter</label>
            <input id="sip_delimiter_char" value="${esc(c.delimiter_char ?? "|")}" /></div>
        </div>
      </div>

      <div class="sip-section">
        <h4 class="sip-sub">Options</h4>
        <div class="toggle-grid sip-toggles">
          ${SIP_BOOL.map(([k, l]) =>
            `<label class="toggle-item"><input type="checkbox" id="sip_${k}" ${c[k] ? "checked" : ""} /> <span>${l}</span></label>`).join("")}
        </div>
        <p class="muted" style="margin-top:.5rem">Most SIP2 servers (port 6001) use plain TCP. Enable SSL/TLS only for a dedicated TLS port.</p>
      </div>

      <div class="sip-section">
        <h4 class="sip-sub">Field mapping</h4>
        <p class="muted" style="margin-top:0;margin-bottom:.6rem">Vendors differ — expiry is PA, PC or PD.</p>
        <div class="field-grid">
          ${FIELD_KEYS.map(([k, d]) =>
            `<div class="field"><label for="fm_${k}">${k}</label>
             <input id="fm_${k}" maxlength="2" style="text-transform:uppercase"
               value="${esc(c.field_map?.[k] ?? d)}" /></div>`).join("")}
        </div>
      </div>

      <div class="sip-actions">
        <button id="sipSave">Save SIP2 settings</button>
        <input id="sipCard" placeholder="Test card / barcode" class="sip-card" />
        <button class="ghost" id="sipTest">Test connection</button>
      </div>
      <p class="muted" id="sipStatus" style="margin-top:.5rem">${
        c.last_test_at ? `Last test ${esc(String(c.last_test_at).slice(0, 16))} — ${c.last_test_ok ? "OK" : "failed"}: ${esc(c.last_test_message ?? "")}` : "Not tested yet."
      }</p>`;

    const collect = () => {
      const body = { lms_vendor: sipBox.querySelector("#sip_lms_vendor").value, field_map: {} };
      for (const [k] of SIP_TEXT) body[k] = sipBox.querySelector(`#sip_${k}`).value;
      for (const [k] of SIP_NUM) body[k] = Number(sipBox.querySelector(`#sip_${k}`).value);
      for (const [k] of SIP_BOOL) body[k] = sipBox.querySelector(`#sip_${k}`).checked;
      body.delimiter_char = sipBox.querySelector("#sip_delimiter_char").value || "|";
      for (const [k] of FIELD_KEYS) body.field_map[k] = sipBox.querySelector(`#fm_${k}`).value.toUpperCase();
      const pw = sipBox.querySelector("#sip_sip_password").value;
      const tp = sipBox.querySelector("#sip_terminal_password").value;
      if (pw) body.sip_password = pw;
      if (tp) body.terminal_password = tp;
      return body;
    };

    sipBox.querySelector("#sipSave").onclick = async () => {
      try {
        paintSip(await api("/api/sip2", { method: "PUT", body: collect() }));
        toast("SIP2 settings saved");
      } catch (e) { toast(e.message, true); }
    };
    sipBox.querySelector("#sipTest").onclick = async () => {
      const card = sipBox.querySelector("#sipCard").value.trim();
      if (!card) return toast("Enter a test card / barcode", true);
      const status = sipBox.querySelector("#sipStatus");
      status.textContent = "Contacting the LMS…";
      try {
        const r = await api("/api/sip2/test", { method: "POST", body: { card_id: card } });
        status.style.color = "";
        status.textContent = `${r.granted ? "Granted" : "Denied"} — name: ${r.name || "(none)"}, expiry: ${r.expiry || "n/a"}${r.reason ? `, reason: ${r.reason}` : ""}`;
      } catch (e) {
        status.style.color = "var(--danger)";
        status.textContent = `Failed: ${e.message}`;
      }
    };
  };

  api("/api/sip2").then(paintSip).catch(() => {
    box.querySelector("#sipBox").textContent = "SIP2 settings unavailable.";
  });
}
