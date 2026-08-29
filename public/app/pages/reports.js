import { canExport } from "/app/admin.js";
/**
 * University Admin → Reports section.
 *
 * Time zone: every timestamp shown here is the local wall clock of the computer
 * running the app (the university's own zone, e.g. IST). No UTC conversion is
 * applied, so reports match what the kiosk displayed.
 * Durations arrive from the server as raw seconds and are shown as HH:MM:SS
 * (hours may exceed 24 for heavy users).
 */

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const daysAgo = (n) => iso(new Date(Date.now() - n * 86400000));

/** Column definitions per report. `dt` = datetime rendered in the local zone. */
const REPORTS = {
  register: {
    label: "Entry / exit register",
    endpoint: "/api/reports/logs",
    filters: ["dates", "action", "method", "search"],
    calendar: true,
    columns: [
      { key: "occurred_at", label: "Time", type: "dt" },
      { key: "full_name", label: "Member" },
      { key: "member_code", label: "Student ID" },
      { key: "course", label: "Course" },
      { key: "department", label: "Department" },
      { key: "action", label: "Action", badge: true },
      { key: "method", label: "Method" },
      { key: "device_id", label: "Location / device" },
    ],
  },
  history: {
    label: "Transaction history (multi-kiosk)",
    endpoint: "/api/reports/history",
    filters: ["dates", "search"],
    calendar: true,
    columns: [
      { key: "occurred_at", label: "Time", type: "dt" },
      { key: "full_name", label: "Member" },
      { key: "member_code", label: "Student ID" },
      { key: "action", label: "Action", badge: true },
      { key: "kiosk", label: "Kiosk" },
      { key: "sublibrary", label: "Library" },
      { key: "location", label: "Location" },
      { key: "method", label: "Method" },
    ],
  },
  visits: {
    label: "1 · Visit-wise detail",
    endpoint: "/api/reports/visits",
    filters: ["dates", "course", "department", "designation", "location", "search"],
    paged: true,
    calendar: true,
    defaultSort: { key: "entry_time", dir: "desc" },
    columns: [
      { key: "student_id", label: "Student ID", sort: "student_code" },
      { key: "name", label: "Name", sort: "name" },
      { key: "course", label: "Course", sort: "course" },
      { key: "designation", label: "Designation", sort: "designation" },
      { key: "location", label: "Location", sort: "location" },
      { key: "entry_time", label: "Entry time", type: "dt", sort: "entry_time" },
      { key: "exit_time", label: "Exit time", type: "dt", sort: "exit_time", empty: "In Progress" },
      { key: "time_spent", label: "Time spent", sort: "seconds" },
    ],
  },
  student_time: {
    label: "2 · Student-wise total time",
    endpoint: "/api/reports/student-time",
    filters: ["dates", "course", "department", "designation", "search", "minVisits"],
    columns: [
      { key: "student_id", label: "Student ID" },
      { key: "name", label: "Name" },
      { key: "course", label: "Course" },
      { key: "designation", label: "Designation" },
      { key: "visits", label: "Total visits", num: true },
      { key: "first_entry", label: "First entry", type: "dt" },
      { key: "last_exit", label: "Last exit", type: "dt", empty: "Still inside" },
      { key: "total_time", label: "Total time spent" },
    ],
  },
  course_summary: {
    label: "3 · Course-wise summary",
    endpoint: "/api/reports/course-summary",
    filters: ["dates"],
    columns: [
      { key: "course", label: "Course" },
      { key: "students", label: "Total students", num: true },
      { key: "visits", label: "Total visits", num: true },
      { key: "total_time", label: "Total time spent" },
      { key: "avg_time", label: "Average per visit" },
    ],
  },
  footfall: {
    label: "4 · Daily attendance / footfall",
    endpoint: "/api/reports/footfall",
    filters: ["dates", "course", "designation"],
    columns: [
      { key: "date", label: "Date" },
      { key: "unique_students", label: "Unique students", num: true },
      { key: "entries", label: "Total entries", num: true },
      { key: "peak_hour", label: "Peak entry hour" },
      { key: "peak_entries", label: "Entries in peak hour", num: true },
    ],
  },
  inside: {
    label: "5 · Currently inside (live)",
    endpoint: "/api/reports/inside",
    filters: [],
    live: true,
    columns: [
      { key: "student_id", label: "Student ID" },
      { key: "name", label: "Name" },
      { key: "course", label: "Course" },
      { key: "designation", label: "Designation" },
      { key: "location", label: "Location" },
      { key: "entry_time", label: "Entry time", type: "dt" },
      { key: "duration_so_far", label: "Duration so far" },
    ],
  },
  absentees: {
    label: "6 · Absentee / non-visit",
    endpoint: "/api/reports/absentees",
    filters: ["dates", "course", "department", "designation", "search"],
    columns: [
      { key: "student_id", label: "Student ID" },
      { key: "name", label: "Name" },
      { key: "course", label: "Course" },
      { key: "department", label: "Department" },
      { key: "designation", label: "Designation" },
    ],
  },
  designation_summary: {
    label: "7 · Designation-wise summary",
    endpoint: "/api/reports/designation-summary",
    filters: ["dates"],
    columns: [
      { key: "designation", label: "Designation" },
      { key: "students", label: "Total students", num: true },
      { key: "visits", label: "Total visits", num: true },
      { key: "total_time", label: "Total time spent" },
      { key: "avg_time", label: "Average per visit" },
    ],
  },
  location_summary: {
    label: "8 · Location-wise",
    endpoint: "/api/reports/location-summary",
    filters: ["dates"],
    columns: [
      { key: "location", label: "Location" },
      { key: "students", label: "Unique students", num: true },
      { key: "visits", label: "Total entries", num: true },
      { key: "total_time", label: "Total time spent" },
      { key: "avg_time", label: "Average per visit" },
    ],
  },
};

const STORE_KEY = "ler_report_columns_v2";

function loadColumnPrefs(key, columns) {
  try {
    const all = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    const saved = all?.[key];
    if (saved) return Object.fromEntries(columns.map((c) => [c.key, saved[c.key] !== false]));
  } catch {
    /* ignore corrupt prefs */
  }
  return Object.fromEntries(columns.map((c) => [c.key, true]));
}

function saveColumnPrefs(key, visible) {
  try {
    const all = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    all[key] = visible;
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    /* storage full / disabled — prefs are best-effort */
  }
}

export async function renderReports(view, { api, esc, fmtDate, downloadCsv, toast }) {
  const today = iso(new Date());
  const masters = (await api("/api/masters").catch(() => ({}))) || {};
  const options = (await api("/api/reports/options").catch(() => ({}))) || {};
  const designations = options.designations?.length ? options.designations : ["Student", "Research Scholar", "Faculty", "Staff"];
  const locations = options.locations || [];
  // PDF header / footer configured under Master Setting (used only by the PDF export).
  const branding = (await api("/api/settings/pdf-branding").catch(() => null)) || {};
  const hasBranding = Number(branding.enabled) === 1 &&
    (branding.header_type !== "none" || branding.footer_type !== "none");

  let reportKey = "visits";
  let rows = [];
  let total = 0;
  let page = 1;
  let pageSize = 50;
  let sort = { key: "entry_time", dir: "desc" };
  let visible = loadColumnPrefs(reportKey, REPORTS[reportKey].columns);
  let month = new Date();
  month.setDate(1);
  let liveTimer = null;
  let calendarCounts = {};

  view.innerHTML = `
    <div class="panel">
      <div class="row" style="justify-content:space-between;align-items:flex-end;gap:.8rem;flex-wrap:wrap">
        <div style="min-width:260px">
          <label for="reportType">Report</label>
          <select id="reportType" style="width:100%">
            ${Object.entries(REPORTS).map(([k, r]) => `<option value="${k}"${k === reportKey ? " selected" : ""}>${esc(r.label)}</option>`).join("")}
          </select>
        </div>
        <div class="row">
          ${canExport() ? `
          <button class="ghost" id="exportCsv">Export CSV</button>
          <button class="ghost" id="exportXls">Export Excel</button>
          <button class="ghost" id="print">Print / PDF (A4)</button>
          ${hasBranding ? `<label class="row" style="gap:.35rem;align-items:center;margin:0">
            <input type="checkbox" id="pdfBrand" checked /> With header &amp; footer</label>` : ""}` : `
          <span class="muted">Downloads are disabled for your account</span>`}
        </div>
      </div>
      <p class="muted" id="reportHint" style="margin:.5rem 0 0"></p>
    </div>

    <div class="row" style="align-items:flex-start;gap:1rem;flex-wrap:wrap;margin-top:1rem">
      <div class="panel rep-cal" id="calPanel" style="min-width:280px">
        <div class="row rep-cal-head" style="justify-content:space-between;align-items:center">
          <button class="ghost rep-cal-nav" id="prevMonth" title="Previous month">‹</button>
          <strong id="monthLabel" class="rep-cal-month"></strong>
          <button class="ghost rep-cal-nav" id="nextMonth" title="Next month">›</button>
        </div>
        <div id="calGrid" class="rep-cal-grid"></div>
        <p class="muted rep-cal-hint" style="margin-top:.6rem;font-size:.8rem">Click a date to see that day only.</p>
        <button class="ghost rep-cal-today" id="todayBtn" style="width:100%">Today</button>
      </div>

      <div class="panel" style="flex:1;min-width:420px">
        <div class="row" id="filterBar">
          <div data-f="dates"><label for="from">From</label><input id="from" type="date" value="${daysAgo(6)}" /></div>
          <div data-f="dates"><label for="to">To</label><input id="to" type="date" value="${today}" /></div>
          <div data-f="action"><label for="action">Action</label><select id="action">
            <option value="">All</option><option>Entry</option><option>Exit</option></select></div>
          <div data-f="method"><label for="method">Method</label><select id="method">
            <option value="">All</option><option>Palm</option><option>RFID</option><option>Manual</option><option>Barcode</option><option>Auto</option></select></div>
          <div data-f="course"><label for="course">Course</label><select id="course"><option value="">All</option>
            ${(masters.courses || []).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select></div>
          <div data-f="department"><label for="department">Department</label><select id="department"><option value="">All</option>
            ${(masters.departments || []).map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join("")}</select></div>
          <div data-f="designation"><label for="designation">Designation</label><select id="designation"><option value="">All</option>
            ${designations.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join("")}</select></div>
          <div data-f="location"><label for="location">Location</label><select id="location"><option value="">All</option>
            ${locations.map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join("")}</select></div>
          <div data-f="minVisits"><label for="minVisits">Min visits</label><input id="minVisits" type="number" min="0" value="0" style="width:90px" /></div>
          <div data-f="search"><label for="search">Search</label><input id="search" placeholder="Student ID or name" /></div>
          <div><label>&nbsp;</label><button id="apply">Apply</button></div>
        </div>

        <details style="margin-top:.8rem">
          <summary style="cursor:pointer">Choose columns to show, export and print</summary>
          <div class="row" id="colToggles" style="flex-wrap:wrap;gap:.8rem;margin-top:.6rem"></div>
        </details>

        <p class="muted" id="count" style="margin-top:.6rem"></p>
        <div style="overflow:auto"><table>
          <thead id="thead"></thead>
          <tbody id="tbody"><tr><td class="muted">Loading…</td></tr></tbody>
        </table></div>

        <div class="row" id="pager" style="justify-content:space-between;margin-top:.7rem">
          <div class="row" style="gap:.5rem;align-items:center">
            <label for="pageSize" style="margin:0">Rows per page</label>
            <select id="pageSize">${[25, 50, 100, 200].map((n) => `<option${n === 50 ? " selected" : ""}>${n}</option>`).join("")}</select>
          </div>
          <div class="row" style="gap:.5rem;align-items:center">
            <button class="ghost" id="prevPage">Previous</button>
            <span class="muted" id="pageInfo"></span>
            <button class="ghost" id="nextPage">Next</button>
          </div>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:1rem">
      <h3>Failed scans</h3>
      <table><thead><tr><th>Time</th><th>Attempted</th><th>Reason</th><th>Method</th><th>Device</th></tr></thead>
      <tbody id="failed"><tr><td colspan="5" class="muted">Loading…</td></tr></tbody></table>
    </div>`;

  // Missing elements (e.g. export buttons hidden for restricted accounts) return
  // a harmless stub so handler wiring below never throws.
  const $ = (s) => view.querySelector(s) || {};
  const cfg = () => REPORTS[reportKey];
  const activeColumns = () => cfg().columns.filter((c) => visible[c.key] !== false);

  const cellText = (r, c) => {
    const v = r[c.key];
    if (v === null || v === undefined || v === "") return c.empty || "—";
    if (c.type === "dt") return fmtDate(v);
    return String(v);
  };

  const renderColToggles = () => {
    $("#colToggles").innerHTML = cfg().columns.map((c) =>
      `<label style="display:flex;align-items:center;gap:.35rem;font-weight:500">
        <input type="checkbox" data-col="${esc(c.key)}" ${visible[c.key] !== false ? "checked" : ""} /> ${esc(c.label)}
      </label>`).join("");
    for (const box of view.querySelectorAll("#colToggles input[data-col]")) {
      box.onchange = () => {
        visible = { ...visible, [box.dataset.col]: box.checked };
        saveColumnPrefs(reportKey, visible);
        renderTable();
      };
    }
  };

  const sortRowsLocally = (list) => {
    if (!sort.key) return list;
    const col = cfg().columns.find((c) => c.key === sort.key);
    if (!col) return list;
    const sortKey = col.num ? sort.key : sort.key;
    return [...list].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const cmp = col.num
        ? Number(av || 0) - Number(bv || 0)
        : String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true });
      return sort.dir === "asc" ? cmp : -cmp;
    });
  };

  const renderTable = () => {
    const cols = activeColumns();
    $("#thead").innerHTML = `<tr>${cols.map((c) => {
      const active = sort.key === (c.sort || c.key);
      const arrow = active ? (sort.dir === "asc" ? " ▲" : " ▼") : "";
      return `<th style="cursor:pointer;user-select:none" data-sort="${esc(c.sort || c.key)}">${esc(c.label)}${arrow}</th>`;
    }).join("")}</tr>`;

    for (const th of view.querySelectorAll("#thead th[data-sort]")) {
      th.onclick = () => {
        const key = th.dataset.sort;
        sort = { key, dir: sort.key === key && sort.dir === "desc" ? "asc" : "desc" };
        if (cfg().paged) { page = 1; load().catch((e) => toast(e.message, true)); }
        else { rows = sortRowsLocally(rows); renderTable(); }
      };
    }

    if (!cols.length) {
      $("#tbody").innerHTML = `<tr><td class="muted">Select at least one column.</td></tr>`;
      return;
    }
    $("#tbody").innerHTML = rows.length
      ? rows.map((r) => `<tr>${cols.map((c) => {
          if (c.badge) return `<td><span class="badge ${r[c.key] === "Entry" ? "ok" : ""}">${esc(r[c.key])}</span></td>`;
          const txt = cellText(r, c);
          const flag = txt === "In Progress" || txt === "Still inside";
          return `<td${flag ? ' class="muted"' : ""}>${esc(txt)}</td>`;
        }).join("")}</tr>`).join("")
      : `<tr><td colspan="${cols.length}" class="muted">No records found for selected filters.</td></tr>`;
  };

  const renderCalendar = (counts = {}) => {
    $("#monthLabel").textContent = `${MONTHS[month.getMonth()]} ${month.getFullYear()}`;
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const selected = $("#from").value === $("#to").value ? $("#from").value : "";
    const head = ["S", "M", "T", "W", "T", "F", "S"].map((d) => `<div class="rep-cal-dow">${d}</div>`).join("");
    const blanks = Array.from({ length: first.getDay() }, () => `<div class="rep-cal-blank"></div>`).join("");
    const cells = Array.from({ length: days }, (_, i) => {
      const date = iso(new Date(month.getFullYear(), month.getMonth(), i + 1));
      const n = counts[date] || 0;
      const cls = ["ghost", "rep-cal-day"];
      if (date === selected) cls.push("is-selected");
      if (date === today) cls.push("is-today");
      if (n) cls.push("has-records");
      return `<button class="${cls.join(" ")}" data-date="${date}" title="${n} record(s)">
        <span class="rep-cal-num">${i + 1}</span>${n ? `<span class="rep-cal-count">${n}</span>` : ""}</button>`;
    }).join("");
    $("#calGrid").innerHTML = head + blanks + cells;
    for (const btn of view.querySelectorAll("#calGrid button[data-date]")) {
      btn.onclick = () => {
        $("#from").value = btn.dataset.date;
        $("#to").value = btn.dataset.date;
        page = 1;
        load().catch((e) => toast(e.message, true));
      };
    }
  };

  const filterParams = () => {
    const use = cfg().filters;
    const p = new URLSearchParams();
    if (use.includes("dates")) { p.set("from", $("#from").value); p.set("to", $("#to").value); }
    if (use.includes("action")) p.set("action", $("#action").value);
    if (use.includes("method")) p.set("method", $("#method").value);
    if (use.includes("course")) p.set("course_id", $("#course").value);
    if (use.includes("department")) p.set("department_id", $("#department").value);
    if (use.includes("designation")) p.set("designation", $("#designation").value);
    if (use.includes("location")) p.set("location", $("#location").value);
    if (use.includes("minVisits")) p.set("min_visits", $("#minVisits").value || 0);
    if (use.includes("search")) p.set("search", $("#search").value.trim());
    return p;
  };

  const load = async () => {
    const c = cfg();
    const params = filterParams();
    if (c.paged) {
      params.set("page", page);
      params.set("page_size", pageSize);
      params.set("sort", sort.key);
      params.set("dir", sort.dir);
    }
    const data = await api(`${c.endpoint}?${params}`);
    if (c.paged) {
      rows = data?.rows || [];
      total = Number(data?.total || 0);
    } else {
      rows = Array.isArray(data) ? data : [];
      total = rows.length;
      rows = sortRowsLocally(rows);
    }
    const range = c.filters.includes("dates") ? ` · ${$("#from").value} → ${$("#to").value}` : " · live";
    $("#count").textContent = `${total} record(s)${range}`;
    if (c.paged) {
      const pages = Math.max(1, Math.ceil(total / pageSize));
      $("#pageInfo").textContent = `Page ${page} of ${pages}`;
      $("#prevPage").disabled = page <= 1;
      $("#nextPage").disabled = page >= pages;
    }
    renderTable();
    if (c.calendar) renderCalendar(calendarCounts);
  };

  const refreshMonth = async () => {
    if (!cfg().calendar) return;
    const from = iso(new Date(month.getFullYear(), month.getMonth(), 1));
    const to = iso(new Date(month.getFullYear(), month.getMonth() + 1, 0));
    const list = (await api(`/api/reports/logs?${new URLSearchParams({ from, to })}`).catch(() => [])) || [];
    calendarCounts = {};
    for (const r of list) {
      const day = String(r.occurred_at).slice(0, 10);
      calendarCounts[day] = (calendarCounts[day] || 0) + 1;
    }
    renderCalendar(calendarCounts);
  };

  const applyLayout = () => {
    const c = cfg();
    for (const box of view.querySelectorAll("#filterBar > div[data-f]")) {
      box.style.display = c.filters.includes(box.dataset.f) ? "" : "none";
    }
    $("#calPanel").style.display = c.calendar ? "" : "none";
    $("#pager").style.display = c.paged ? "" : "none";
    $("#reportHint").textContent = c.live
      ? "Live view of members who entered but have not exited — refreshes every 60 seconds."
      : "Date range defaults to the last 7 days. Visits still in progress are excluded from time totals.";
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
    if (c.live) liveTimer = setInterval(() => load().catch(() => {}), 60000);
  };

  const switchReport = async (key) => {
    reportKey = key;
    const c = cfg();
    page = 1;
    sort = c.defaultSort ? { ...c.defaultSort } : { key: c.columns[0].key, dir: "asc" };
    visible = loadColumnPrefs(reportKey, c.columns);
    applyLayout();
    renderColToggles();
    $("#tbody").innerHTML = `<tr><td class="muted">Loading…</td></tr>`;
    await load();
    await refreshMonth();
  };

  /** Rows shaped for export — respects the visible column choice. */
  const exportRows = () => activeColumns().length
    ? rows.map((r) => Object.fromEntries(activeColumns().map((c) => [c.label, cellText(r, c)])))
    : [];

  const reportTitle = () => `${cfg().label}${cfg().filters.includes("dates") ? ` (${$("#from").value} to ${$("#to").value})` : ""}`;

  const tableHtml = () => {
    const cols = activeColumns();
    return `<table>
      <thead><tr><th>#</th>${cols.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td>${cols.map((c) => `<td>${esc(cellText(r, c))}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>`;
  };

  $("#reportType").onchange = (e) => switchReport(e.target.value).catch((err) => toast(err.message, true));
  $("#apply").onclick = () => { page = 1; load().catch((e) => toast(e.message, true)); };
  $("#pageSize").onchange = (e) => { pageSize = Number(e.target.value); page = 1; load().catch((err) => toast(err.message, true)); };
  $("#prevPage").onclick = () => { if (page > 1) { page -= 1; load().catch((e) => toast(e.message, true)); } };
  $("#nextPage").onclick = () => { page += 1; load().catch((e) => toast(e.message, true)); };

  $("#prevMonth").onclick = () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); refreshMonth(); };
  $("#nextMonth").onclick = () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); refreshMonth(); };
  $("#todayBtn").onclick = () => {
    month = new Date(); month.setDate(1);
    $("#from").value = today; $("#to").value = today; page = 1;
    load().then(refreshMonth).catch((e) => toast(e.message, true));
  };

  $("#exportCsv").onclick = () => {
    const data = exportRows();
    if (!data.length) return toast("Nothing to export", true);
    downloadCsv(`${reportKey}-${$("#from").value || "live"}.csv`, data);
  };

  // Excel export: an Excel-readable spreadsheet built from the table markup —
  // generated off the render path so large exports never freeze the UI.
  $("#exportXls").onclick = () => {
    if (!rows.length) return toast("Nothing to export", true);
    if (rows.length > 5000) toast("Large export — preparing the file, please wait…");
    setTimeout(() => {
      const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8" />
        <style>td,th{border:1px solid #999;padding:4px;font-family:Arial;font-size:11px}th{background:#eee}</style>
        </head><body><h3>${esc(reportTitle())}</h3>${tableHtml()}</body></html>`;
      const blob = new Blob([`\ufeff${html}`], { type: "application/vnd.ms-excel;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${reportKey}-${$("#from").value || "live"}.xls`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 30);
  };

  // Header / footer markup for the PDF only — never rendered on the admin page.
  const brandBlock = (side) => {
    const type = branding[`${side}_type`];
    const content = branding[`${side}_content`];
    if (!type || type === "none" || !content) return "";
    return type === "image"
      ? `<img src="${esc(content)}" alt="" />`
      : content;
  };

  $("#print").onclick = () => {
    if (!activeColumns().length) return toast("Select at least one column", true);
    if (!rows.length) return toast("Nothing to print", true);

    const brandOn = hasBranding && ($("#pdfBrand").checked !== false);
    const headerHtml = brandOn ? brandBlock("header") : "";
    const footerHtml = brandOn ? brandBlock("footer") : "";
    // The header is part of the first page's normal flow. The footer is fixed
    // in the reserved bottom margin, so neither item can exchange positions.
    const topMm = 12;
    const botMm = footerHtml ? Math.max(12, Number(branding.footer_height_mm) || 18) + 4 : 12;
    const headMm = headerHtml ? (Number(branding.header_height_mm) || 25) : 0;
    const footMm = footerHtml ? (Number(branding.footer_height_mm) || 18) : 0;

    const html = `<!doctype html><html><head><meta charset="utf-8" />
      <title>${esc(reportTitle())}</title>
      <style>
        @page { size: A4 portrait; margin: ${topMm}mm 12mm ${botMm}mm 12mm; }
        body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color:#111; margin:0; }
        h1 { font-size: 16px; margin: 0 0 4px; }
        .meta { font-size: 10px; color: #555; margin-bottom: 8px; }
        table { width: 100%; border-collapse: collapse; font-size: 9.5px; table-layout: fixed; }
        thead { display: table-header-group; }
        th, td { border: 1px solid #bbb; padding: 4px 5px; text-align: left; vertical-align: top; word-wrap: break-word; overflow-wrap: anywhere; }
        th { background: #f0f2f4; font-weight: 600; }
        tr { page-break-inside: avoid; }
        .foot { margin-top: 10px; font-size: 9px; color:#666; }
        .pdf-header { position: relative; width: 100%; height: ${headMm}mm;
          overflow: hidden; margin: 0 0 4mm; break-inside: avoid; page-break-inside: avoid; }
        .pdf-footer { position: fixed; left: 0; right: 0; bottom: -${Math.max(0, botMm - 4)}mm;
          width: 100%; height: ${footMm}mm; overflow: hidden; }
        .pdf-header img, .pdf-footer img { width: 100%; height: 100%; object-fit: contain; object-position: center; display: block; }
      </style></head><body>
      ${headerHtml ? `<div class="pdf-header">${headerHtml}</div>` : ""}
      ${footerHtml ? `<div class="pdf-footer">${footerHtml}</div>` : ""}
      <h1>${esc(cfg().label)}</h1>
      <div class="meta">${esc(reportTitle())} &middot; ${rows.length} row(s) &middot; Printed ${esc(new Date().toLocaleString())}</div>
      ${tableHtml()}
      <div class="foot">Generated by Library Entry &amp; Exit Register</div></body></html>`;


    const win = window.open("", "_blank", "width=1100,height=800");
    if (win && win.document) {
      win.document.open(); win.document.write(html); win.document.close();
      const go = () => { win.focus(); win.print(); };
      if (win.document.readyState === "complete") setTimeout(go, 150);
      else win.onload = () => setTimeout(go, 150);
      return;
    }
    toast("Pop-up blocked — printing inline instead");
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0";
    frame.onload = () => setTimeout(() => {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); }
      catch { toast("Printing was blocked by the browser", true); }
      setTimeout(() => frame.remove(), 2000);
    }, 150);
    document.body.appendChild(frame);
    const doc = frame.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
  };

  const failed = (await api("/api/reports/failed").catch(() => [])) || [];
  $("#failed").innerHTML = failed.length
    ? failed.map((f) => `<tr><td>${fmtDate(f.occurred_at)}</td><td>${esc(f.attempted_code || "—")}</td>
        <td>${esc(f.reason)}</td><td>${esc(f.method)}</td><td>${esc(f.device_id)}</td></tr>`).join("")
    : `<tr><td colspan="5" class="muted">No failed scans recorded.</td></tr>`;

  await switchReport(reportKey);
}
