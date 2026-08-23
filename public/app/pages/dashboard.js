import { state } from "/app/admin.js";
import { fmtTime } from "/app/api.js";

const HOUR_LABELS = [0, 4, 8, 12, 16, 20];

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shortDay = (key) =>
  new Date(`${key}T00:00:00`).toLocaleDateString([], { month: "short", day: "2-digit" });
const mins = (v) => {
  const m = Math.max(0, Math.round(Number(v) || 0));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};
const hourLabel = (h) => (h === null || h === undefined ? "—" : `${String(h).padStart(2, "0")}:00`);

/** Always hand the renderers an array, whatever the API returned. */
const arr = (v) => (Array.isArray(v) ? v : []);

/** Donut / pie chart drawn with inline SVG. */
function pie(rows, esc) {
  const data = arr(rows).filter((r) => Number(r.count) > 0);
  const total = data.reduce((sum, r) => sum + Number(r.count), 0);
  if (!total) return `<p class="muted">No members added yet.</p>`;
  const colors = ["#3b6ef0", "#2fbf8f", "#e0a33a", "#d9556f", "#8a6ef0", "#3aa8c1"];
  const r = 54;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const rings = data.map((row, i) => {
    const frac = Number(row.count) / total;
    const seg = `<circle r="${r}" cx="70" cy="70" fill="transparent"
      stroke="${colors[i % colors.length]}" stroke-width="20"
      stroke-dasharray="${(frac * c).toFixed(2)} ${c.toFixed(2)}"
      stroke-dashoffset="${(-offset * c).toFixed(2)}"></circle>`;
    offset += frac;
    return seg;
  }).join("");
  const legend = data.map((row, i) => `<div class="legend-row">
      <span class="legend-dot" style="background:${colors[i % colors.length]}"></span>
      <span>${esc(row.name)}</span><strong>${row.count}</strong>
      <span class="muted">${Math.round((row.count / total) * 100)}%</span>
    </div>`).join("");
  return `<div class="donut-wrap">
    <svg viewBox="0 0 140 140" class="donut" role="img" aria-label="Member types">
      <g transform="rotate(-90 70 70)">${rings}</g>
      <text x="70" y="66" text-anchor="middle" class="donut-total">${total}</text>
      <text x="70" y="84" text-anchor="middle" class="donut-cap">members</text>
    </svg>
    <div class="legend">${legend}</div></div>`;
}

/** Horizontal bar list used for gender / department / course breakdowns. */
function barList(input, esc, emptyText) {
  const rows = arr(input);
  if (!rows.length) return `<p class="muted">${esc(emptyText)}</p>`;
  const max = Math.max(1, ...rows.map((r) => Number(r.count) || 0));

  return `<div class="hbars">${rows
    .slice(0, 8)
    .map(
      (r) => `<div class="hbar">
        <span class="hbar-label" title="${esc(r.name)}">${esc(r.name)}</span>
        <span class="hbar-track"><span class="hbar-fill" style="width:${Math.round((r.count / max) * 100)}%"></span></span>
        <span class="hbar-value">${r.count}</span>
      </div>`,
    )
    .join("")}</div>`;
}

/** Column chart with a y-axis and x labels. */
function columnChart(input, { xLabel, axisEvery = 1 }) {
  const points = arr(input);
  const max = Math.max(1, ...points.map((p) => Number(p.value) || 0));
  const ticks = [max, Math.round(max * 0.75), Math.round(max * 0.5), Math.round(max * 0.25), 0];
  return `<div class="chart">
    <div class="chart-axis">${ticks.map((t) => `<span>${t}</span>`).join("")}</div>
    <div class="chart-plot">
      <div class="chart-bars">
        ${points
          .map(
            (p) => `<div class="chart-col" title="${p.title}">
              <div class="chart-bar" style="height:${Math.round((p.value / max) * 100)}%"></div>
            </div>`,
          )
          .join("")}
      </div>
      <div class="chart-labels">
        ${points.map((p, i) => `<span>${i % axisEvery === 0 ? xLabel(p, i) : ""}</span>`).join("")}
      </div>
    </div>
  </div>`;
}

export async function renderDashboard(view, { api, esc, fmtDate }) {
  // Library / kiosk filter — a sublibrary user only ever sees their own terminals.
  const filters = { sublibrary_id: "", location: "", device_id: "" };
  let choices = { kiosks: [], sublibraries: [], locations: [] };
  try {
    choices = (await api("/api/reports/filters")) || choices;
  } catch {
    /* filters stay empty if the endpoint is unavailable */
  }

  const query = () => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  const filterBar = () => `
    <div class="panel row" style="gap:.6rem;align-items:flex-end;flex-wrap:wrap;margin-bottom:.8rem">
      <label style="min-width:190px">Library
        <select id="fltLib">
          <option value="">All libraries</option>
          ${arr(choices.sublibraries).map((s) => `<option value="${esc(s.id)}" ${filters.sublibrary_id === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}
        </select></label>
      <label style="min-width:190px">Location
        <select id="fltLoc">
          <option value="">All locations</option>
          ${arr(choices.locations).map((l) => `<option value="${esc(l)}" ${filters.location === l ? "selected" : ""}>${esc(l)}</option>`).join("")}
        </select></label>
      <label style="min-width:190px">Kiosk
        <select id="fltKiosk">
          <option value="">All kiosks</option>
          ${arr(choices.kiosks).map((k) => `<option value="${esc(k.device_id)}" ${filters.device_id === k.device_id ? "selected" : ""}>${esc(k.name)}</option>`).join("")}
        </select></label>
      <button id="fltClear" class="ghost">Clear filters</button>
    </div>`;

  const bindFilters = () => {
    const wire = (id, key) => {
      const el = view.querySelector(id);
      if (el) el.onchange = () => { filters[key] = el.value; paint().catch(() => {}); };
    };
    wire("#fltLib", "sublibrary_id");
    wire("#fltLoc", "location");
    wire("#fltKiosk", "device_id");
    const clear = view.querySelector("#fltClear");
    if (clear) clear.onclick = () => {
      filters.sublibrary_id = filters.location = filters.device_id = "";
      paint().catch(() => {});
    };
  };

  const paint = async () => {
    const raw = (await api(`/api/reports/dashboard${query()}`)) || {};
    const d = {
      institute: raw.institute || null,
      members: { total: 0, active: 0, expired: 0, ...(raw.members || {}) },
      today: {
        inside: 0, entries: 0, exits: 0, avg_minutes: 0, peak_hour: null, peak_entries: 0,
        ...(raw.today || {}),
      },
      inside: arr(raw.inside),
      recent: arr(raw.recent),
      gender: arr(raw.gender),
      departments: arr(raw.departments),
      courses: arr(raw.courses),
      memberMix: arr(raw.memberMix),
      trend: arr(raw.trend),
      hourly: arr(raw.hourly),
    };
    const name = d.institute?.name || state.institute?.name || "Your university";

    const trendMap = new Map(d.trend.map((t) => [String(t.day).slice(0, 10), t]));
    const trend = Array.from({ length: 14 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (13 - i));
      const key = dayKey(date);
      const row = trendMap.get(key);
      const value = row ? Number(row.entries) || 0 : 0;
      return { value, key, title: `${shortDay(key)} — ${value} entries` };
    });

    const hourlyRows = d.hourly.length
      ? d.hourly
      : Array.from({ length: 24 }, (_, hour) => ({ hour, entries: 0, exits: 0 }));
    const hourly = hourlyRows.map((h) => ({
      value: (Number(h.entries) || 0) + (Number(h.exits) || 0),
      hour: h.hour,
      title: `${hourLabel(h.hour)} — ${Number(h.entries) || 0} in / ${Number(h.exits) || 0} out`,
    }));



    view.innerHTML = `
      ${filterBar()}
      <p class="muted live-line"><span class="live-dot"></span>
        ${esc(name)} · ${d.members.active} active members · updates automatically as people scan</p>

      <div class="grid cols-5" style="margin-top:.8rem">
        <div class="panel stat"><p class="muted">Currently inside</p><div class="v">${d.today.inside}</div></div>
        <div class="panel stat"><p class="muted">Entries today</p><div class="v">${d.today.entries}</div></div>
        <div class="panel stat"><p class="muted">Exits today</p><div class="v">${d.today.exits}</div></div>
        <div class="panel stat"><p class="muted">Avg. visit</p><div class="v">${mins(d.today.avg_minutes)}</div></div>
        <div class="panel stat"><p class="muted">Peak hour</p><div class="v">${hourLabel(d.today.peak_hour)}</div>
          <p class="muted">${d.today.peak_entries} entries</p></div>
      </div>

      <div class="grid cols-2" style="margin-top:1rem">
        <div class="panel">
          <div class="row" style="justify-content:space-between">
            <h3>Currently reading</h3><span class="badge ok">${d.inside.length} inside</span>
          </div>
          <div style="max-height:280px;overflow:auto;margin-top:.6rem">
            <table>
              <thead><tr><th>Member</th><th>Department</th><th>Entry</th><th>Duration</th></tr></thead>
              <tbody>${
                d.inside.length
                  ? d.inside
                      .map(
                        (r) => `<tr>
                          <td>${esc(r.full_name)}<br><span class="muted">${esc(r.member_code)}</span></td>
                          <td>${esc(r.department || "—")}</td>
                          <td>${esc(fmtTime(r.entry_at))}</td>
                          <td>${mins(r.minutes)}</td></tr>`,
                      )
                      .join("")
                  : `<tr><td colspan="4" class="muted">Nobody is inside the library right now.</td></tr>`
              }</tbody>
            </table>
          </div>
        </div>

        <div class="panel">
          <h3>Members by type</h3>
          <p class="muted">${d.members.total} total · ${d.members.active} active · ${d.members.expired} past validity</p>
          <div style="margin-top:.6rem">${pie(d.memberMix, esc)}</div>
        </div>
      </div>

      <div class="grid cols-2" style="margin-top:1rem">
        <div class="panel">
          <h3>Today by gender</h3>
          <div style="margin-top:.6rem">${barList(d.gender, esc, "No entries recorded today yet.")}</div>
        </div>
      </div>

      <div class="grid cols-2" style="margin-top:1rem">
        <div class="panel">
          <h3>Hourly footfall today</h3>
          ${columnChart(hourly, { xLabel: (p) => (HOUR_LABELS.includes(p.hour) ? hourLabel(p.hour) : ""), axisEvery: 1 })}
        </div>
        <div class="panel">
          <h3>14-day trend</h3>
          ${columnChart(trend, { xLabel: (p) => shortDay(p.key), axisEvery: 3 })}
        </div>
      </div>

      <div class="grid cols-2" style="margin-top:1rem">
        <div class="panel">
          <h3>Department footfall today</h3>
          <div style="margin-top:.6rem">${barList(d.departments, esc, "No entries recorded today yet.")}</div>
        </div>
        <div class="panel">
          <h3>Course footfall today</h3>
          <div style="margin-top:.6rem">${barList(d.courses, esc, "No entries recorded today yet.")}</div>
        </div>
      </div>

      <div class="panel" style="margin-top:1rem">
        <h3>Latest scans</h3>
        <table>
          <thead><tr><th>Member</th><th>Action</th><th>Method</th><th>Time</th></tr></thead>
          <tbody>${
            d.recent.length
              ? d.recent
                  .map(
                    (r) => `<tr>
                      <td>${esc(r.full_name)}<br><span class="muted">${esc(r.member_code)}</span></td>
                      <td><span class="badge ${r.action === "Entry" ? "ok" : ""}">${esc(r.action)}</span></td>
                      <td>${esc(r.method)}</td><td>${fmtDate(r.occurred_at)}</td></tr>`,
                  )
                  .join("")
              : `<tr><td colspan="4" class="muted">No scans recorded yet.</td></tr>`
          }</tbody>
        </table>
      </div>`;

    bindFilters();
  };

  await paint();

  // Live refresh while the dashboard is on screen.
  const timer = setInterval(() => {
    if (!document.body.contains(view) || !view.querySelector(".live-line")) return clearInterval(timer);
    paint().catch(() => {});
  }, 15000);
}
