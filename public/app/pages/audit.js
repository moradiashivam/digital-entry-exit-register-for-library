export async function renderAudit(view, { api, esc, fmtDate, downloadCsv }) {
  const rows = (await api("/api/reports/audit")) || [];
  view.innerHTML = `
    <div class="panel">
      <div class="row" style="justify-content:space-between">
        <p class="muted">${rows.length} recorded actions. This log cannot be edited or deleted from the app.</p>
        <button class="ghost" id="export">Export CSV</button>
      </div>
      <div style="overflow:auto;margin-top:.6rem"><table>
        <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
        <tbody>${
          rows.length
            ? rows.map((r) => `<tr>
                <td>${fmtDate(r.created_at)}</td>
                <td>${esc(r.admin_email || "system")}</td>
                <td>${esc(r.action)}</td>
                <td>${esc(r.target_table || "—")}</td>
                <td class="muted">${esc(r.details ? JSON.stringify(r.details) : "")}</td></tr>`).join("")
            : `<tr><td colspan="5" class="muted">No admin activity recorded yet.</td></tr>`
        }</tbody>
      </table></div>
    </div>`;
  view.querySelector("#export").onclick = () =>
    downloadCsv("audit-log.csv", rows.map((r) => ({
      when: r.created_at, admin: r.admin_email, action: r.action,
      target: r.target_table, target_id: r.target_id,
      details: r.details ? JSON.stringify(r.details) : "",
    })));
}
