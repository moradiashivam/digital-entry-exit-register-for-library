const money = (v) => `₹${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const arr = (v) => (Array.isArray(v) ? v : []);

export async function renderOwnerBilling(view, { api, esc, toast, fmtDate, downloadCsv }) {
  const filters = { institute_id: "", status: "", mode: "", from: "", to: "" };
  let institutes = [];
  let rows = [];

  view.innerHTML = `
    <div class="panel">
      <h3 style="margin-top:0">Record a payment / invoice</h3>
      <form id="newPay" class="row">
        <div style="min-width:200px"><label for="n_inst">University</label><select id="n_inst" required></select></div>
        <div><label for="n_amount">Amount (₹)</label><input id="n_amount" type="number" min="0" step="0.01" required /></div>
        <div><label for="n_tax">Tax / GST (₹)</label><input id="n_tax" type="number" min="0" step="0.01" value="0" /></div>
        <div><label for="n_mode">Mode</label><select id="n_mode">
          <option>Online</option><option>Bank Transfer</option><option>Cheque</option><option>Cash</option><option>UPI</option>
        </select></div>
        <div><label for="n_status">Status</label><select id="n_status">
          <option>Success</option><option>Pending</option><option>Failed</option></select></div>
        <div><label for="n_due">Due date</label><input id="n_due" type="date" /></div>
        <div><label for="n_txn">Txn / reference</label><input id="n_txn" placeholder="optional" /></div>
        <div style="flex:1;min-width:180px"><label for="n_desc">Description</label>
          <input id="n_desc" style="width:100%" placeholder="Yearly subscription 2026-27" /></div>
        <div><label>&nbsp;</label><button type="submit">Save payment</button></div>
      </form>
      <p class="muted">Invoice numbers are generated automatically. Payments are never deleted — void them instead.</p>
    </div>

    <div class="panel" style="margin-top:1rem">
      <div class="row">
        <div style="min-width:190px"><label for="f_inst">University</label><select id="f_inst"><option value="">All</option></select></div>
        <div><label for="f_status">Status</label><select id="f_status"><option value="">All</option>
          <option>Success</option><option>Pending</option><option>Failed</option><option>Refunded</option><option>Void</option></select></div>
        <div><label for="f_mode">Mode</label><select id="f_mode"><option value="">All</option>
          <option>Online</option><option>Bank Transfer</option><option>Cheque</option><option>Cash</option><option>UPI</option></select></div>
        <div><label for="f_from">From</label><input id="f_from" type="date" /></div>
        <div><label for="f_to">To</label><input id="f_to" type="date" /></div>
        <div><label>&nbsp;</label><button class="ghost" id="csv">Export CSV</button></div>
      </div>
      <div class="grid cols-4" id="totals" style="margin-top:.8rem"></div>
      <div style="overflow:auto;margin-top:.8rem"><table>
        <thead><tr><th>Invoice</th><th>University</th><th>Description</th><th>Net</th><th>Tax</th>
          <th>Total</th><th>Mode</th><th>Status</th><th>Date</th><th></th></tr></thead>
        <tbody id="payRows"><tr><td colspan="10" class="muted">Loading…</td></tr></tbody>
      </table></div>
    </div>

    <div class="grid cols-2" style="margin-top:1rem">
      <div class="panel"><h3 style="margin-top:0">Monthly accounting</h3><div id="periods"></div></div>
      <div class="panel"><h3 style="margin-top:0">Outstanding &amp; refunds</h3><div id="outstanding"></div></div>
    </div>`;

  const badge = (s) => `<span class="badge ${s === "Success" ? "ok" : s === "Pending" ? "" : "bad"}">${esc(s)}</span>`;

  const loadPayments = async () => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    const data = (await api(`/api/owner/payments?${qs}`)) || {};
    rows = arr(data.rows);
    const t = data.totals || {};
    view.querySelector("#totals").innerHTML = [
      ["Collected", money(t.collected)], ["Tax collected", money(t.tax)],
      ["Pending", money(t.pending)], ["Refunded", money(t.refunded)],
    ].map(([l, v]) => `<div class="panel stat"><p class="muted">${l}</p><div class="v">${v}</div></div>`).join("");

    view.querySelector("#payRows").innerHTML = rows.length
      ? rows.map((p) => `<tr>
          <td>${esc(p.invoice_no)}</td><td>${esc(p.institute)}</td>
          <td class="muted">${esc(p.description || "—")}</td>
          <td>${money(p.amount)}</td><td>${money(p.tax_amount)}</td><td><strong>${money(p.total_amount)}</strong></td>
          <td>${esc(p.payment_mode)}</td><td>${badge(p.status)}</td>
          <td class="muted">${esc(fmtDate(p.paid_at || p.created_at))}</td>
          <td class="row" style="gap:.3rem">
            ${p.status === "Void" ? "" : `<select data-status="${esc(p.id)}">
              ${["Pending", "Success", "Failed", "Refunded"].map((s) =>
                `<option ${s === p.status ? "selected" : ""}>${s}</option>`).join("")}</select>
              <button class="ghost" data-void="${esc(p.id)}">Void</button>`}
          </td></tr>`).join("")
      : `<tr><td colspan="10" class="muted">No payments match these filters.</td></tr>`;
  };

  const loadAccounting = async () => {
    const d = (await api("/api/owner/accounting/summary?group=month")) || {};
    view.querySelector("#periods").innerHTML = arr(d.periods).length
      ? `<table><thead><tr><th>Month</th><th>Payments</th><th>Net</th><th>Tax</th><th>Gross</th></tr></thead>
         <tbody>${arr(d.periods).map((r) => `<tr><td>${esc(r.period)}</td><td>${r.payments}</td>
           <td>${money(r.net)}</td><td>${money(r.tax)}</td><td><strong>${money(r.gross)}</strong></td></tr>`).join("")}
         </tbody></table>`
      : `<p class="muted">No successful payments recorded yet.</p>`;

    const out = arr(d.outstanding);
    const ref = arr(d.refunds);
    view.querySelector("#outstanding").innerHTML = `
      <h4>Outstanding invoices</h4>
      ${out.length ? `<table><thead><tr><th>University</th><th>Invoice</th><th>Amount</th><th>Overdue</th></tr></thead>
        <tbody>${out.map((r) => `<tr><td>${esc(r.institute)}</td><td>${esc(r.invoice_no)}</td>
          <td>${money(r.total_amount)}</td>
          <td>${Number(r.days_overdue) > 0 ? `<span class="badge bad">${r.days_overdue} days</span>` : "—"}</td>
        </tr>`).join("")}</tbody></table>` : `<p class="muted">Nothing outstanding.</p>`}
      <h4 style="margin-top:1rem">Refunded / voided</h4>
      ${ref.length ? `<table><thead><tr><th>University</th><th>Invoice</th><th>Amount</th><th>Status</th><th>Reason</th></tr></thead>
        <tbody>${ref.map((r) => `<tr><td>${esc(r.institute)}</td><td>${esc(r.invoice_no)}</td>
          <td>${money(r.total_amount)}</td><td>${esc(r.status)}</td>
          <td class="muted">${esc(r.void_reason || "—")}</td></tr>`).join("")}</tbody></table>`
        : `<p class="muted">No refunds or voided invoices.</p>`}`;
  };

  view.querySelector("#payRows").addEventListener("change", async (e) => {
    const id = e.target.dataset.status;
    if (!id) return;
    try {
      await api(`/api/owner/payments/${id}`, { method: "PATCH", body: { status: e.target.value } });
      toast("Payment updated");
      await Promise.all([loadPayments(), loadAccounting()]);
    } catch (err) {
      toast(err.message, true);
    }
  });

  view.querySelector("#payRows").addEventListener("click", async (e) => {
    const id = e.target.dataset.void;
    if (!id) return;
    const reason = prompt("Why is this invoice being voided?");
    if (!reason) return;
    try {
      await api(`/api/owner/payments/${id}/void`, { method: "POST", body: { reason } });
      toast("Payment voided");
      await Promise.all([loadPayments(), loadAccounting()]);
    } catch (err) {
      toast(err.message, true);
    }
  });

  for (const [sel, key] of [["#f_inst", "institute_id"], ["#f_status", "status"], ["#f_mode", "mode"],
    ["#f_from", "from"], ["#f_to", "to"]]) {
    view.querySelector(sel).addEventListener("change", (e) => {
      filters[key] = e.target.value;
      loadPayments().catch((err) => toast(err.message, true));
    });
  }

  view.querySelector("#csv").onclick = () => {
    downloadCsv("payments.csv", [
      ["Invoice", "University", "Description", "Net", "Tax", "Total", "Mode", "Status", "Date"],
      ...rows.map((p) => [p.invoice_no, p.institute, p.description || "", p.amount, p.tax_amount,
        p.total_amount, p.payment_mode, p.status, p.paid_at || p.created_at]),
    ]);
  };

  view.querySelector("#newPay").onsubmit = async (e) => {
    e.preventDefault();
    const val = (id) => view.querySelector(id).value;
    try {
      await api("/api/owner/payments", {
        method: "POST",
        body: {
          institute_id: val("#n_inst"), amount: Number(val("#n_amount")), tax_amount: Number(val("#n_tax")),
          payment_mode: val("#n_mode"), status: val("#n_status"), due_date: val("#n_due") || null,
          gateway_txn_id: val("#n_txn") || null, description: val("#n_desc") || null,
        },
      });
      toast("Payment recorded");
      e.target.reset();
      await Promise.all([loadPayments(), loadAccounting()]);
    } catch (err) {
      toast(err.message, true);
    }
  };

  const list = (await api("/api/owner/tenants?size=500")) || {};
  institutes = arr(list.rows);
  const opts = institutes.map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join("");
  view.querySelector("#n_inst").innerHTML = `<option value="">Choose…</option>${opts}`;
  view.querySelector("#f_inst").innerHTML = `<option value="">All universities</option>${opts}`;

  await Promise.all([loadPayments(), loadAccounting()]);
}
