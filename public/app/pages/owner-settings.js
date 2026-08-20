const arr = (v) => (Array.isArray(v) ? v : []);

export async function renderOwnerSettings(view, { api, esc, toast, fmtDate }) {
  let bound = false;
  const draw = async () => {
    const data = (await api("/api/owner/settings")) || {};
    const s = data.settings || {};
    const profiles = arr(data.smtp);
    const primary = profiles.find((p) => !p.is_fallback) || {};
    const fallback = profiles.find((p) => p.is_fallback) || {};

    const smtpForm = (id, p, label) => `
      <div class="panel" data-smtp="${id}">
        <h4 style="margin-top:0">${label}${p.id ? "" : " (not configured)"}</h4>
        <input type="hidden" data-f="id" value="${esc(p.id || "")}" />
        <div class="row">
          <div><label>Label</label><input data-f="label" value="${esc(p.label || label)}" /></div>
          <div style="min-width:180px"><label>Host</label><input data-f="host" value="${esc(p.host || "")}" placeholder="smtp.gmail.com" /></div>
          <div><label>Port</label><input data-f="port" type="number" value="${esc(p.port || 587)}" style="width:6rem" /></div>
          <div><label>Encryption</label><select data-f="encryption_type">
            ${["tls", "ssl", "none"].map((e) => `<option value="${e}" ${e === (p.encryption_type || "tls") ? "selected" : ""}>${e.toUpperCase()}</option>`).join("")}
          </select></div>
        </div>
        <div class="row">
          <div><label>Username</label><input data-f="username" value="${esc(p.username || "")}" autocomplete="off" /></div>
          <div><label>Password</label><input data-f="password" type="password" autocomplete="new-password"
            placeholder="${p.has_password ? "•••••••• (unchanged)" : "app password"}" /></div>
          <div><label>From name</label><input data-f="from_name" value="${esc(p.from_name || "Library Register")}" /></div>
          <div><label>From email</label><input data-f="from_email" value="${esc(p.from_email || "")}" /></div>
          <div><label>Reply-to</label><input data-f="reply_to" value="${esc(p.reply_to || "")}" /></div>
        </div>
        <div class="row" style="margin-top:.6rem">
          <button data-save-smtp="${id}">Save profile</button>
          <button class="ghost" data-test-smtp="${id}">Send test email</button>
          ${p.id ? `<button class="ghost" data-del-smtp="${esc(p.id)}">Remove</button>` : ""}
        </div>
        <p class="muted">Passwords are encrypted with AES-256-GCM before they are stored.</p>
      </div>`;

    view.innerHTML = `
      <div class="panel">
        <h3 style="margin-top:0">Company &amp; invoicing</h3>
        <div class="row">
          <div style="min-width:200px"><label for="c_name">Company name</label>
            <input id="c_name" style="width:100%" value="${esc(s.company_name || "")}" /></div>
          <div><label for="c_gst">GST / Tax number</label><input id="c_gst" value="${esc(s.gst_number || "")}" /></div>
          <div><label for="c_currency">Currency</label><input id="c_currency" value="${esc(s.currency || "INR")}" style="width:6rem" /></div>
          <div><label for="c_grace">Grace period (days)</label>
            <input id="c_grace" type="number" min="0" max="60" value="${esc(s.grace_days || 5)}" style="width:7rem" /></div>
        </div>
        <div class="row">
          <div style="flex:1;min-width:240px"><label for="c_addr">Company address</label>
            <textarea id="c_addr" rows="2" style="width:100%">${esc(s.company_address || "")}</textarea></div>
          <div style="flex:1;min-width:240px"><label for="c_foot">Invoice footer</label>
            <textarea id="c_foot" rows="2" style="width:100%">${esc(s.invoice_footer || "")}</textarea></div>
        </div>
        <button id="saveSettings" style="margin-top:.6rem">Save settings</button>
        <p class="muted">During the grace period an expired university keeps read-only access before it is suspended.</p>
      </div>

      <h3 style="margin:1.2rem 0 .4rem">Email (SMTP)</h3>
      ${smtpForm("primary", primary, "Primary SMTP")}
      <div style="margin-top:1rem">${smtpForm("fallback", { ...fallback, is_fallback: 1 }, "Fallback SMTP")}</div>

      <div class="panel" style="margin-top:1rem">
        <h3 style="margin-top:0">Master database backup &amp; restore</h3>
        <p class="muted">Downloads every table of the platform database — all universities, members, logs, plans,
          payments, leads and accounts — as a single JSON file. Keep it somewhere safe: it contains all tenant data.</p>
        <div class="row">
          <button id="mbDownload">Download master backup</button>
        </div>
        <hr style="border:none;border-top:1px solid var(--line);margin:1rem 0" />
        <div class="row" style="align-items:center">
          <input type="file" id="mbFile" accept="application/json,.json" />
          <button class="ghost" id="mbRestore">Restore master backup</button>
        </div>
        <p class="muted" style="color:var(--danger)">Warning: a master restore wipes and replaces the entire database,
          including logins. Data that is not in the backup file cannot be recovered. You may have to sign in again.</p>
        <p class="muted" id="mbStatus"></p>
      </div>

      <div class="panel" style="margin-top:1rem">
        <h3 style="margin-top:0">Platform audit trail</h3>
        <div id="audit" class="muted">Loading…</div>
      </div>`;

    const mbStatus = view.querySelector("#mbStatus");
    view.querySelector("#mbDownload").onclick = async () => {
      mbStatus.textContent = "Preparing master backup…";
      try {
        const data = await api("/api/backup/master/export");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
        a.download = `master-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        mbStatus.textContent = `Downloaded ${Object.keys(data.tables).length} tables.`;
        toast("Master backup downloaded");
      } catch (e) {
        mbStatus.textContent = `Failed: ${e.message}`;
        toast(e.message, true);
      }
    };

    view.querySelector("#mbRestore").onclick = async () => {
      const file = view.querySelector("#mbFile").files?.[0];
      if (!file) return toast("Choose a master backup file first", true);
      let backup;
      try {
        backup = JSON.parse(await file.text());
      } catch {
        return toast("That file is not a valid backup", true);
      }
      if (!confirm("Replace the entire platform database with this backup?")) return;
      if (!confirm("Final confirmation: all current data, including universities and logins, will be permanently deleted and cannot be recovered without another backup. Continue?")) return;
      mbStatus.textContent = "Restoring master database…";
      try {
        const r = await api("/api/backup/master/restore", { method: "POST", body: { backup } });
        mbStatus.textContent = `Restored ${Object.keys(r.summary).length} tables. Sign in again if your session stops working.`;
        toast("Master backup restored");
      } catch (e) {
        mbStatus.textContent = `Failed: ${e.message}`;
        toast(e.message, true);
      }
    };


    view.querySelector("#saveSettings").onclick = async () => {
      try {
        await api("/api/owner/settings", {
          method: "PUT",
          body: {
            company_name: view.querySelector("#c_name").value,
            company_address: view.querySelector("#c_addr").value,
            gst_number: view.querySelector("#c_gst").value,
            currency: view.querySelector("#c_currency").value,
            invoice_footer: view.querySelector("#c_foot").value,
            grace_days: view.querySelector("#c_grace").value,
          },
        });
        toast("Settings saved");
      } catch (e) {
        toast(e.message, true);
      }
    };

    const readSmtp = (key) => {
      const box = view.querySelector(`[data-smtp="${key}"]`);
      const body = { is_fallback: key === "fallback" };
      for (const el of box.querySelectorAll("[data-f]")) {
        if (el.dataset.f === "password" && !el.value) continue;
        body[el.dataset.f] = el.value;
      }
      if (!body.id) delete body.id;
      return body;
    };

    if (!bound) {
      bound = true;
      view.addEventListener("click", async (e) => {
      const save = e.target.dataset.saveSmtp;
      const test = e.target.dataset.testSmtp;
      const del = e.target.dataset.delSmtp;
      if (!save && !test && !del) return;
      try {
        if (save) {
          await api("/api/owner/smtp", { method: "PUT", body: readSmtp(save) });
          toast("SMTP profile saved");
          await draw();
        } else if (test) {
          const to = prompt("Send the test email to:");
          if (!to) return;
          const r = await api("/api/owner/smtp/test", { method: "POST", body: { ...readSmtp(test), to } });
          toast(`Test email sent to ${r.to}`);
        } else if (del) {
          await api(`/api/owner/smtp/${del}`, { method: "DELETE" });
          toast("SMTP profile removed");
          await draw();
        }
      } catch (err) {
        toast(err.message, true);
      }
      });
    }

    const audit = arr(await api("/api/owner/audit"));
    view.querySelector("#audit").innerHTML = audit.length
      ? `<div style="overflow:auto"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>University</th></tr></thead>
         <tbody>${audit.map((a) => `<tr><td class="muted">${esc(fmtDate(a.created_at))}</td>
           <td>${esc(a.admin_email || "system")}</td><td>${esc(a.action)}</td>
           <td>${esc(a.institute || "—")}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="muted">No platform activity recorded yet.</p>`;
  };

  await draw();
}
