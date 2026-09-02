/**
 * Student visit analysis — Sankey graph (Course → Department → Time period).
 *
 * Drawn as plain inline SVG so the kiosk/admin app keeps working offline with
 * no charting library. Flow thickness = number of library visits (Entry scans).
 * Time periods are 3-hour bands between 08:00 and 23:00 on the university's
 * own wall clock; scans outside that window are grouped as "Other hours".
 */

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n) => iso(new Date(Date.now() - n * 86400000));

const PALETTE = [
  "#2563eb", "#0891b2", "#7c3aed", "#db2777", "#ea580c",
  "#16a34a", "#ca8a04", "#0f766e", "#9333ea", "#dc2626",
];
const colourFor = (name, index) => PALETTE[index % PALETTE.length] || "#2563eb";

/** Lay out one column of nodes inside `height` pixels. */
function layout(list, total, x, height, gap) {
  const usable = Math.max(40, height - gap * Math.max(0, list.length - 1));
  let y = 0;
  return list.map((n, i) => {
    const h = total > 0 ? Math.max(3, (n.visits / total) * usable) : 0;
    const node = { ...n, x, y, height: h, index: i };
    y += h + gap;
    return node;
  });
}

const ribbon = (x0, y0, x1, y1, thickness) => {
  const mid = (x0 + x1) / 2;
  return `M${x0},${y0} C${mid},${y0} ${mid},${y1} ${x1},${y1}
          L${x1},${y1 + thickness} C${mid},${y1 + thickness} ${mid},${y0 + thickness} ${x0},${y0 + thickness} Z`;
};

function drawSankey(svg, data, esc) {
  const width = Math.max(760, svg.clientWidth || 900);
  const rowsCount = Math.max(data.courses.length, data.departments.length, data.periods.length);
  const height = Math.max(320, Math.min(900, rowsCount * 46 + 60));
  const pad = 30;   // leaves room for the column captions and middle labels
  const nodeW = 16;
  const colX = [pad, width / 2 - nodeW / 2, width - pad - nodeW];
  const inner = height - pad * 2;
  const total = data.total_visits || 0;

  const courses = layout(data.courses, total, colX[0], inner, 10);
  const departments = layout(data.departments, total, colX[1], inner, 10);
  const periods = layout(data.periods, total, colX[2], inner, 10);
  const byName = (list) => new Map(list.map((n) => [n.name, n]));
  const cMap = byName(courses), dMap = byName(departments), pMap = byName(periods);

  // Running offsets so several ribbons stack neatly on the same node edge.
  const outAt = new Map(), inAt = new Map();
  const take = (map, key, size) => {
    const at = map.get(key) || 0;
    map.set(key, at + size);
    return at;
  };

  const scale = (visits) => (total > 0 ? Math.max(1.5, (visits / total) * (inner - 10 * Math.max(0, courses.length - 1))) : 0);

  const paths = [];
  const pushLink = (from, to, link, colourIdx) => {
    if (!from || !to) return;
    const t = Math.min(scale(link.visits), from.height, to.height);
    const y0 = from.y + pad + take(outAt, from.name + "@" + from.x, t);
    const y1 = to.y + pad + take(inAt, to.name + "@" + to.x, t);
    paths.push(`<path class="sk-link" d="${ribbon(from.x + nodeW, y0, to.x, y1, t)}"
      fill="${colourFor(from.name, colourIdx)}" fill-opacity=".32"
      data-tip="${esc(`${from.name} → ${to.name}: ${link.visits} visit${link.visits === 1 ? "" : "s"} (${total ? Math.round((link.visits / total) * 100) : 0}% of ${total})`)}"></path>`);
  };

  for (const link of data.course_department) {
    const from = cMap.get(link.source);
    pushLink(from, dMap.get(link.target), link, from ? from.index : 0);
  }
  for (const link of data.department_period) {
    const from = dMap.get(link.source);
    pushLink(from, pMap.get(link.target), link, from ? from.index : 0);
  }

  const nodesHtml = (list, anchor) => list.map((n) => {
    const label = `${n.name} · ${n.visits}`;
    const tx = anchor === "start" ? n.x + nodeW + 6 : n.x - 6;
    return `<g class="sk-node" data-tip="${esc(`${n.name}: ${n.visits} visit${n.visits === 1 ? "" : "s"} (${total ? Math.round((n.visits / total) * 100) : 0}%)`)}">
      <rect x="${n.x}" y="${n.y + pad}" width="${nodeW}" height="${Math.max(2, n.height)}" rx="3"
        fill="${colourFor(n.name, n.index)}"></rect>
      <text x="${tx}" y="${n.y + pad + Math.max(2, n.height) / 2 + 4}" text-anchor="${anchor === "start" ? "start" : "end"}"
        class="sk-label">${esc(label)}</text>
    </g>`;
  }).join("");

  const midLabels = departments.map((n) => `<g class="sk-node" data-tip="${esc(`${n.name}: ${n.visits} visits`)}">
      <rect x="${n.x}" y="${n.y + pad}" width="${nodeW}" height="${Math.max(2, n.height)}" rx="3" fill="${colourFor(n.name, n.index)}"></rect>
      <text x="${n.x + nodeW / 2}" y="${n.y + pad - 3}" text-anchor="middle" class="sk-label">${esc(`${n.name} · ${n.visits}`)}</text>
    </g>`).join("");

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("height", height);
  svg.innerHTML = `
    <g class="sk-links">${paths.join("")}</g>
    ${nodesHtml(courses, "start")}
    ${midLabels}
    ${nodesHtml(periods, "end")}
    <text x="${colX[0]}" y="12" class="sk-col">Course</text>
    <text x="${colX[1] + nodeW / 2}" y="12" text-anchor="middle" class="sk-col">Department</text>
    <text x="${colX[2] + nodeW}" y="12" text-anchor="end" class="sk-col">Time period</text>`;
}

export async function mountSankey(host, { api, esc, toast }, masters = {}) {
  host.innerHTML = `
    <div class="panel sankey-panel" id="sankeyPanel">
      <div class="row" style="justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:.6rem">
        <div>
          <h3 style="margin:0">Student visit analysis (Sankey)</h3>
          <p class="muted" style="margin:.2rem 0 0">Course → Department → Time period. Flow thickness = number of visits.</p>
        </div>
        <button class="ghost" id="skRefresh">Refresh</button>
      </div>

      <div class="row" id="skFilters" style="margin-top:.8rem;flex-wrap:wrap">
        <div><label for="skFrom">From date</label><input id="skFrom" type="date" value="${daysAgo(29)}" /></div>
        <div><label for="skTo">To date</label><input id="skTo" type="date" value="${iso(new Date())}" /></div>
        <div><label for="skCourse">Course</label><select id="skCourse"><option value="">All courses</option>
          ${(masters.courses || []).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select></div>
        <div><label for="skDept">Department</label><select id="skDept"><option value="">All departments</option>
          ${(masters.departments || []).map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join("")}</select></div>
      </div>

      <p class="muted" id="skSummary" style="margin:.7rem 0 0">Loading…</p>
      <div class="sankey-wrap"><svg id="skChart" class="sankey" role="img" aria-label="Student visit flow"></svg></div>
      <div class="sankey-tip" id="skTip" hidden></div>
    </div>`;

  const $ = (s) => host.querySelector(s);
  const svg = $("#skChart");
  const tip = $("#skTip");
  let data = null;

  const showTip = (e, text) => {
    const box = host.querySelector(".sankey-wrap").getBoundingClientRect();
    tip.textContent = text;
    tip.hidden = false;
    tip.style.left = `${Math.max(8, e.clientX - box.left + 12)}px`;
    tip.style.top = `${Math.max(8, e.clientY - box.top + 12)}px`;
  };
  svg.addEventListener("mousemove", (e) => {
    const target = e.target.closest("[data-tip]");
    if (target) showTip(e, target.dataset.tip);
    else tip.hidden = true;
  });
  svg.addEventListener("mouseleave", () => { tip.hidden = true; });

  async function load() {
    const params = new URLSearchParams({
      from: $("#skFrom").value,
      to: $("#skTo").value,
      course_id: $("#skCourse").value,
      department_id: $("#skDept").value,
    });
    $("#skSummary").textContent = "Loading…";
    try {
      data = await api(`/api/reports/sankey?${params}`);
    } catch (e) {
      $("#skSummary").textContent = e.message;
      svg.innerHTML = "";
      return;
    }
    if (!data.total_visits) {
      $("#skSummary").textContent = "No visits recorded for the selected filters.";
      svg.innerHTML = "";
      svg.removeAttribute("height");
      return;
    }
    const h = data.highlights || {};
    $("#skSummary").innerHTML =
      `<strong>${data.total_visits}</strong> visits · busiest course <strong>${esc(h.top_course?.name || "—")}</strong>` +
      ` · busiest department <strong>${esc(h.top_department?.name || "—")}</strong>` +
      ` · peak period <strong>${esc(h.peak_period?.name || "—")}</strong>`;
    drawSankey(svg, data, esc);
  }

  for (const id of ["#skFrom", "#skTo", "#skCourse", "#skDept"]) {
    $(id).onchange = () => load().catch((e) => toast(e.message, true));
  }
  $("#skRefresh").onclick = () => load().catch((e) => toast(e.message, true));
  window.addEventListener("resize", () => { if (data?.total_visits) drawSankey(svg, data, esc); });

  await load();
}
