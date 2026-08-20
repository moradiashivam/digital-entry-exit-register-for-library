/** CSV columns — exactly the per-member fields stored in the `members` table. */
const CSV_COLUMNS = [
  ["member_code", "required", "Unique code / enrolment number"],
  ["full_name", "required", "Student or staff name"],
  ["gender", "optional", "Male | Female | Other"],
  ["mobile", "optional", "10 digits"],
  ["email", "optional", "name@example.com"],
  ["rfid_uid", "optional", "RFID card UID"],
  ["valid_from", "optional", "YYYY-MM-DD or DD-MM-YYYY (defaults to today)"],
  ["valid_to", "optional", "YYYY-MM-DD or DD-MM-YYYY (defaults to +1 year)"],
  ["status", "optional", "Active | Inactive | Expired | Blocked"],
];
const TEMPLATE = CSV_COLUMNS.map(([c]) => c).join(",");


/** Minimal CSV parser (handles quoted values). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

export async function renderImport(view, { api, esc, toast }) {
  const masters = (await api("/api/masters")) || {};
  const options = (list) =>
    `<option value="">—</option>` +
    (Array.isArray(list) ? list : []).map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join("");

  view.innerHTML = `
    <div class="panel">
      <h3>Upload a CSV file</h3>
      <p class="muted">The CSV mirrors the member table. Only <code>member_code</code> and <code>full_name</code>
        are required. Choose below what should happen when a member code already exists. Save Excel files as CSV first.</p>
      <div style="margin-top:.8rem;overflow:auto"><table>
        <thead><tr><th>Column</th><th>Required</th><th>Format</th></tr></thead>
        <tbody>${CSV_COLUMNS.map(([c, req, hint]) => `<tr><td><code>${esc(c)}</code></td>
          <td>${req === "required" ? `<span class="badge ok">required</span>` : `<span class="muted">optional</span>`}</td>
          <td class="muted">${esc(hint)}</td></tr>`).join("")}</tbody>
      </table></div>
      <div class="row" style="margin-top:.8rem;align-items:flex-end">
        <input type="file" id="file" accept=".csv,text/csv" />
        <div>
          <label for="dupMode">If a member code already exists</label>
          <select id="dupMode">
            <option value="skip">Skip duplicate — keep existing details</option>
            <option value="overwrite">Overwrite existing details from CSV</option>
          </select>
        </div>
        <button class="ghost" id="template">Download template</button>
        <button id="upload" disabled>Import rows</button>
      </div>
      <div id="preview" style="margin-top:1rem"></div>
    </div>

    <div class="panel" style="margin-top:1rem">
      <h3>Apply to every imported row</h3>
      <p class="muted">These fields are not part of the CSV — pick them once and they are saved on all imported members.</p>
      <div class="grid cols-2" style="margin-top:.6rem">
        <div><label for="d_course_id">Course</label><select id="d_course_id" style="width:100%">${options(masters.courses)}</select></div>
        <div><label for="d_department_id">Department</label><select id="d_department_id" style="width:100%">${options(masters.departments)}</select></div>
        <div><label for="d_academic_year_id">Academic year</label><select id="d_academic_year_id" style="width:100%">${options(masters.years)}</select></div>
        <div><label for="d_status">Status when the CSV leaves it blank</label><select id="d_status" style="width:100%">
          ${["Active", "Inactive", "Expired", "Blocked"].map((s) => `<option>${s}</option>`).join("")}</select></div>
        <div><label for="d_valid_from">Valid from (fallback)</label><input id="d_valid_from" type="date" style="width:100%" /></div>
        <div><label for="d_valid_to">Valid to (fallback)</label><input id="d_valid_to" type="date" style="width:100%" /></div>
        <div><label for="d_consent">Consent recorded</label><select id="d_consent" style="width:100%">
          <option value="">No</option><option value="1">Yes</option></select></div>
      </div>
    </div>

    <div class="panel" style="margin-top:1rem">
      <h3>Bulk photo upload</h3>
      <p class="muted">Select or drop many images at once. Each file must be named after the member code —
        for example <code>STU001.jpg</code>. Photos are stored in
        <code>public/photos/&lt;university&gt;/&lt;member code&gt;.jpg</code> and linked to that member.</p>
      <div class="row" style="margin-top:.6rem">
        <input type="file" id="photoFiles" accept="image/*" multiple />
        <button id="photoUpload" disabled>Upload photos</button>
      </div>
      <div id="photoResult" style="margin-top:.8rem"></div>
    </div>

    <div class="panel" style="margin-top:1rem">
      <h3>Recent imports</h3>
      <p class="muted">Uploaded the wrong file? “Delete upload” removes every member that batch created.
        Deleted data cannot be recovered unless you have a database backup.</p>
      <div style="overflow:auto"><table><thead><tr><th>File</th><th>Rows</th><th>New</th><th>Updated</th>
        <th>Skipped</th><th>Failed</th><th>Still in database</th><th>By</th><th>When</th><th></th></tr></thead>
      <tbody id="history"><tr><td colspan="10" class="muted">Loading…</td></tr></tbody></table></div>
    </div>`;

  let parsed = [];

  const loadHistory = async () => {
    const rows = (await api("/api/reports/imports")) || [];
    view.querySelector("#history").innerHTML = rows.length
      ? rows.map((r) => `<tr><td>${esc(r.file_name)}</td><td>${r.total_rows}</td>
          <td>${r.success_count}</td><td>${r.updated_count ?? 0}</td><td>${r.skipped_count ?? 0}</td>
          <td>${r.error_count}</td><td>${r.members_remaining ?? 0}</td>
          <td>${esc(r.admin_email || "—")}</td>
          <td>${esc(String(r.created_at).slice(0, 16))}</td>
          <td><button class="danger" data-del-batch="${esc(r.id)}" data-file="${esc(r.file_name)}"
            data-count="${r.members_remaining ?? 0}">Delete upload</button></td></tr>`).join("")
      : `<tr><td colspan="10" class="muted">No imports yet.</td></tr>`;
  };

  view.querySelector("#history").onclick = async (e) => {
    const btn = e.target.closest("[data-del-batch]");
    if (!btn) return;
    const { delBatch, file, count } = btn.dataset;
    const ok = confirm(
      `Delete the upload “${file}”?\n\n` +
      `${count} member(s) created by this import will be permanently removed, together with their ` +
      `photos, palm templates and entry/exit history.\n\n` +
      `Members that already existed before this import are not touched.\n` +
      `Deleted data CANNOT be recovered unless you have a database backup.`,
    );
    if (!ok) return;
    if (!confirm(`Last confirmation — delete ${count} member(s) from “${file}” now?`)) return;
    try {
      const out = await api(`/api/members/import/${delBatch}`, { method: "DELETE" });
      toast(`${out.deleted} member(s) removed from ${out.file_name}`);
      await loadHistory();
    } catch (err) {
      toast(err.message, true);
    }
  };

  const defaults = () => ({
    course_id: view.querySelector("#d_course_id").value || null,
    department_id: view.querySelector("#d_department_id").value || null,
    academic_year_id: view.querySelector("#d_academic_year_id").value || null,
    status: view.querySelector("#d_status").value || null,
    valid_from: view.querySelector("#d_valid_from").value || null,
    valid_to: view.querySelector("#d_valid_to").value || null,
    consent_given: view.querySelector("#d_consent").value === "1",
  });

  view.querySelector("#template").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`${TEMPLATE}\nSTU001,Asha Patel,Female,9876543210,asha@example.com,,2026-01-01,2026-12-31,Active\nSTU002,Ravi Shah,Male,,,04A1B2C3,,,\n`], { type: "text/csv" }));
    a.download = "members-template.csv";
    a.click();
  };

  view.querySelector("#file").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const [header, ...data] = parseCsv(await file.text());
    const cols = header.map((h) => h.trim().toLowerCase());
    const known = CSV_COLUMNS.map(([c]) => c);
    const unknown = cols.filter((c) => c && !known.includes(c));
    const missing = ["member_code", "full_name"].filter((c) => !cols.includes(c));
    parsed = data.map((r) => Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? "").trim()])));
    view.querySelector("#upload").disabled = !parsed.length || missing.length > 0;
    view.querySelector("#preview").innerHTML = `
      ${missing.length ? `<p style="color:var(--danger)">Missing required column(s): ${esc(missing.join(", "))}</p>` : ""}
      ${unknown.length ? `<p class="muted">Ignored column(s) not in the database: ${esc(unknown.join(", "))}</p>` : ""}
      <p class="muted">${parsed.length} rows ready — showing the first 5.</p>
      <table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${parsed.slice(0, 5).map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  };

  view.querySelector("#upload").onclick = async () => {
    const btn = view.querySelector("#upload");
    btn.disabled = true;
    try {
      const out = await api("/api/members/bulk", {
        method: "POST",
        body: {
          file_name: view.querySelector("#file").files[0]?.name || "import.csv",
          rows: parsed,
          duplicate_mode: view.querySelector("#dupMode").value,
          defaults: defaults(),
        },
      });

      toast(`${out.imported} new, ${out.updated} updated, ${out.failed} failed`, out.failed > 0);
      const stat = (label, value) =>
        `<div class="panel" style="padding:.6rem .8rem"><div class="muted">${label}</div>
         <div style="font-size:1.3rem;font-weight:700">${value}</div></div>`;
      view.querySelector("#preview").innerHTML = `
        <h4>Import summary</h4>
        <div class="grid cols-3" style="margin-top:.5rem">
          ${stat("Total records", out.total)}
          ${stat("Successfully imported", out.imported)}
          ${stat("Duplicates detected", out.duplicates)}
          ${stat("Skipped", out.skipped)}
          ${stat("Overwritten / updated", out.updated)}
          ${stat("Failed", out.failed)}
        </div>
        ${out.errors.length
          ? `<h4 style="margin-top:1rem">Rows that failed</h4>
             <table><thead><tr><th>Row</th><th>Member code</th><th>Reason</th></tr></thead><tbody>
             ${out.errors.map((e) => `<tr><td>${e.row}</td><td>${esc(e.member_code || "—")}</td>
               <td>${esc(e.error)}</td></tr>`).join("")}</tbody></table>`
          : `<p class="muted" style="margin-top:.6rem">No failed rows.</p>`}`;
      await loadHistory();
    } catch (e) {
      toast(e.message, true);
    } finally {
      btn.disabled = false;
    }
  };

  const readFile = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error(`Could not read ${file.name}`));
    r.readAsDataURL(file);
  });

  const photoInput = view.querySelector("#photoFiles");
  const photoBtn = view.querySelector("#photoUpload");
  const photoOut = view.querySelector("#photoResult");

  photoInput.onchange = () => {
    photoBtn.disabled = !photoInput.files.length;
    photoOut.innerHTML = photoInput.files.length
      ? `<p class="muted">${photoInput.files.length} image(s) selected.</p>` : "";
  };

  photoBtn.onclick = async () => {
    const files = [...photoInput.files];
    if (!files.length) return;
    photoBtn.disabled = true;
    const totals = { saved: 0, linked: 0, unmatched: [], errors: [] };
    try {
      for (let i = 0; i < files.length; i += 4) {
        const chunk = files.slice(i, i + 4);
        const payload = [];
        for (const f of chunk) {
          if (f.size > 5 * 1024 * 1024) { totals.errors.push({ member_code: f.name, error: "larger than 5 MB" }); continue; }
          payload.push({ member_code: f.name.replace(/\.[^.]+$/, ""), photo_data: await readFile(f) });
        }
        if (!payload.length) continue;
        const out = await api("/api/members/photos/bulk", { method: "POST", body: { files: payload } });
        totals.saved += out.saved; totals.linked += out.linked;
        totals.unmatched.push(...out.unmatched); totals.errors.push(...out.errors);
        photoOut.innerHTML = `<p class="muted">Uploading… ${Math.min(i + 4, files.length)} / ${files.length}</p>`;
      }
      toast(`${totals.linked} photo(s) linked to members`, totals.linked === 0);
      photoOut.innerHTML = `
        <p>${totals.saved} file(s) stored, <strong>${totals.linked}</strong> linked to a member.</p>
        ${totals.unmatched.length ? `<p class="muted">No member found for: ${esc(totals.unmatched.join(", "))}</p>` : ""}
        ${totals.errors.length ? `<p style="color:var(--danger)">${esc(totals.errors.map((e) => `${e.member_code}: ${e.error}`).join("; "))}</p>` : ""}`;
    } catch (e) {
      toast(e.message, true);
    } finally {
      photoBtn.disabled = false;
    }
  };

  await loadHistory();
}
