const TEMPLATE = "member_code,full_name,gender,mobile,email,rfid_uid,valid_from,valid_to,status";

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
  view.innerHTML = `
    <div class="panel">
      <h3>Upload a CSV file</h3>
      <p class="muted">Required columns: <code>${TEMPLATE}</code>. Save Excel files as CSV first.
        Existing member codes are updated instead of duplicated.</p>
      <div class="row" style="margin-top:.8rem">
        <input type="file" id="file" accept=".csv,text/csv" />
        <button class="ghost" id="template">Download template</button>
        <button id="upload" disabled>Import rows</button>
      </div>
      <div id="preview" style="margin-top:1rem"></div>
    </div>
    <div class="panel" style="margin-top:1rem">
      <h3>Recent imports</h3>
      <table><thead><tr><th>File</th><th>Rows</th><th>Imported</th><th>Failed</th><th>By</th><th>When</th></tr></thead>
      <tbody id="history"><tr><td colspan="6" class="muted">Loading…</td></tr></tbody></table>
    </div>`;

  let parsed = [];

  const loadHistory = async () => {
    const rows = (await api("/api/reports/imports")) || [];
    view.querySelector("#history").innerHTML = rows.length
      ? rows.map((r) => `<tr><td>${esc(r.file_name)}</td><td>${r.total_rows}</td>
          <td>${r.success_count}</td><td>${r.error_count}</td><td>${esc(r.admin_email || "—")}</td>
          <td>${esc(String(r.created_at).slice(0, 16))}</td></tr>`).join("")
      : `<tr><td colspan="6" class="muted">No imports yet.</td></tr>`;
  };

  view.querySelector("#template").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`${TEMPLATE}\nSTU001,Asha Patel,Female,9876543210,asha@example.com,,2026-01-01,2026-12-31,Active\n`], { type: "text/csv" }));
    a.download = "members-template.csv";
    a.click();
  };

  view.querySelector("#file").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const [header, ...data] = parseCsv(await file.text());
    const cols = header.map((h) => h.trim().toLowerCase());
    parsed = data.map((r) => Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? "").trim()])));
    view.querySelector("#upload").disabled = !parsed.length;
    view.querySelector("#preview").innerHTML = `
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
        body: { file_name: view.querySelector("#file").files[0]?.name || "import.csv", rows: parsed },
      });
      toast(`${out.success} of ${out.total} rows imported`, out.errors.length > 0);
      view.querySelector("#preview").innerHTML = out.errors.length
        ? `<h4>Rows that failed</h4><table><thead><tr><th>Row</th><th>Reason</th></tr></thead><tbody>
            ${out.errors.map((e) => `<tr><td>${e.row}</td><td>${esc(e.error)}</td></tr>`).join("")}</tbody></table>`
        : `<p class="muted">All rows imported successfully.</p>`;
      await loadHistory();
    } catch (e) {
      toast(e.message, true);
    } finally {
      btn.disabled = false;
    }
  };

  await loadHistory();
}
