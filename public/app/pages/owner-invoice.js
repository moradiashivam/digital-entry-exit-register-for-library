/**
 * Invoice generator (Owner → Payments & accounting).
 * Builds a print-ready A4 invoice for one recorded payment. The owner chooses
 * whether the saved header, footer, bank box and terms page are included.
 * Terms & conditions always print on the reverse side (page 2).
 */

const money = (v, cur) =>
  `${cur} ${Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const day = (v) => {
  if (!v) return "—";
  const d = new Date(String(v).replace(" ", "T"));
  return isNaN(d) ? String(v).slice(0, 10) : d.toLocaleDateString("en-GB");
};

const lines = (t) =>
  String(t || "")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => `<div>${l}</div>`)
    .join("");

/** Terms are numbered when the owner typed plain lines. */
const termsHtml = (t) => {
  const list = String(t || "").split(/\r?\n/).filter((l) => l.trim());
  if (!list.length) return "<p>No terms and conditions have been set.</p>";
  return `<ol>${list.map((l) => `<li>${l}</li>`).join("")}</ol>`;
};

export function invoiceHtml({ payment: p, settings: s, upi }, opts) {
  const cur = s.currency || "INR";
  const header = opts.header && (s.invoice_header_html || s.company_name)
    ? `<header class="inv-head">
         <div class="co">
           <h1>${s.company_name || "Invoice"}</h1>
           ${lines(s.company_address)}
           ${s.gst_number ? `<div>GST / Tax no: ${s.gst_number}</div>` : ""}
         </div>
         <div class="co-extra">${s.invoice_header_html || ""}</div>
       </header>`
    : "";

  const footer = opts.footer && (s.invoice_footer_html || s.invoice_footer)
    ? `<footer class="inv-foot">${s.invoice_footer_html || ""}${
        s.invoice_footer ? `<div>${s.invoice_footer}</div>` : ""}</footer>`
    : "";

  const bank = opts.bank && s.invoice_bank_details
    ? `<div class="box bank"><h3>Bank details</h3>${lines(s.invoice_bank_details)}</div>`
    : "";

  const upiBox = opts.upi && upi && upi.image
    ? `<div class="box upi">
         <h3>Pay by UPI</h3>
         <img src="${upi.image}" alt="UPI QR code for ${p.invoice_no}" />
         <div class="upi-id">${upi.upi_id}</div>
         <div class="muted-note">Scan with any UPI app — reference ${p.invoice_no}</div>
       </div>`
    : "";

  const back = opts.terms
    ? `<section class="page back"><h2>Terms &amp; conditions</h2>${termsHtml(s.invoice_terms)}</section>`
    : "";

  return `<!doctype html><html><head><meta charset="utf-8" />
  <title>${p.invoice_no}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", Arial, sans-serif; color: #111; font-size: 12px; margin: 0; }
    .page { width: 182mm; min-height: 250mm; margin: 0 auto; padding: 0; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    .inv-head { display: flex; justify-content: space-between; gap: 12mm; border-bottom: 2px solid #111; padding-bottom: 6mm; }
    .inv-head h1 { margin: 0 0 2mm; font-size: 20px; }
    .title { text-align: center; letter-spacing: .18em; font-size: 16px; font-weight: 700; margin: 7mm 0 5mm; }
    .meta { display: flex; justify-content: space-between; gap: 10mm; }
    .box { border: 1px solid #999; padding: 4mm; border-radius: 2mm; }
    .box h3 { margin: 0 0 2mm; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
    .meta .box { flex: 1; }
    table { width: 100%; border-collapse: collapse; margin-top: 6mm; }
    th, td { border: 1px solid #999; padding: 2.5mm 3mm; text-align: left; }
    th { background: #f1f1f1; }
    td.num, th.num { text-align: right; }
    .totals { margin-top: 5mm; display: flex; justify-content: space-between; gap: 8mm; align-items: flex-start; }
    .bank { flex: 1; }
    .upi { width: 46mm; text-align: center; }
    .upi img { width: 36mm; height: 36mm; }
    .upi-id { font-weight: 700; margin-top: 1.5mm; word-break: break-all; }
    .muted-note { color: #555; font-size: 10px; margin-top: 1mm; }
    .sum { width: 70mm; }
    .sum div { display: flex; justify-content: space-between; padding: 1.5mm 0; }
    .sum .grand { border-top: 1px solid #111; font-weight: 700; font-size: 14px; }
    .sign { margin-top: 18mm; text-align: right; }
    .inv-foot { margin-top: 10mm; border-top: 1px solid #999; padding-top: 3mm; color: #555; font-size: 11px; }
    .back h2 { border-bottom: 2px solid #111; padding-bottom: 3mm; }
    .back ol { padding-left: 6mm; line-height: 1.6; }
    @media screen { body { background: #eee; padding: 8mm; } .page { background: #fff; padding: 12mm; box-shadow: 0 2px 12px rgba(0,0,0,.2); margin-bottom: 8mm; } }
  </style></head><body>
  <section class="page">
    ${header}
    <div class="title">${opts.title || "TAX INVOICE"}</div>
    <div class="meta">
      <div class="box">
        <h3>Billed to</h3>
        <strong>${p.institute}</strong>
        ${lines(p.institute_address)}
        ${p.contact_email ? `<div>${p.contact_email}</div>` : ""}
        ${p.contact_phone ? `<div>${p.contact_phone}</div>` : ""}
      </div>
      <div class="box">
        <h3>Invoice</h3>
        <div><strong>No:</strong> ${p.invoice_no}</div>
        <div><strong>Date:</strong> ${day(p.paid_at || p.created_at)}</div>
        ${p.due_date ? `<div><strong>${opts.dueLabel || "Due"}:</strong> ${day(p.due_date)}</div>` : ""}
        <div><strong>Status:</strong> ${p.status}</div>
        ${p.payment_mode ? `<div><strong>Mode:</strong> ${p.payment_mode}</div>` : ""}
        ${p.gateway_txn_id ? `<div><strong>Reference:</strong> ${p.gateway_txn_id}</div>` : ""}
      </div>
    </div>
    <table>
      <thead><tr><th style="width:12mm">#</th><th>Description</th><th class="num" style="width:35mm">Amount</th></tr></thead>
      <tbody><tr><td>1</td><td>${p.description || "Subscription charges"}</td>
        <td class="num">${money(p.amount, cur)}</td></tr></tbody>
    </table>
    <div class="totals">
      ${bank}
      ${upiBox}
      <div class="sum">
        <div><span>Net amount</span><span>${money(p.amount, cur)}</span></div>
        ${Array.isArray(p.tax_breakup) && p.tax_breakup.length
          ? p.tax_breakup.map((t) =>
              `<div><span>${t.name} @ ${t.percent}%</span><span>${money(t.amount, cur)}</span></div>`).join("")
          : `<div><span>Tax / GST</span><span>${money(p.tax_amount, cur)}</span></div>`}
        <div class="grand"><span>Total</span><span>${money(p.total_amount, cur)}</span></div>
      </div>
    </div>
    <div class="sign">For <strong>${s.company_name || "us"}</strong><br /><br /><br />Authorised signatory</div>
    ${footer}
  </section>
  ${back}
  <script>window.onload = () => setTimeout(() => window.print(), 350);<\/script>
  </body></html>`;
}

/** Small dialog letting the owner pick what goes on the printed invoice. */
export function openInvoiceDialog(paymentId, { api, toast }) {
  const wrap = document.createElement("div");
  wrap.className = "modal-back";
  wrap.innerHTML = `
    <div class="panel modal-card">
      <h3 style="margin-top:0">Generate invoice</h3>
      <p class="muted">A4 page. Terms &amp; conditions always print on the reverse side.</p>
      <label class="chk"><input type="checkbox" id="i_head" checked /> Include header</label>
      <label class="chk"><input type="checkbox" id="i_foot" checked /> Include footer</label>
      <label class="chk"><input type="checkbox" id="i_bank" checked /> Include bank details</label>
      <label class="chk"><input type="checkbox" id="i_terms" checked /> Print terms &amp; conditions on the back</label>
      <label class="chk"><input type="checkbox" id="i_upi" checked /> Include UPI payment QR code</label>
      <div class="row" style="margin-top:.9rem">
        <button id="i_go">Generate &amp; print</button>
        <button class="ghost" id="i_cancel">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const close = () => wrap.remove();
  wrap.querySelector("#i_cancel").onclick = close;
  wrap.addEventListener("click", (e) => e.target === wrap && close());

  wrap.querySelector("#i_go").onclick = async () => {
    const opts = {
      header: wrap.querySelector("#i_head").checked,
      footer: wrap.querySelector("#i_foot").checked,
      bank: wrap.querySelector("#i_bank").checked,
      terms: wrap.querySelector("#i_terms").checked,
      upi: wrap.querySelector("#i_upi").checked,
    };
    try {
      const data = await api(`/api/owner/payments/${paymentId}/invoice`);
      const win = window.open("", "_blank");
      if (!win) return toast("Allow pop-ups to open the invoice", true);
      win.document.write(invoiceHtml(data, opts));
      win.document.close();
      close();
    } catch (e) {
      toast(e.message, true);
    }
  };
}
