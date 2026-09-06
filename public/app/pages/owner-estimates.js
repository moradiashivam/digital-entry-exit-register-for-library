/**
 * Estimates (quotations) for the Owner → Payments & accounting page.
 * An estimate stays editable until it is converted into an invoice.
 * Each estimate can be exported as a print-ready A4 PDF (terms optional).
 */
import { invoiceHtml } from "./owner-invoice.js";

const money = (v) => `₹${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const arr = (v) => (Array.isArray(v) ? v : []);

export function mountEstimates(box, { api, esc, toast, fmtDate }, { institutes, taxRates, onConverted }) {
  let rows = [];
  let editing = null;

  const opts = institutes.map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join("");

  box.innerHTML = `
    <h3 style="margin-top:0">Estimates</h3>
    <form id="estForm" class="row">
      <div style="min-width:200px"><label for="e_inst">University</label>
        <select id="e_inst" required><option value="">Choose…</option>${opts}</select></div>
      <div><label for="e_amount">Amount (₹)</label><input id="e_amount" type="number" min="0" step="0.01" required /></div>
      <div><label for="e_tax">Manual tax (₹)</label><input id="e_tax" type="number" min="0" step="0.01" value="0" /></div>
      <div><label for="e_valid">Valid until</label><input id="e_valid" type="date" /></div>
      <div><label for="e_status">Status</label><select id="e_status">
        <option>Draft</option><option>Sent</option><option>Cancelled</option></select></div>
      <div style="flex:1;min-width:200px"><label for="e_desc">Description</label>
        <input id="e_desc" style="width:100%" placeholder="Yearly subscription 2026-27" /></div>
      <div style="flex:1;min-width:200px"><label for="e_notes">Notes</label>
        <input id="e_notes" style="width:100%" placeholder="optional" /></div>
      <div><label>&nbsp;</label><button type="submit" id="e_save">Save estimate</button></div>
      <div><label>&nbsp;</label><button type="button" class="ghost" id="e_reset">Clear</button></div>
    </form>
    <div class="row" id="estTaxes" style="align-items:center;margin-top:.5rem">
      ${taxRates.map((t) => `<label class="chk"><input type="checkbox" data-etax="${esc(t.code)}" />
        ${esc(t.name)} (${t.percent}%)</label>`).join("")}
      <span class="muted" id="estSum"></span>
    </div>
    <div style="overflow:auto;margin-top:.8rem"><table>
      <thead><tr><th>Estimate</th><th>University</th><th>Description</th><th>Total</th>
        <th>Valid until</th><th>Status</th><th></th></tr></thead>
      <tbody id="estRows"><tr><td colspan="7" class="muted">Loading…</td></tr></tbody>
    </table></div>
    <p class="muted">Estimates can be edited any time. Converting one creates a real invoice under Payments.</p>`;

  const el = (id) => box.querySelector(id);
  const chosen = () => [...box.querySelectorAll("input[data-etax]:checked")].map((c) => c.dataset.etax);

  const drawSum = () => {
    const net = Number(el("#e_amount").value || 0);
    const picked = taxRates.filter((t) => chosen().includes(t.code));
    const tax = picked.length
      ? picked.reduce((s, t) => s + (net * t.percent) / 100, 0)
      : Number(el("#e_tax").value || 0);
    el("#estSum").innerHTML = `Tax ${money(tax)} · <strong>Total ${money(net + tax)}</strong>`;
  };

  const draw = () => {
    el("#estRows").innerHTML = rows.length
      ? rows.map((e) => `<tr>
          <td>${esc(e.estimate_no)}</td><td>${esc(e.institute)}</td>
          <td class="muted">${esc(e.description || "—")}</td>
          <td><strong>${money(e.total_amount)}</strong></td>
          <td class="muted">${e.valid_until ? esc(fmtDate(e.valid_until)) : "—"}</td>
          <td><span class="badge ${e.status === "Converted" ? "ok" : ""}">${esc(e.status)}</span></td>
          <td class="row" style="gap:.3rem">
            <button class="ghost" data-pdf="${esc(e.id)}">PDF</button>
            ${e.status === "Converted" ? "" : `
              <button class="ghost" data-edit="${esc(e.id)}">Edit</button>
              <button class="ghost" data-convert="${esc(e.id)}">Convert to invoice</button>
              <button class="ghost" data-del="${esc(e.id)}">Delete</button>`}
          </td></tr>`).join("")
      : `<tr><td colspan="7" class="muted">No estimates yet.</td></tr>`;
  };

  const load = async () => {
    rows = arr(((await api("/api/owner/estimates")) || {}).rows);
    draw();
  };

  const reset = () => {
    editing = null;
    el("#estForm").reset();
    box.querySelectorAll("input[data-etax]").forEach((c) => { c.checked = false; });
    el("#e_save").textContent = "Save estimate";
    drawSum();
  };

  el("#e_reset").onclick = reset;
  box.querySelector("#estTaxes").addEventListener("change", drawSum);
  el("#e_amount").addEventListener("input", drawSum);
  el("#e_tax").addEventListener("input", drawSum);

  el("#estForm").onsubmit = async (ev) => {
    ev.preventDefault();
    const body = {
      institute_id: el("#e_inst").value,
      amount: Number(el("#e_amount").value),
      tax_amount: Number(el("#e_tax").value || 0),
      taxes: chosen(),
      valid_until: el("#e_valid").value || null,
      status: el("#e_status").value,
      description: el("#e_desc").value || null,
      notes: el("#e_notes").value || null,
    };
    try {
      if (editing) await api(`/api/owner/estimates/${editing}`, { method: "PUT", body });
      else await api("/api/owner/estimates", { method: "POST", body });
      toast(editing ? "Estimate updated" : "Estimate saved");
      reset();
      await load();
    } catch (e) {
      toast(e.message, true);
    }
  };

  el("#estRows").addEventListener("click", async (ev) => {
    const t = ev.target;
    const id = t.dataset.edit || t.dataset.convert || t.dataset.del || t.dataset.pdf;
    if (!id) return;
    const est = rows.find((r) => r.id === id);

    if (t.dataset.pdf) return openEstimatePdf(id, { api, toast });



    if (t.dataset.edit) {
      editing = id;
      el("#e_inst").value = est.institute_id;
      el("#e_amount").value = est.amount;
      el("#e_tax").value = est.tax_amount;
      el("#e_valid").value = (est.valid_until || "").slice(0, 10);
      el("#e_status").value = est.status;
      el("#e_desc").value = est.description || "";
      el("#e_notes").value = est.notes || "";
      const codes = arr(est.tax_breakup).map((x) => x.code);
      box.querySelectorAll("input[data-etax]").forEach((c) => { c.checked = codes.includes(c.dataset.etax); });
      el("#e_save").textContent = "Update estimate";
      drawSum();
      box.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (t.dataset.convert) {
      if (!confirm(`Create an invoice from ${est.estimate_no} for ${money(est.total_amount)}?`)) return;
      try {
        const out = await api(`/api/owner/estimates/${id}/convert`, { method: "POST", body: { status: "Pending" } });
        toast(`Invoice ${out.invoice_no} created`);
        await load();
        await onConverted?.();
      } catch (e) { toast(e.message, true); }
      return;
    }

    if (!confirm(`Delete estimate ${est.estimate_no}?`)) return;
    try {
      await api(`/api/owner/estimates/${id}`, { method: "DELETE" });
      toast("Estimate deleted");
      await load();
    } catch (e) { toast(e.message, true); }
  });

  drawSum();
  return load();
}

/**
 * Print / PDF export for one estimate. Reuses the invoice A4 layout; the
 * Terms & conditions page is optional so the owner can share it separately.
 */
function openEstimatePdf(estimateId, { api, toast }) {
  const wrap = document.createElement("div");
  wrap.className = "modal-back";
  wrap.innerHTML = `
    <div class="panel modal-card">
      <h3 style="margin-top:0">Export estimate</h3>
      <p class="muted">A4 page — use your browser's Print → Save as PDF to share.</p>
      <label class="chk"><input type="checkbox" id="ep_head" checked /> Include header</label>
      <label class="chk"><input type="checkbox" id="ep_foot" checked /> Include footer</label>
      <label class="chk"><input type="checkbox" id="ep_bank" /> Include bank details</label>
      <label class="chk"><input type="checkbox" id="ep_terms" /> Add terms &amp; conditions on a separate page</label>
      <div class="row" style="margin-top:.9rem">
        <button id="ep_go">Generate &amp; print</button>
        <button class="ghost" id="ep_cancel">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const close = () => wrap.remove();
  wrap.querySelector("#ep_cancel").onclick = close;
  wrap.addEventListener("click", (e) => e.target === wrap && close());

  wrap.querySelector("#ep_go").onclick = async () => {
    const opts = {
      header: wrap.querySelector("#ep_head").checked,
      footer: wrap.querySelector("#ep_foot").checked,
      bank: wrap.querySelector("#ep_bank").checked,
      terms: wrap.querySelector("#ep_terms").checked,
      upi: false,
      title: "ESTIMATE",
      dueLabel: "Valid until",
    };
    try {
      const { estimate: e, settings } = await api(`/api/owner/estimates/${estimateId}/document`);
      const payment = {
        invoice_no: e.estimate_no,
        institute: e.institute,
        contact_email: e.contact_email,
        contact_phone: e.contact_phone,
        institute_address: e.institute_address,
        description: e.description || "Subscription estimate",
        amount: e.amount,
        tax_amount: e.tax_amount,
        tax_breakup: e.tax_breakup,
        total_amount: e.total_amount,
        created_at: e.created_at,
        due_date: e.valid_until,
        status: e.status,
        payment_mode: null,
        gateway_txn_id: null,
      };
      const win = window.open("", "_blank");
      if (!win) return toast("Allow pop-ups to open the estimate", true);
      win.document.write(invoiceHtml({ payment, settings, upi: null }, opts));
      win.document.close();
      close();
    } catch (err) {
      toast(err.message, true);
    }
  };
}
