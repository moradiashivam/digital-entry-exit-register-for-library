const FORM_FIELDS = [
  ["member_code", "Member code *", "text"],
  ["full_name", "Full name *", "text"],
  ["mobile", "Mobile (optional, 10 digits)", "text"],
  ["email", "Email (optional)", "email"],
  ["rfid_uid", "RFID card UID (optional)", "text"],
  ["valid_from", "Valid from *", "date"],
  ["valid_to", "Valid to *", "date"],
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
          <button class="danger" id="bulkDelete" disabled>Bulk delete (0)</button>
          <button id="add">Add member</button>
        </div>
      </div>
      <div style="margin-top:1rem;overflow:auto"><table>
        <thead><tr><th style="width:32px"><input type="checkbox" id="selectAll" aria-label="Select all members" /></th><th>Code</th><th>Name</th><th>Course / Dept</th><th>Contact</th><th>Validity</th><th>Palm</th><th>Status</th><th></th></tr></thead>
        <tbody id="tbody"><tr><td colspan="9" class="muted">Loading…</td></tr></tbody>
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
          <div><label for="f_designation">Designation</label><select id="f_designation" style="width:100%">
            ${["Student", "Research Scholar", "Faculty", "Staff", "Guest"].map((g) => `<option>${g}</option>`).join("")}</select></div>
          <div><label for="f_status">Status</label><select id="f_status" style="width:100%">
            ${["Active", "Inactive", "Expired", "Blocked"].map((s) => `<option>${s}</option>`).join("")}</select></div>
          <div>
            <label for="f_photo">Photo (optional)</label>
            <input id="f_photo" type="file" accept="image/*" style="width:100%" />
            <p class="muted" style="margin:.3rem 0 0">Saved as <code>photos/&lt;university&gt;/&lt;member code&gt;.jpg</code>.</p>
          </div>
          <div><label>Preview</label><div id="photoPreview" class="muted">No photo</div></div>
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
          <td><input type="checkbox" class="rowSel" data-sel="${esc(m.id)}" aria-label="Select ${esc(m.full_name)}" /></td>
          <td>${esc(m.member_code)}</td>
          <td>${m.photo_url ? `<img src="${esc(m.photo_url)}" alt="" style="height:28px;width:28px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:.4rem" />` : ""}${esc(m.full_name)}${m.rfid_uid ? `<br><span class="muted">RFID ${esc(m.rfid_uid)}</span>` : ""}</td>
          <td>${esc(m.course || "—")}<br><span class="muted">${esc(m.department || "")}</span></td>
          <td>${esc(m.mobile)}<br><span class="muted">${esc(m.email)}</span></td>
          <td>${esc(m.valid_from)} → ${esc(m.valid_to)}</td>
          <td>${m.palm_count ? `<span class="badge ok">${m.palm_count}</span>` : `<span class="muted">none</span>`}</td>
          <td><span class="badge ${m.status === "Active" ? "ok" : "bad"}">${esc(m.status)}</span></td>
          <td class="row"><button class="ghost" data-edit="${esc(m.id)}">Edit</button>
              <button class="danger" data-del="${esc(m.id)}">Delete</button></td>
        </tr>`).join("")
      : `<tr><td colspan="9" class="muted">No members found.</td></tr>`;
    view.querySelector("#selectAll").checked = false;
    refreshSelection();
  };

  const selectedIds = () => [...view.querySelectorAll(".rowSel:checked")].map((c) => c.dataset.sel);

  function refreshSelection() {
    const n = selectedIds().length;
    const btn = view.querySelector("#bulkDelete");
    btn.textContent = `Bulk delete (${n})`;
    btn.disabled = n === 0;
  }

  const openDialog = (member) => {
    editing = member;
    view.querySelector("#dlgTitle").textContent = member ? "Edit member" : "Add member";
    view.querySelector("#formError").textContent = "";
    for (const [k] of FORM_FIELDS) view.querySelector(`#f_${k}`).value = member?.[k] ?? "";
    for (const k of ["course_id", "department_id", "academic_year_id", "gender", "designation", "status"]) {
      view.querySelector(`#f_${k}`).value =
        member?.[k] ?? (k === "gender" ? "Other" : k === "designation" ? "Student" : k === "status" ? "Active" : "");
    }
    view.querySelector("#f_photo").value = "";
    const prev = view.querySelector("#photoPreview");
    prev.innerHTML = member?.photo_url
      ? `<img src="${esc(member?.photo_url || "")}" alt="" style="max-height:90px;border-radius:8px" />`
      : `<span class="muted">No photo</span>`;
    if (!member) {
      const today = new Date().toISOString().slice(0, 10);
      const next = new Date(); next.setFullYear(next.getFullYear() + 1);
      view.querySelector("#f_valid_from").value = today;
      view.querySelector("#f_valid_to").value = next.toISOString().slice(0, 10);
    }
    dlg.showModal();
  };

  view.querySelector("#f_photo").onchange = (e) => {
    const f = e.target.files[0];
    const prev = view.querySelector("#photoPreview");
    if (!f) return;
    prev.innerHTML = `<img src="${URL.createObjectURL(f)}" alt="" style="max-height:90px;border-radius:8px" />`;
  };

  view.querySelector("#add").onclick = () => openDialog(null);
  view.querySelector("#cancel").onclick = () => dlg.close();
  view.querySelector("#search").oninput = () => load();
  view.querySelector("#status").onchange = () => load();
  view.querySelector("#export").onclick = () =>
    downloadCsv("members.csv", rows.map((m) => ({
      code: m.member_code, name: m.full_name, course: m.course, department: m.department, designation: m.designation,
      mobile: m.mobile, email: m.email, rfid: m.rfid_uid, valid_from: m.valid_from,
      valid_to: m.valid_to, status: m.status,
    })));

  view.querySelector("#save").onclick = async () => {
    const body = {};
    for (const [k] of FORM_FIELDS) body[k] = view.querySelector(`#f_${k}`).value || null;
    for (const k of ["course_id", "department_id", "academic_year_id", "gender", "designation", "status"]) {
      body[k] = view.querySelector(`#f_${k}`).value || null;
    }
    const file = view.querySelector("#f_photo").files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        view.querySelector("#formError").textContent = "Photo must be smaller than 5 MB";
        return;
      }
      body.photo_data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error("Could not read the photo"));
        r.readAsDataURL(file);
      });
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

  view.querySelector("#selectAll").onchange = (e) => {
    for (const c of view.querySelectorAll(".rowSel")) c.checked = e.target.checked;
    refreshSelection();
  };

  view.querySelector("#bulkDelete").onclick = async () => {
    const ids = selectedIds();
    if (!ids.length) return;
    const names = rows.filter((m) => ids.includes(m.id)).map((m) => `${m.member_code} — ${m.full_name}`);
    const preview = names.slice(0, 10).join("\n") + (names.length > 10 ? `\n…and ${names.length - 10} more` : "");
    const ok = confirm(
      `Permanently delete ${ids.length} member(s)?\n\n${preview}\n\n` +
      `This also removes their palm templates, photos and entry/exit history.\n` +
      `Deleted data CANNOT be recovered unless you have a database backup.`,
    );
    if (!ok) return;
    if (!confirm(`Last confirmation — delete ${ids.length} member(s) now?`)) return;
    try {
      const out = await api("/api/members/bulk-delete", { method: "POST", body: { ids } });
      toast(`${out.deleted} member(s) deleted`);
      await load();
    } catch (e) {
      toast(e.message, true);
    }
  };

  tbody.onchange = (e) => { if (e.target.classList.contains("rowSel")) refreshSelection(); };

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
