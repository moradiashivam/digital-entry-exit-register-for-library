export async function renderInstitutes(view, { api, esc, toast }) {
  const today = new Date().toISOString().slice(0, 10);
  const nextYear = (() => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10); })();
  let rows = [];
  let adminFor = null;

  view.innerHTML = `
    <div class="panel">
      <h3>Create a university</h3>
      <div class="grid cols-4" style="margin-top:.5rem">
        <div><label for="n_name">Name</label><input id="n_name" style="width:100%" placeholder="Vidya University" /></div>
        <div><label for="n_slug">Kiosk link</label><input id="n_slug" style="width:100%" placeholder="vidya" /></div>
        <div><label for="n_start">Subscription start</label><input id="n_start" type="date" value="${today}" style="width:100%" /></div>
        <div><label for="n_end">Subscription end</label><input id="n_end" type="date" value="${nextYear}" style="width:100%" /></div>
        <div><label for="n_email">Contact email</label><input id="n_email" type="email" style="width:100%" /></div>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:.9rem">
        <button id="create" class="btn-primary">Create university</button>
      </div>
    </div>

    <div class="panel" style="margin-top:1rem">
      <h3>Universities</h3>
      <div style="overflow:auto"><table>
        <thead><tr><th>Name</th><th>Kiosk link</th><th>Subscription</th><th>Status</th><th>Members</th><th>Kiosk key</th><th></th></tr></thead>
        <tbody id="tbody"><tr><td colspan="7" class="muted">Loading…</td></tr></tbody>
      </table></div>
    </div>

    <dialog id="dlg">
      <h3 id="dlgTitle">Admin logins</h3>
      <table><thead><tr><th>Email</th><th>Role</th><th>Last login</th><th></th></tr></thead>
        <tbody id="admins"></tbody></table>
      <h4 style="margin-top:1rem">Issue a new login</h4>
      <div class="grid cols-2">
        <div><label for="a_email">Email</label><input id="a_email" type="email" style="width:100%" /></div>
        <div><label for="a_name">Full name</label><input id="a_name" style="width:100%" /></div>
        <div><label for="a_password">Password (8+ characters)</label><input id="a_password" style="width:100%" /></div>
        <div><label for="a_role">Role</label><select id="a_role" style="width:100%">
          <option value="super_admin">University admin</option>
          <option value="librarian">Librarian</option>
          <option value="report_viewer">Report viewer</option></select></div>
      </div>
      <p style="color:var(--danger)" id="adminError"></p>
      <div class="row" style="justify-content:flex-end;margin-top:.8rem">
        <button class="ghost" id="closeDlg">Close</button>
        <button id="createAdmin">Create login</button>
      </div>
    </dialog>`;

  const dlg = view.querySelector("#dlg");
  const active = (r) => r.subscription_start <= today && r.subscription_end >= today;

  const load = async () => {
    rows = (await api("/api/institutes")) || [];
    view.querySelector("#tbody").innerHTML = rows.length
      ? rows.map((r) => `<tr>
          <td>${esc(r.name)}<br><span class="muted">${esc(r.contact_email || "")}</span></td>
          <td><a href="/kiosk/${esc(r.slug)}" target="_blank">/kiosk/${esc(r.slug)}</a></td>
          <td><div class="sub-cell"><input type="date" value="${esc(r.subscription_start)}" data-start="${esc(r.id)}" />
              <input type="date" value="${esc(r.subscription_end)}" data-end="${esc(r.id)}" /></div></td>
          <td><span class="badge ${active(r) ? "ok" : "bad"}">${active(r) ? "Active" : "Expired"}</span></td>
          <td>${r.members}</td>
          <td><div class="key-cell"><code class="key-code muted">${esc(r.kiosk_key || "—")}</code>
              <button class="ghost btn-sm" data-rotate="${esc(r.id)}">Rotate</button></div></td>
          <td class="col-actions"><button class="btn-sm" data-admins="${esc(r.id)}">Admin logins</button></td>
        </tr>`).join("")
      : `<tr><td colspan="7" class="muted">No universities yet.</td></tr>`;
  };

  const loadAdmins = async () => {
    const admins = (await api(`/api/institutes/${adminFor.id}/admins`)) || [];
    view.querySelector("#admins").innerHTML = admins.length
      ? admins.map((a) => `<tr><td>${esc(a.email)}</td><td>${esc(a.role)}</td>
          <td>${esc(a.last_login_at ? String(a.last_login_at).slice(0, 16) : "never")}</td>
          <td class="col-actions"><button class="ghost btn-sm" data-reset="${esc(a.id)}">Reset password</button></td></tr>`).join("")
      : `<tr><td colspan="4" class="muted">No logins issued yet.</td></tr>`;
  };

  view.querySelector("#create").onclick = async () => {
    try {
      await api("/api/institutes", {
        method: "POST",
        body: {
          name: view.querySelector("#n_name").value,
          slug: view.querySelector("#n_slug").value,
          subscription_start: view.querySelector("#n_start").value,
          subscription_end: view.querySelector("#n_end").value,
          contact_email: view.querySelector("#n_email").value || null,
        },
      });
      view.querySelector("#n_name").value = "";
      view.querySelector("#n_slug").value = "";
      toast("University created — now issue its admin login");
      await load();
    } catch (e) {
      toast(e.message, true);
    }
  };

  view.querySelector("#closeDlg").onclick = () => dlg.close();

  view.querySelector("#createAdmin").onclick = async () => {
    view.querySelector("#adminError").textContent = "";
    try {
      await api(`/api/institutes/${adminFor.id}/admins`, {
        method: "POST",
        body: {
          email: view.querySelector("#a_email").value,
          full_name: view.querySelector("#a_name").value,
          password: view.querySelector("#a_password").value,
          role: view.querySelector("#a_role").value,
        },
      });
      view.querySelector("#a_email").value = "";
      view.querySelector("#a_password").value = "";
      toast("Login created");
      await loadAdmins();
    } catch (e) {
      view.querySelector("#adminError").textContent = e.message;
    }
  };

  view.querySelector("#tbody").addEventListener("change", async (e) => {
    const id = e.target.dataset.start || e.target.dataset.end;
    if (!id) return;
    const field = e.target.dataset.start ? "subscription_start" : "subscription_end";
    try {
      await api(`/api/institutes/${id}`, { method: "PATCH", body: { [field]: e.target.value } });
      toast("Subscription updated");
      await load();
    } catch (err) {
      toast(err.message, true);
      await load();
    }
  });

  view.querySelector("#tbody").addEventListener("click", async (e) => {
    const rotate = e.target.dataset.rotate;
    const admins = e.target.dataset.admins;
    if (rotate && confirm("Rotate the kiosk key? The C++ bridge must be updated with the new key.")) {
      await api(`/api/institutes/${rotate}/rotate-key`, { method: "POST" });
      toast("Kiosk key rotated");
      await load();
    }
    if (admins) {
      adminFor = rows.find((r) => r.id === admins);
      view.querySelector("#dlgTitle").textContent = `Admin logins — ${adminFor.name}`;
      await loadAdmins();
      dlg.showModal();
    }
  });

  view.querySelector("#admins").addEventListener("click", async (e) => {
    const reset = e.target.dataset.reset;
    if (!reset) return;
    const password = prompt("New password (8+ characters)");
    if (!password) return;
    try {
      await api(`/api/institutes/${adminFor.id}/admins/${reset}/password`, { method: "POST", body: { password } });
      toast("Password reset");
    } catch (err) {
      toast(err.message, true);
    }
  });

  await load();
}
