const arr = (v) => (Array.isArray(v) ? v : []);
const STAGES = ["New", "Contacted", "Demo", "Negotiation", "Converted", "Lost"];
const SOURCES = ["Website", "Referral", "Cold Call", "Exhibition", "Email", "Other"];

export async function renderOwnerLeads(view, { api, esc, toast, fmtDate, downloadCsv }) {
  const filters = { stage: "", source: "", search: "" };
  let rows = [];
  let institutes = [];

  view.innerHTML = `
    <div class="panel">
      <h3 style="margin-top:0">Add a lead</h3>
      <form id="newLead" class="row">
        <div style="min-width:180px"><label for="l_name">University / prospect</label><input id="l_name" required /></div>
        <div><label for="l_person">Contact person</label><input id="l_person" /></div>
        <div><label for="l_phone">Phone</label><input id="l_phone" /></div>
        <div><label for="l_email">Email</label><input id="l_email" type="email" /></div>
        <div><label for="l_city">City</label><input id="l_city" /></div>
        <div><label for="l_source">Source</label><select id="l_source">${SOURCES.map((s) => `<option>${s}</option>`).join("")}</select></div>
        <div><label for="l_owner">Assigned to</label><input id="l_owner" placeholder="sales@…" /></div>
        <div><label for="l_follow">Follow-up on</label><input id="l_follow" type="date" /></div>
        <div><label>&nbsp;</label><button type="submit">Add lead</button></div>
      </form>
    </div>

    <div class="grid cols-3" id="pipeline" style="margin-top:1rem"></div>

    <div class="panel" style="margin-top:1rem">
      <div class="row">
        <div style="flex:1;min-width:200px"><label for="q">Search</label>
          <input id="q" style="width:100%" placeholder="Name, contact, phone or email" /></div>
        <div><label for="f_stage">Stage</label><select id="f_stage"><option value="">All</option>
          ${STAGES.map((s) => `<option>${s}</option>`).join("")}</select></div>
        <div><label for="f_source">Source</label><select id="f_source"><option value="">All</option>
          ${SOURCES.map((s) => `<option>${s}</option>`).join("")}</select></div>
        <div><label>&nbsp;</label><button class="ghost" id="csv">Export CSV</button></div>
      </div>
      <div style="overflow:auto;margin-top:.8rem"><table>
        <thead><tr><th>Prospect</th><th>Contact</th><th>City</th><th>Source</th><th>Stage</th>
          <th>Assigned</th><th>Follow-up</th><th>Converted to</th><th></th></tr></thead>
        <tbody id="leadRows"><tr><td colspan="9" class="muted">Loading…</td></tr></tbody>
      </table></div>
    </div>

    <dialog id="leadDlg" style="max-width:620px"><div id="leadBody"></div>
      <div class="row" style="justify-content:flex-end;margin-top:1rem">
        <button class="ghost" id="closeLead">Close</button></div></dialog>`;

  const dlg = view.querySelector("#leadDlg");
  view.querySelector("#closeLead").onclick = () => dlg.close();

  const load = async () => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    const data = (await api(`/api/owner/leads?${qs}`)) || {};
    rows = arr(data.rows);

    const byStage = Object.fromEntries(arr(data.byStage).map((r) => [r.name, Number(r.count)]));
    const total = Object.values(byStage).reduce((a, b) => a + b, 0);
    view.querySelector("#pipeline").innerHTML = STAGES.map((s) => `<div class="panel stat">
      <p class="muted">${s}</p><div class="v">${byStage[s] || 0}</div>
      <p class="muted">${total ? Math.round(((byStage[s] || 0) / total) * 100) : 0}% of pipeline</p></div>`).join("")
      + `<div class="panel stat"><p class="muted">By source</p>
         <div class="v">${arr(data.bySource).length}</div>
         <p class="muted">${arr(data.bySource).map((s) => `${esc(s.name)} ${s.count}`).join(" · ") || "no leads yet"}</p></div>`;

    const overdue = (d) => d && String(d).slice(0, 10) <= new Date().toISOString().slice(0, 10);
    view.querySelector("#leadRows").innerHTML = rows.length
      ? rows.map((l) => `<tr>
          <td><strong>${esc(l.name)}</strong></td>
          <td>${esc(l.contact_person || "—")}<br><span class="muted">${esc(l.phone || "")} ${esc(l.email || "")}</span></td>
          <td>${esc(l.city || "—")}</td><td>${esc(l.source)}</td>
          <td><select data-stage="${esc(l.id)}">${STAGES.map((s) =>
            `<option ${s === l.stage ? "selected" : ""}>${s}</option>`).join("")}</select></td>
          <td class="muted">${esc(l.assigned_to || "Unassigned")}</td>
          <td>${l.follow_up_on
            ? `<span class="badge ${overdue(l.follow_up_on) && l.stage !== "Converted" ? "bad" : "ok"}">${esc(String(l.follow_up_on).slice(0, 10))}</span>`
            : "—"}</td>
          <td>${esc(l.converted_institute || "—")}</td>
          <td class="row" style="gap:.3rem">
            <button class="ghost" data-open="${esc(l.id)}">Activity</button>
            ${l.stage === "Converted" ? "" : `<button class="ghost" data-convert="${esc(l.id)}">Convert</button>`}
          </td></tr>`).join("")
      : `<tr><td colspan="9" class="muted">No leads yet.</td></tr>`;
  };

  const openLead = async (id) => {
    const lead = rows.find((r) => r.id === id) || {};
    const acts = arr(await api(`/api/owner/leads/${id}/activities`));
    dlg.querySelector("#leadBody").innerHTML = `
      <h3>${esc(lead.name || "Lead")}</h3>
      <p class="muted">${esc(lead.contact_person || "")} ${esc(lead.phone || "")} ${esc(lead.email || "")}</p>
      <div class="row">
        <div><label for="a_type">Type</label><select id="a_type">
          <option value="note">Note</option><option value="call">Call</option>
          <option value="email">Email</option><option value="meeting">Meeting</option></select></div>
        <div style="flex:1;min-width:200px"><label for="a_note">Note</label><input id="a_note" style="width:100%" /></div>
        <div><label for="a_follow">Next follow-up</label><input id="a_follow" type="date"
          value="${esc(lead.follow_up_on ? String(lead.follow_up_on).slice(0, 10) : "")}" /></div>
        <div><label>&nbsp;</label><button id="addAct">Log</button></div>
      </div>
      <div class="panel" style="margin-top:.8rem"><h4 style="margin-top:0">History</h4>
        ${acts.length ? acts.map((a) => `<p style="margin:.35rem 0">
          <strong>${esc(a.activity_type)}</strong> — ${esc(a.note)}<br>
          <span class="muted">${esc(fmtDate(a.created_at))} · ${esc(a.created_by || "")}</span></p>`).join("")
          : `<p class="muted">No activity logged yet.</p>`}</div>`;
    dlg.querySelector("#addAct").onclick = async () => {
      try {
        await api(`/api/owner/leads/${id}/activities`, {
          method: "POST",
          body: {
            activity_type: dlg.querySelector("#a_type").value,
            note: dlg.querySelector("#a_note").value,
            follow_up_on: dlg.querySelector("#a_follow").value || null,
          },
        });
        toast("Activity logged");
        await load();
        await openLead(id);
      } catch (err) {
        toast(err.message, true);
      }
    };
    dlg.showModal();
  };

  view.querySelector("#leadRows").addEventListener("change", async (e) => {
    const id = e.target.dataset.stage;
    if (!id) return;
    try {
      await api(`/api/owner/leads/${id}`, { method: "PATCH", body: { stage: e.target.value } });
      toast("Stage updated");
      await load();
    } catch (err) {
      toast(err.message, true);
    }
  });

  view.querySelector("#leadRows").addEventListener("click", async (e) => {
    const open = e.target.dataset.open;
    const convert = e.target.dataset.convert;
    try {
      if (open) return await openLead(open);
      if (!convert) return;
      const name = prompt(`Which university did this lead become?\n\n${institutes.map((i, n) => `${n + 1}. ${i.name}`).join("\n")}\n\nType the number:`);
      const pick = institutes[Number(name) - 1];
      if (!pick) return;
      await api(`/api/owner/leads/${convert}/convert`, { method: "POST", body: { institute_id: pick.id } });
      toast(`Linked to ${pick.name}`);
      await load();
    } catch (err) {
      toast(err.message, true);
    }
  });

  let t;
  view.querySelector("#q").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => { filters.search = e.target.value; load(); }, 300);
  });
  view.querySelector("#f_stage").onchange = (e) => { filters.stage = e.target.value; load(); };
  view.querySelector("#f_source").onchange = (e) => { filters.source = e.target.value; load(); };
  view.querySelector("#csv").onclick = () => {
    downloadCsv("leads.csv", [
      ["Prospect", "Contact", "Phone", "Email", "City", "Source", "Stage", "Assigned", "Follow-up", "Converted to"],
      ...rows.map((l) => [l.name, l.contact_person || "", l.phone || "", l.email || "", l.city || "",
        l.source, l.stage, l.assigned_to || "", l.follow_up_on || "", l.converted_institute || ""]),
    ]);
  };

  view.querySelector("#newLead").onsubmit = async (e) => {
    e.preventDefault();
    const val = (id) => view.querySelector(id).value;
    try {
      await api("/api/owner/leads", {
        method: "POST",
        body: {
          name: val("#l_name"), contact_person: val("#l_person"), phone: val("#l_phone"),
          email: val("#l_email"), city: val("#l_city"), source: val("#l_source"),
          assigned_to: val("#l_owner"), follow_up_on: val("#l_follow") || null,
        },
      });
      toast("Lead added");
      e.target.reset();
      await load();
    } catch (err) {
      toast(err.message, true);
    }
  };

  institutes = arr(((await api("/api/owner/tenants?size=500")) || {}).rows);
  await load();
}
