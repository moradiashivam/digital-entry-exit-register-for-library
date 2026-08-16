const money = (v) => `₹${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const arr = (v) => (Array.isArray(v) ? v : []);
const pct = (now, prev) => {
  const a = Number(now || 0);
  const b = Number(prev || 0);
  if (!b) return a ? "+100%" : "0%";
  const d = ((a - b) / b) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`;
};

function stat(label, value, sub = "") {
  return `<div class="panel stat"><p class="muted">${label}</p><div class="v">${value}</div>
    ${sub ? `<p class="muted">${sub}</p>` : ""}</div>`;
}

/** Donut chart drawn with inline SVG (no external chart library needed). */
function donut(rows, esc) {
  const data = arr(rows).filter((r) => Number(r.count) > 0);
  const total = data.reduce((s, r) => s + Number(r.count), 0);
  if (!total) return `<p class="muted">Nothing to chart yet.</p>`;
  const colors = ["#3b6ef0", "#2fbf8f", "#e0a33a", "#d9556f", "#8a6ef0", "#3aa8c1"];
  const r = 54;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const rings = data.map((row, i) => {
    const frac = Number(row.count) / total;
    const seg = `<circle class="donut-seg" r="${r}" cx="70" cy="70" fill="transparent"
      stroke="${colors[i % colors.length]}" stroke-width="20"
      stroke-dasharray="${(frac * c).toFixed(2)} ${c.toFixed(2)}"
      stroke-dashoffset="${(-offset * c).toFixed(2)}"></circle>`;
    offset += frac;
    return seg;
  }).join("");
  const legend = data.map((row, i) => `<div class="legend-row">
      <span class="legend-dot" style="background:${colors[i % colors.length]}"></span>
      <span>${esc(row.name)}</span>
      <strong>${row.count}</strong>
      <span class="muted">${Math.round((row.count / total) * 100)}%</span>
    </div>`).join("");
  return `<div class="donut-wrap">
    <svg viewBox="0 0 140 140" class="donut" role="img" aria-label="Plan distribution">
      <g transform="rotate(-90 70 70)">${rings}</g>
      <text x="70" y="66" text-anchor="middle" class="donut-total">${total}</text>
      <text x="70" y="84" text-anchor="middle" class="donut-cap">total</text>
    </svg>
    <div class="legend">${legend}</div></div>`;
}

/** Simple column chart for monthly trends. */
function columns(points, esc, fmt = (v) => v) {
  const rows = arr(points);
  if (!rows.length) return `<p class="muted">No data for this period yet.</p>`;
  const max = Math.max(1, ...rows.map((p) => Number(p.value) || 0));
  return `<div class="chart">
    <div class="chart-axis">${[max, max * 0.5, 0].map((t) => `<span>${fmt(Math.round(t))}</span>`).join("")}</div>
    <div class="chart-plot">
      <div class="chart-bars">${rows.map((p) => `<div class="chart-col" title="${esc(p.label)}: ${fmt(p.value)}">
        <div class="chart-bar" style="height:${Math.max(2, Math.round((p.value / max) * 100))}%"></div></div>`).join("")}</div>
      <div class="chart-labels">${rows.map((p, i) => `<span>${i % 2 === 0 ? esc(p.short) : ""}</span>`).join("")}</div>
    </div></div>`;
}

const monthShort = (m) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString([], { month: "short", year: "2-digit" });

export async function renderOwnerOverview(view, { api, esc }) {
  let days = Number(localStorage.getItem("owner_expiry_days") || 30);

  const paint = async () => {
    const d = (await api(`/api/owner/overview?expiry_days=${days}`)) || {};
    const c = d.counts || {};
    const rev = d.revenue || {};
    const leads = d.leads || {};
    const conv = Number(leads.total) ? Math.round((Number(leads.converted) / Number(leads.total)) * 100) : 0;

    const signups = arr(d.signupTrend).map((r) => ({ value: Number(r.count), label: r.month, short: monthShort(r.month) }));
    const revenues = arr(d.revenueTrend).map((r) => ({ value: Number(r.amount), label: r.month, short: monthShort(r.month) }));

    view.innerHTML = `
      <div class="row" style="justify-content:space-between;margin-bottom:1rem">
        <div class="row">
          <div><label for="expWin">Expiring within</label>
            <select id="expWin">${[7, 15, 30, 60, 90].map((n) =>
              `<option value="${n}" ${n === days ? "selected" : ""}>${n} days</option>`).join("")}</select></div>
        </div>
        <button class="ghost" id="runJob">Run expiry check now</button>
      </div>

      <div class="grid cols-4">
        ${stat("Total universities", c.total ?? 0, "all time")}
        ${stat("Active subscriptions", c.active ?? 0, `${c.suspended ?? 0} suspended · ${c.deactivated ?? 0} deactivated`)}
        ${stat("Expired / not renewed", c.expired ?? 0, "past their end date")}
        ${stat(`Expiring in ${days} days`, c.expiring ?? 0, "renewal follow-up needed")}
      </div>

      <div class="grid cols-4" style="margin-top:1rem">
        ${stat("New this week", c.new_week ?? 0, "registrations")}
        ${stat("New this month", c.new_month ?? 0, "registrations")}
        ${stat("Revenue this month", money(rev.this_month), `${pct(rev.this_month, rev.last_month)} vs last month`)}
        ${stat("Revenue this year", money(rev.this_year), `${pct(rev.this_year, rev.last_year)} vs last year`)}
      </div>

      <div class="grid cols-4" style="margin-top:1rem">
        ${stat("Total revenue collected", money(rev.all_time), `tax collected ${money(rev.tax_collected)}`)}
        ${stat("Pending dues", money(rev.pending_amount), `${rev.pending_count ?? 0} invoices · ${rev.overdue_count ?? 0} overdue`)}
        ${stat("Leads", `${leads.total ?? 0}`, `${leads.open_leads ?? 0} open · ${leads.due_followups ?? 0} follow-ups due`)}
        ${stat("Converted leads", `${leads.converted ?? 0}`, `conversion rate ${conv}%`)}
      </div>

      <div class="grid cols-2" style="margin-top:1rem">
        <div class="panel"><h3>New registrations — last 12 months</h3>${columns(signups, esc)}</div>
        <div class="panel"><h3>Revenue — last 12 months</h3>${columns(revenues, esc, (v) => money(v))}</div>
      </div>

      <div class="grid cols-2" style="margin-top:1rem">
        <div class="panel"><h3>Plan distribution</h3>${donut(d.planMix, esc)}</div>
        <div class="panel"><h3>Lead pipeline</h3>${donut(d.leadFunnel, esc)}</div>
      </div>

      <div class="grid cols-2" style="margin-top:1rem">
        <div class="panel"><h3>Expiring soon</h3>
          <div style="overflow:auto"><table>
            <thead><tr><th>University</th><th>Plan</th><th>Ends</th><th>Days left</th></tr></thead>
            <tbody>${arr(d.expiringList).length ? arr(d.expiringList).map((r) => `<tr>
              <td>${esc(r.name)}<br><span class="muted">${esc(r.contact_email || "")}</span></td>
              <td>${esc(r.plan || "—")}</td><td>${esc(String(r.subscription_end).slice(0, 10))}</td>
              <td><span class="badge ${Number(r.days_left) <= 7 ? "bad" : "ok"}">${r.days_left}</span></td>
            </tr>`).join("") : `<tr><td colspan="4" class="muted">Nothing expiring in this window.</td></tr>`}</tbody>
          </table></div>
        </div>
        <div class="panel"><h3>Pending payments</h3>
          <div style="overflow:auto"><table>
            <thead><tr><th>University</th><th>Invoice</th><th>Amount</th><th>Due</th></tr></thead>
            <tbody>${arr(d.dues).length ? arr(d.dues).map((r) => `<tr>
              <td>${esc(r.institute)}</td><td>${esc(r.invoice_no)}</td>
              <td>${money(r.total_amount)}</td><td>${esc(r.due_date ? String(r.due_date).slice(0, 10) : "—")}</td>
            </tr>`).join("") : `<tr><td colspan="4" class="muted">No dues outstanding.</td></tr>`}</tbody>
          </table></div>
        </div>
      </div>

      <p class="muted" style="margin-top:1rem">Platform metrics only — no university's member or attendance data is shown here.</p>`;

    view.querySelector("#expWin").onchange = (e) => {
      days = Number(e.target.value);
      localStorage.setItem("owner_expiry_days", days);
      paint();
    };
    view.querySelector("#runJob").onclick = async (e) => {
      e.target.disabled = true;
      try {
        const r = await api("/api/owner/jobs/expiry", { method: "POST" });
        alert(`Expiry check done — ${r.suspended} suspended, ${r.reactivated} re-activated, ${r.reminders} reminder emails sent.`);
        await paint();
      } finally {
        e.target.disabled = false;
      }
    };
  };

  await paint();
}
