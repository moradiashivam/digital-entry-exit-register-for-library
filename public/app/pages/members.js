const FORM_FIELDS = [
  ["member_code", "Member code", "text"],
  ["full_name", "Full name", "text"],
  ["mobile", "Mobile (10 digits)", "text"],
  ["email", "Email", "email"],
  ["rfid_uid", "RFID card UID", "text"],
  ["photo_url", "Photo URL", "text"],
  ["valid_from", "Valid from", "date"],
  ["valid_to", "Valid to", "date"],
];

export async function renderMembers(view, { api, esc, toast, downloadCsv }) {
  const masters = (await api("/api/masters")) || {};
  let rows = [];

  const options = (list, selected) =>
    `<option value="">—</option>` +
    (Array.isArray(list) ? list : [])
      .map((i) => `<option value="${esc(i.id)}"${i.id === selected ? " selected" : ""}>${esc(i.name)}</option>`)
      .join("");

  view.innerHTML = `
    <div class="panel">
      <div class="row" style="justify-content:space-between">
        <div class="row">
          <div><label for="search">Search</label><input id="search" placeholder="Name, code or email" /></div>
          <div><label for="status">Status</label>
            <select id="status"><option value="">All</option>
              ${["Active", "Inactive", "Expired", "Blocked"].map((s) => `<option>${s}</option>`).join("")}
            </select></div>
        </div>
        <div class="row">
          <button class="ghost" id="export">Export CSV</button>
          <button id="add">Add member</button>
        </div>
      </div>
      <div style="margin-top:1rem;overflow:auto"><table>
        <thead><tr><th>Code</th><th>Name</th><th>Course / Dept</th><th>Contact</th><th>Validity</th><th>Palm</th><th>Status</th><th></th></tr></thead>
        <tbody id="tbody"><tr><td colspan="8" class="muted">Loading…</td></tr></tbody>
      </table></div>
    </div>

    <dialog id="dlg">
      <h3 id="dlgTitle">Add member</h3>
      <form id="memberForm" method="dialog">
        <div class="grid cols-2">
          ${FORM_FIELDS.map(([k, label, type]) =>
            `<div><label for="f_${k}">${label}</label><input id="f_${k}" type="${type}" style="width:100%" /></div>`).join("")}
          <div><label for="f_course_id">Course</label><select id="f_course_id" style="width:100%">${options(masters.courses)}</select></div>
          <div><label for="f_department_id">Department</label><select id="f_department_id" style="width:100%">${options(masters.departments)}</select></div>
          <div><label for="f_academic_year_id">Academic year</label><select id="f_academic_year_id" style="width:100%">${options(masters.years)}</select></div>
          <div><label for="f_gender">Gender</label><select id="f_gender" style="width:100%">
            ${["Male", "Female", "Other"].map((g) => `<option>${g}</option>`).join("")}</select></div>
          <div><label for="f_status">Status</label><select id="f_status" style="width:100%">
            ${["Active", "Inactive", "Expired", "Blocked"].map((s) => `<option>${s}</option>`).join("")}</select></div>
        </div>
        <p style="color:var(--danger)" id="formError"></p>
        <div class="row" style="justify-content:flex-end;margin-top:.8rem">
          <button class="ghost" type="button" id="cancel">Cancel</button>
          <button type="button" id="save">Save member</button>
        </div>
      </form>
    </dialog>`;

  const tbody = view.querySelector("#tbody");
  const dlg = view.querySelector("#dlg");
  let editing = null;

  const load = async () => {
    const params = new URLSearchParams({
      search: view.querySelector("#search").value,
      status: view.querySelector("#status").value,
    });
    rows = (await api(`/api/members?${params}`)) || [];
    tbody.innerHTML = rows.length
      ? rows.map((m) => `<tr>
          <td>${esc(m.member_code)}</td>
          <td>${esc(m.full_name)}${m.rfid_uid ? `<br><span class="muted">RFID ${esc(m.rfid_uid)}</span>` : ""}</td>
          <td>${esc(m.course || "—")}<br><span class="muted">${esc(m.department || "")}</span></td>
          <td>${esc(m.mobile)}<br><span class="muted">${esc(m.email)}</span></td>
          <td>${esc(m.valid_from)} → ${esc(m.valid_to)}</td>
          <td>${m.palm_count ? `<span class="badge ok">${m.palm_count}</span>` : `<span class="muted">none</span>`}</td>
          <td><span class="badge ${m.status === "Active" ? "ok" : "bad"}">${esc(m.status)}</span></td>
          <td class="row"><button class="ghost" data-edit="${esc(m.id)}">Edit</button>
              <button class="danger" data-del="${esc(m.id)}">Delete</button></td>
        </tr>`).join("")
      : `<tr><td colspan="8" class="muted">No members found.</td></tr>`;
  };

  const openDialog = (member) => {
    editing = member;
    view.querySelector("#dlgTitle").textContent = member ? "Edit member" : "Add member";
    view.querySelector("#formError").textContent = "";
    for (const [k] of FORM_FIELDS) view.querySelector(`#f_${k}`).value = member?.[k] ?? "";
    for (const k of ["course_id", "department_id", "academic_year_id", "gender", "status"]) {
      view.querySelector(`#f_${k}`).value = member?.[k] ?? (k === "gender" ? "Other" : k === "status" ? "Active" : "");
    }
    if (!member) {
      const today = new Date().toISOString().slice(0, 10);
      const next = new Date(); next.setFullYear(next.getFullYear() + 1);
      view.querySelector("#f_valid_from").value = today;
      view.querySelector("#f_valid_to").value = next.toISOString().slice(0, 10);
    }
    dlg.showModal();
  };

  view.querySelector("#add").onclick = () => openDialog(null);
  view.querySelector("#cancel").onclick = () => dlg.close();
  view.querySelector("#search").oninput = () => load();
  view.querySelector("#status").onchange = () => load();
  view.querySelector("#export").onclick = () =>
    downloadCsv("members.csv", rows.map((m) => ({
      code: m.member_code, name: m.full_name, course: m.course, department: m.department,
      mobile: m.mobile, email: m.email, rfid: m.rfid_uid, valid_from: m.valid_from,
      valid_to: m.valid_to, status: m.status,
    })));

  view.querySelector("#save").onclick = async () => {
    const body = {};
    for (const [k] of FORM_FIELDS) body[k] = view.querySelector(`#f_${k}`).value || null;
    for (const k of ["course_id", "department_id", "academic_year_id", "gender", "status"]) {
      body[k] = view.querySelector(`#f_${k}`).value || null;
    }
    try {
      if (editing) await api(`/api/members/${editing.id}`, { method: "PATCH", body });
      else await api("/api/members", { method: "POST", body });
      dlg.close();
      toast(editing ? "Member updated" : "Member added");
      await load();
    } catch (e) {
      view.querySelector("#formError").textContent = e.message;
    }
  };

  tbody.onclick = async (e) => {
    const edit = e.target.dataset.edit;
    const del = e.target.dataset.del;
    if (edit) return openDialog(rows.find((m) => m.id === edit));
    if (del && confirm("Delete this member and all their scan history?")) {
      await api(`/api/members/${del}`, { method: "DELETE" });
      toast("Member deleted");
      await load();
    }
  };

  await load();
}
