/**
 * Master Setting — sublibraries, sublibrary users and their permissions.
 * Only the University Administrator of the active university can open this page.
 */
import { kiosksPanel, hoursPanel, staffPanel, backupPanel, sip2Panel } from "/app/pages/admin-sections.js";

const arr = (v) => (Array.isArray(v) ? v : []);


export async function renderMasterSetting(view, { api, esc, toast }) {
  let meta = { modules: [], roles: [], sublibraries: [], kiosks: [], locations: [] };
  let users = [];
  let libs = [];
  let editing = null; // user id being edited, or null for the create form

  const load = async () => {
    [meta, users, libs] = await Promise.all([
      api("/api/users/meta"),
      api("/api/users"),
      api("/api/users/sublibraries"),
    ]);
  };

  const rolePreset = (key) => meta.roles.find((r) => r.key === key) || { modules: [] };

  const form = () => {
    const u = editing ? users.find((x) => x.id === editing) : null;
    const role = u?.role || "operator";
    const preset = rolePreset(role);
    const modules = u ? (u.modules || preset.modules) : preset.modules;
    const pickedLibs = new Set((u?.sublibraries || []).map((s) => s.id));
    const pickedKiosks = new Set((u?.kiosks || []).map((k) => k.id));
    const pickedLocs = new Set(u?.locations || []);

    return `
      <div class="panel">
        <div class="panel-head">
          <h3 style="margin:0">${u ? `Edit ${esc(u.full_name || u.email)}` : "Add User"}</h3>
          <p class="muted">Choose a role, then fine-tune the modules, kiosks and download rights.</p>
        </div>

        <div class="grid cols-2" style="margin-top:.6rem">
          <label>Full name<input id="f_name" value="${esc(u?.full_name || "")}" /></label>
          <label>Email${u ? " (cannot be changed)" : ""}
            <input id="f_email" type="email" value="${esc(u?.email || "")}" ${u ? "disabled" : ""} /></label>
          <label>${u ? "New password (leave blank to keep)" : "Password"}
            <input id="f_password" type="password" autocomplete="new-password" placeholder="At least 8 characters" /></label>
          <label>Role
            <select id="f_role">
              ${meta.roles.map((r) => `<option value="${esc(r.key)}" ${r.key === role ? "selected" : ""}>${esc(r.label)}</option>`).join("")}
            </select>
          </label>
          <label>Account status
            <select id="f_status">
              <option value="Active" ${u?.status !== "Inactive" ? "selected" : ""}>Active</option>
              <option value="Inactive" ${u?.status === "Inactive" ? "selected" : ""}>Inactive (cannot sign in)</option>
            </select>
          </label>
        </div>

        <h4 style="margin:1rem 0 .3rem">Module-wise permission</h4>
        <div class="row" style="flex-wrap:wrap;gap:.5rem">
          ${meta.modules.map((m) => `<label class="badge" style="gap:.4rem">
            <input type="checkbox" class="f_module" value="${esc(m.key)}" ${modules.includes(m.key) ? "checked" : ""} />
            ${esc(m.label)}</label>`).join("")}
        </div>

        <h4 style="margin:1rem 0 .3rem">Rights</h4>
        <div class="row" style="flex-wrap:wrap;gap:.9rem">
          <label class="row" style="gap:.4rem"><input type="checkbox" id="f_viewer" ${u ? (Number(u.viewer_only) ? "checked" : "") : (preset.viewer_only ? "checked" : "")} /> Viewer only (no add / edit / delete)</label>
          <label class="row" style="gap:.4rem"><input type="checkbox" id="f_bulk" ${u ? (Number(u.allow_bulk_upload) ? "checked" : "") : (preset.allow_bulk_upload ? "checked" : "")} /> Allow bulk upload</label>
          <label class="row" style="gap:.4rem"><input type="checkbox" id="f_export" ${u ? (Number(u.allow_export) ? "checked" : "") : (preset.allow_export ? "checked" : "")} /> Allow download / export</label>
        </div>

        <h4 style="margin:1rem 0 .3rem">Library, location and kiosk access</h4>
        <div class="grid cols-3">
          <div>
            <p class="muted">Sublibraries</p>
            ${meta.sublibraries.length
              ? meta.sublibraries.map((s) => `<label class="row" style="gap:.4rem">
                  <input type="checkbox" class="f_lib" value="${esc(s.id)}" ${pickedLibs.has(s.id) ? "checked" : ""} /> ${esc(s.name)}</label>`).join("")
              : `<p class="muted">Add a library below first.</p>`}
          </div>
          <div>
            <p class="muted">Locations</p>
            ${meta.locations.length
              ? meta.locations.map((l) => `<label class="row" style="gap:.4rem">
                  <input type="checkbox" class="f_loc" value="${esc(l)}" ${pickedLocs.has(l) ? "checked" : ""} /> ${esc(l)}</label>`).join("")
              : `<p class="muted">Kiosks have no location set.</p>`}
          </div>
          <div>
            <p class="muted">Kiosks (leave empty for every kiosk)</p>
            ${meta.kiosks.length
              ? meta.kiosks.map((k) => `<label class="row" style="gap:.4rem">
                  <input type="checkbox" class="f_kiosk" value="${esc(k.id)}" ${pickedKiosks.has(k.id) ? "checked" : ""} />
                  ${esc(k.name)} <span class="muted">${esc(k.device_id)}</span></label>`).join("")
              : `<p class="muted">No kiosks yet.</p>`}
          </div>
        </div>

        <div class="row" style="margin-top:1rem;gap:.6rem">
          <button id="f_save" class="primary">${u ? "Save changes" : "Create user"}</button>
          ${u ? `<button id="f_cancel" class="ghost">Cancel</button>` : ""}
        </div>
      </div>`;
  };

  const paint = () => {
    view.innerHTML = `
      <div class="panel">
        <div class="panel-head">
          <h3 style="margin:0">Sublibrary users</h3>
          <p class="muted">The university administrator always keeps full access. Everyone else sees only what is ticked here.</p>
        </div>
        <table>
          <thead><tr><th>User</th><th>Role</th><th>Modules</th><th>Kiosks / locations</th><th>Rights</th><th></th></tr></thead>
          <tbody>${users.length ? users.map((u) => `
            <tr>
              <td>${esc(u.full_name || "—")}<br><span class="muted">${esc(u.email)}</span></td>
              <td>${esc((meta.roles.find((r) => r.key === u.role) || {}).label || u.role)}
                ${u.status === "Inactive" ? `<br><span class="badge">Inactive</span>` : ""}</td>
              <td class="muted">${u.is_admin ? "All modules" : esc((u.modules || []).map((m) => (meta.modules.find((x) => x.key === m) || {}).label || m).join(", ") || "—")}</td>
              <td class="muted">${u.is_admin
                ? "All kiosks"
                : esc([...u.kiosks.map((k) => k.name), ...u.locations, ...u.sublibraries.map((s) => s.name)].join(", ") || "All kiosks")}</td>
              <td class="muted">${u.is_admin ? "Full" : [
                  Number(u.viewer_only) ? "Viewer only" : "Can edit",
                  Number(u.allow_bulk_upload) ? "Bulk upload" : null,
                  Number(u.allow_export) ? "Export" : null,
                ].filter(Boolean).join(" · ")}</td>
              <td class="row" style="gap:.4rem">
                <button class="ghost" data-edit="${esc(u.id)}" ${u.is_admin ? "disabled" : ""}>Edit</button>
                <button class="ghost" data-del="${esc(u.id)}" ${u.is_admin ? "disabled" : ""}>Remove</button>
              </td>
            </tr>`).join("") : `<tr><td colspan="6" class="muted">No users yet.</td></tr>`}
          </tbody>
        </table>
      </div>

      <div style="margin-top:1rem">${form()}</div>

      <div class="panel" style="margin-top:1rem">
        <div class="panel-head">
          <h3 style="margin:0">Libraries / sublibraries</h3>
          <p class="muted">Group your kiosks so users, dashboards and reports can be filtered library-wise.</p>
        </div>
        <table>
          <thead><tr><th>Library</th><th>Code</th><th>Kiosks</th><th></th></tr></thead>
          <tbody>${libs.length ? libs.map((l) => `
            <tr><td>${esc(l.name)}</td><td class="muted">${esc(l.code || "—")}</td>
              <td class="muted">${l.kiosks}</td>
              <td><button class="ghost" data-dellib="${esc(l.id)}">Remove</button></td></tr>`).join("")
            : `<tr><td colspan="4" class="muted">No libraries yet.</td></tr>`}
          </tbody>
        </table>
        <div class="row" style="margin-top:.6rem;gap:.5rem">
          <input id="lib_name" placeholder="Library name (e.g. Science Library)" style="flex:1" />
          <input id="lib_code" placeholder="Code" style="width:120px" />
          <button id="lib_add" class="primary">Add library</button>
        </div>
      </div>

      <div class="panel" style="margin-top:1rem">
        <div class="panel-head">
          <h3 style="margin:0">Kiosk → library mapping</h3>
          <p class="muted">Each terminal belongs to one library. Reports and the dashboard filter use this mapping.</p>
        </div>
        <table>
          <thead><tr><th>Kiosk</th><th>Terminal id</th><th>Location</th><th>Library</th></tr></thead>
          <tbody>${arr(meta.kiosks).map((k) => `
            <tr><td>${esc(k.name)}</td><td class="muted">${esc(k.device_id)}</td>
              <td class="muted">${esc(k.location || "—")}</td>
              <td><select data-kiosklib="${esc(k.id)}">
                <option value="">Unassigned</option>
                ${meta.sublibraries.map((s) => `<option value="${esc(s.id)}" ${s.id === k.sublibrary_id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}
              </select></td></tr>`).join("") || `<tr><td colspan="4" class="muted">No kiosks yet.</td></tr>`}
          </tbody>
        </table>
      </div>

      <div id="ms_kiosks" style="margin-top:1rem"></div>
      <div id="ms_hours" style="margin-top:1rem"></div>
      <div id="ms_sip2" style="margin-top:1rem"></div>
      <div id="ms_staff" style="margin-top:1rem"></div>
      <div id="ms_backup" style="margin-top:1rem"></div>`;

    bind();

    const ctx = { api, esc, toast };
    kiosksPanel(view.querySelector("#ms_kiosks"), ctx);
    hoursPanel(view.querySelector("#ms_hours"), ctx);
    sip2Panel(view.querySelector("#ms_sip2"), ctx);
    staffPanel(view.querySelector("#ms_staff"), ctx);
    backupPanel(view.querySelector("#ms_backup"), ctx);
  };


  const collect = () => ({
    full_name: view.querySelector("#f_name").value.trim(),
    email: view.querySelector("#f_email").value.trim(),
    password: view.querySelector("#f_password").value,
    role: view.querySelector("#f_role").value,
    status: view.querySelector("#f_status").value,
    modules: [...view.querySelectorAll(".f_module:checked")].map((c) => c.value),
    viewer_only: view.querySelector("#f_viewer").checked,
    allow_bulk_upload: view.querySelector("#f_bulk").checked,
    allow_export: view.querySelector("#f_export").checked,
    sublibraries: [...view.querySelectorAll(".f_lib:checked")].map((c) => c.value),
    locations: [...view.querySelectorAll(".f_loc:checked")].map((c) => c.value),
    kiosks: [...view.querySelectorAll(".f_kiosk:checked")].map((c) => c.value),
  });

  const refresh = async () => {
    await load();
    paint();
  };

  function bind() {
    // Picking a role pre-ticks its recommended modules and rights.
    view.querySelector("#f_role").onchange = (e) => {
      const preset = rolePreset(e.target.value);
      for (const c of view.querySelectorAll(".f_module")) c.checked = preset.modules.includes(c.value);
      view.querySelector("#f_viewer").checked = !!preset.viewer_only;
      view.querySelector("#f_bulk").checked = !!preset.allow_bulk_upload;
      view.querySelector("#f_export").checked = !!preset.allow_export;
    };

    view.querySelector("#f_save").onclick = async () => {
      const body = collect();
      try {
        if (editing) {
          const { password, email, ...rest } = body;
          await api(`/api/users/${editing}`, { method: "PATCH", body: rest });
          if (password) await api(`/api/users/${editing}/password`, { method: "POST", body: { password } });
          toast("User updated");
          editing = null;
        } else {
          await api("/api/users", { method: "POST", body });
          toast("User created");
        }
        await refresh();
      } catch (e) {
        toast(e.message, true);
      }
    };
    const cancel = view.querySelector("#f_cancel");
    if (cancel) cancel.onclick = () => { editing = null; paint(); };

    for (const b of view.querySelectorAll("[data-edit]")) {
      b.onclick = () => { editing = b.dataset.edit; paint(); window.scrollTo(0, 0); };
    }
    for (const b of view.querySelectorAll("[data-del]")) {
      b.onclick = async () => {
        if (!confirm("Remove this user's access to your university?")) return;
        try {
          await api(`/api/users/${b.dataset.del}`, { method: "DELETE" });
          toast("Access removed");
          await refresh();
        } catch (e) { toast(e.message, true); }
      };
    }

    view.querySelector("#lib_add").onclick = async () => {
      const name = view.querySelector("#lib_name").value.trim();
      const code = view.querySelector("#lib_code").value.trim();
      if (!name) return toast("Enter a library name", true);
      try {
        await api("/api/users/sublibraries", { method: "POST", body: { name, code } });
        toast("Library added");
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
    for (const b of view.querySelectorAll("[data-dellib]")) {
      b.onclick = async () => {
        if (!confirm("Remove this library? Kiosks stay, but lose their grouping.")) return;
        try {
          await api(`/api/users/sublibraries/${b.dataset.dellib}`, { method: "DELETE" });
          await refresh();
        } catch (e) { toast(e.message, true); }
      };
    }
    for (const sel of view.querySelectorAll("[data-kiosklib]")) {
      sel.onchange = async () => {
        try {
          await api(`/api/users/kiosks/${sel.dataset.kiosklib}/sublibrary`, {
            method: "PATCH",
            body: { sublibrary_id: sel.value || null },
          });
          toast("Kiosk mapped");
          await refresh();
        } catch (e) { toast(e.message, true); }
      };
    }
  }

  await load();
  paint();
}
