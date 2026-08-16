const money = (v) => `₹${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const arr = (v) => (Array.isArray(v) ? v : []);

export async function renderOwnerTenants(view, { api, esc, toast, fmtDate }) {
  const filters = { search: "", status: "", plan_id: "", expiry_to: "", created_from: "", page: 1, size: 20 };
  let plans = [];
  let total = 0;

  view.innerHTML = `
    <div class="panel">
      <div class="row">
        <div style="flex:2;min-width:220px"><label for="f_search">Search</label>
          <input id="f_search" style="width:100%" placeholder="Name, email, phone or code" /></div>
        <div><label for="f_status">Status</label><select id="f_status">
          <option value="">All</option><option>Active</option><option>Suspended</option>
          <option>Deactivated</option><option value="Expired">Expired</option></select></div>
        <div><label for="f_plan">Plan</label><select id="f_plan"><option value="">All plans</option></select></div>
        <div><label for="f_created">Registered from</label><input id="f_created" type="date" /></div>
        <div><label for="f_expiry">Expiring before</label><input id="f_expiry" type="date" /></div>
        <div><label>&nbsp;</label><button class="ghost" id="clear">Clear</button></div>
      </div>
    </div>

    <div class="panel" style="margin-top:1rem">
      <div class="row" style="justify-content:space-between">
        <h3 style="margin:0">Universities</h3><span class="muted" id="count"></span>
      </div>
      <div style="overflow:auto;margin-top:.6rem"><table>
        <thead><tr><th>University</th><th>Contact</th><th>Plan</th><th>Registered</th><th>Expiry</th>
          <th>Status</th><th>Last login</th><th>Billing</th><th></th></tr></thead>
        <tbody id="tbody"><tr><td colspan="9" class="muted">Loading…</td></tr></tbody>
      </table></div>
      <div class="row" style="margin-top:.7rem">
        <button class="ghost" id="prev">Previous</button>
        <button class="ghost" id="next">Next</button>
        <span class="muted" id="pageInfo"></span>
      </div>
      <p class="muted" style="margin-top:.6rem">Owner view is limited to subscription, billing and access status.
        A university's members, scans and reports are never visible or exportable from here.</p>
    </div>

    <dialog id="dlg" style="max-width:820px">
      <div id="dlgBody"></div>
      <div class="row" style="justify-content:flex-end;margin-top:1rem"><button class="ghost" id="closeDlg">Close</button></div>
    </dialog>`;

  const dlg = view.querySelector("#dlg");
  view.querySelector("#closeDlg").onclick = () => dlg.close();

  const statusBadge = (r) => {
    if (r.status !== "Active") return `<span class="badge bad">${esc(r.status)}</span>`;
    if (Number(r.days_left) < 0) return `<span class="badge bad">Expired</span>`;
    return `<span class="badge ok">Active</span>`;
  };

  const load = async () => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== "" && v !== null));
    const data = (await api(`/api/owner/tenants?${qs}`)) || {};
    const rows = arr(data.rows);
    total = Number(data.total || 0);
    view.querySelector("#count").textContent = `${total} registered`;
    view.querySelector("#pageInfo").textContent =
      `Page ${filters.page} of ${Math.max(1, Math.ceil(total / filters.size))}`;
    view.querySelector("#tbody").innerHTML = rows.length
      ? rows.map((r) => `<tr>
          <td><strong>${esc(r.name)}</strong><br><span class="muted">${esc(r.code || r.slug)}</span></td>
          <td>${esc(r.contact_email || "—")}<br><span class="muted">${esc(r.contact_phone || "")}</span></td>
          <td>${esc(r.plan || "No plan")}</td>
          <td>${esc(String(r.created_at).slice(0, 10))}</td>
          <td>${esc(String(r.subscription_end).slice(0, 10))}<br>
              <span class="muted">${Number(r.days_left) < 0 ? "expired" : `${r.days_left} days left`}</span></td>
          <td>${statusBadge(r)}</td>
          <td class="muted">${r.last_login ? esc(fmtDate(r.last_login)) : "never"}</td>
          <td>${money(r.paid_total)}${Number(r.dues_total) > 0
              ? `<br><span class="muted" style="color:var(--danger)">${money(r.dues_total)} due</span>` : ""}</td>
          <td class="row" style="gap:.3rem">
            <button class="ghost" data-view="${esc(r.id)}">Details</button>
            <select data-status="${esc(r.id)}">
              ${["Active", "Suspended", "Deactivated"].map((s) =>
                `<option ${s === r.status ? "selected" : ""}>${s}</option>`).join("")}
            </select>
          </td></tr>`).join("")
      : `<tr><td colspan="9" class="muted">No universities match these filters.</td></tr>`;
  };

  const openDetail = async (id) => {
    const d = (await api(`/api/owner/tenants/${id}`)) || {};
    const t = d.tenant || {};
    dlg.querySelector("#dlgBody").innerHTML = `
      <h3>${esc(t.name)}</h3>
      <p class="muted">Code ${esc(t.code || t.slug)} · registered ${esc(String(t.created_at).slice(0, 10))}
        · ${esc(t.contact_email || "no email")} ${esc(t.contact_phone || "")}</p>

      <div class="panel" style="margin-top:.8rem">
        <h4 style="margin-top:0">Subscription</h4>
        <div class="row">
          <div><label for="d_plan">Plan</label><select id="d_plan">
            <option value="">No plan</option>
            ${plans.map((p) => `<option value="${esc(p.id)}" ${p.id === t.plan_id ? "selected" : ""}>
              ${esc(p.name)} — ${money(p.price)}/${esc(p.billing_cycle)}</option>`).join("")}</select></div>
          <div><label for="d_start">Start</label><input id="d_start" type="date" value="${esc(String(t.subscription_start).slice(0, 10))}" /></div>
          <div><label for="d_end">End</label><input id="d_end" type="date" value="${esc(String(t.subscription_end).slice(0, 10))}" /></div>
          <div><label for="d_action">Action</label><select id="d_action">
            <option value="renew">Renew</option><option value="upgrade">Upgrade</option>
            <option value="downgrade">Downgrade</option></select></div>
          <div><label for="d_auto">Auto-renew</label><br>
            <input id="d_auto" type="checkbox" ${t.auto_renew ? "checked" : ""} /></div>
          <div><label>&nbsp;</label><button id="saveSub">Save subscription</button></div>
        </div>
        <p class="muted">Leave the end date untouched and press save to extend by one billing cycle.</p>
      </div>

      <div class="grid cols-2" style="margin-top:.8rem">
        <div class="panel"><h4 style="margin-top:0">Subscription history</h4>
          <table><thead><tr><th>When</th><th>Action</th><th>New end</th><th>By</th></tr></thead>
          <tbody>${arr(d.history).length ? arr(d.history).map((h) => `<tr>
            <td class="muted">${esc(fmtDate(h.created_at))}</td><td>${esc(h.action)}</td>
            <td>${esc(h.new_end_date ? String(h.new_end_date).slice(0, 10) : "—")}</td>
            <td class="muted">${esc(h.changed_by || "—")}</td></tr>`).join("")
            : `<tr><td colspan="4" class="muted">No changes recorded.</td></tr>`}</tbody></table></div>

        <div class="panel"><h4 style="margin-top:0">Payments</h4>
          <table><thead><tr><th>Invoice</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>${arr(d.payments).length ? arr(d.payments).map((p) => `<tr>
            <td>${esc(p.invoice_no)}</td><td>${money(p.total_amount)}</td>
            <td><span class="badge ${p.status === "Success" ? "ok" : "bad"}">${esc(p.status)}</span></td>
            <td class="muted">${esc(fmtDate(p.paid_at || p.created_at))}</td></tr>`).join("")
            : `<tr><td colspan="4" class="muted">No payments yet.</td></tr>`}</tbody></table></div>
      </div>

      <div class="panel" style="margin-top:.8rem"><h4 style="margin-top:0">Admin logins</h4>
        <table><thead><tr><th>Email</th><th>Role</th><th>Last login</th></tr></thead>
        <tbody>${arr(d.admins).map((a) => `<tr><td>${esc(a.email)}</td><td>${esc(a.role)}</td>
          <td class="muted">${a.last_login_at ? esc(fmtDate(a.last_login_at)) : "never"}</td></tr>`).join("")
          || `<tr><td colspan="3" class="muted">No logins issued.</td></tr>`}</tbody></table></div>`;

    dlg.querySelector("#saveSub").onclick = async () => {
      try {
        await api(`/api/owner/tenants/${id}/subscription`, {
          method: "POST",
          body: {
            plan_id: dlg.querySelector("#d_plan").value || null,
            subscription_start: dlg.querySelector("#d_start").value,
            subscription_end: dlg.querySelector("#d_end").value !== String(t.subscription_end).slice(0, 10)
              ? dlg.querySelector("#d_end").value : null,
            auto_renew: dlg.querySelector("#d_auto").checked,
            action: dlg.querySelector("#d_action").value,
          },
        });
        toast("Subscription updated");
        dlg.close();
        await load();
      } catch (e) {
        toast(e.message, true);
      }
    };
    dlg.showModal();
  };

  view.querySelector("#tbody").addEventListener("click", (e) => {
    const id = e.target.dataset.view;
    if (id) openDetail(id).catch((err) => toast(err.message, true));
  });

  view.querySelector("#tbody").addEventListener("change", async (e) => {
    const id = e.target.dataset.status;
    if (!id) return;
    try {
      await api(`/api/owner/tenants/${id}/status`, { method: "PATCH", body: { status: e.target.value } });
      toast(`Access set to ${e.target.value}`);
      await load();
    } catch (err) {
      toast(err.message, true);
      await load();
    }
  });

  const bind = (id, key, event = "change") =>
    view.querySelector(id).addEventListener(event, (e) => {
      filters[key] = e.target.value;
      filters.page = 1;
      load().catch((err) => toast(err.message, true));
    });

  let t;
  view.querySelector("#f_search").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      filters.search = e.target.value;
      filters.page = 1;
      load();
    }, 300);
  });
  bind("#f_status", "status");
  bind("#f_plan", "plan_id");
  bind("#f_created", "created_from");
  bind("#f_expiry", "expiry_to");
  view.querySelector("#clear").onclick = () => {
    Object.assign(filters, { search: "", status: "", plan_id: "", expiry_to: "", created_from: "", page: 1 });
    for (const id of ["#f_search", "#f_status", "#f_plan", "#f_created", "#f_expiry"]) view.querySelector(id).value = "";
    load();
  };
  view.querySelector("#prev").onclick = () => {
    if (filters.page > 1) { filters.page -= 1; load(); }
  };
  view.querySelector("#next").onclick = () => {
    if (filters.page * filters.size < total) { filters.page += 1; load(); }
  };

  plans = arr(await api("/api/owner/plans"));
  view.querySelector("#f_plan").innerHTML =
    `<option value="">All plans</option>${plans.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}`;
  await load();
}
