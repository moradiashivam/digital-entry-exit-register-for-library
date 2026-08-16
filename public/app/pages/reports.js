const COLUMNS = [
  { key: "time", label: "Time", value: (r, { fmtDate }) => fmtDate(r.occurred_at), raw: (r) => r.occurred_at },
  { key: "member", label: "Member", value: (r) => r.full_name, raw: (r) => r.full_name },
  { key: "code", label: "Code", value: (r) => r.member_code, raw: (r) => r.member_code },
  { key: "course", label: "Course", value: (r) => r.course || "—", raw: (r) => r.course || "" },
  { key: "department", label: "Department", value: (r) => r.department || "—", raw: (r) => r.department || "" },
  { key: "action", label: "Action", value: (r) => r.action, raw: (r) => r.action },
  { key: "method", label: "Method", value: (r) => r.method, raw: (r) => r.method },
  { key: "device", label: "Device", value: (r) => r.device_id || "—", raw: (r) => r.device_id || "" },
];

const STORE_KEY = "ler_report_columns";
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function loadColumnPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (saved && typeof saved === "object") {
      return Object.fromEntries(COLUMNS.map((c) => [c.key, saved[c.key] !== false]));
    }
  } catch {
    /* ignore corrupt prefs */
  }
  return Object.fromEntries(COLUMNS.map((c) => [c.key, true]));
}

export async function renderReports(view, { api, esc, fmtDate, downloadCsv, toast }) {
  const today = iso(new Date());
  let rows = [];
  let visible = loadColumnPrefs();
  let month = new Date();
  month.setDate(1);

  view.innerHTML = `
    <div class="row" style="align-items:flex-start;gap:1rem;flex-wrap:wrap">
      <div class="panel rep-cal" id="calPanel" style="min-width:280px">
        <div class="row rep-cal-head" style="justify-content:space-between;align-items:center">
          <button class="ghost rep-cal-nav" id="prevMonth" title="Previous month">‹</button>
          <strong id="monthLabel" class="rep-cal-month"></strong>
          <button class="ghost rep-cal-nav" id="nextMonth" title="Next month">›</button>
        </div>
        <div id="calGrid" class="rep-cal-grid"></div>
        <p class="muted rep-cal-hint" style="margin-top:.6rem;font-size:.8rem">Click a date to see that day's entries and exits.</p>
        <button class="ghost rep-cal-today" id="todayBtn" style="width:100%">Today</button>
      </div>


      <div class="panel" style="flex:1;min-width:420px">
        <div class="row" style="justify-content:space-between">
          <div class="row">
            <div><label for="from">From</label><input id="from" type="date" value="${today}" /></div>
            <div><label for="to">To</label><input id="to" type="date" value="${today}" /></div>
            <div><label for="action">Action</label><select id="action">
              <option value="">All</option><option>Entry</option><option>Exit</option></select></div>
            <div><label for="method">Method</label><select id="method">
              <option value="">All</option><option>Palm</option><option>RFID</option><option>Manual</option></select></div>
            <div><label for="search">Member</label><input id="search" placeholder="Name or code" /></div>
            <div><label>&nbsp;</label><button id="apply">Apply</button></div>
          </div>
          <div class="row">
            <button class="ghost" id="export">Export CSV</button>
            <button class="ghost" id="print">Print / PDF</button>
          </div>
        </div>

        <details style="margin-top:.8rem">
          <summary style="cursor:pointer">Choose columns to show, export and print</summary>
          <div class="row" id="colToggles" style="flex-wrap:wrap;gap:.8rem;margin-top:.6rem">
            ${COLUMNS.map((c) => `<label style="display:flex;align-items:center;gap:.35rem;font-weight:500">
              <input type="checkbox" data-col="${c.key}" ${visible[c.key] ? "checked" : ""} /> ${esc(c.label)}
            </label>`).join("")}
          </div>
        </details>

        <p class="muted" id="count" style="margin-top:.6rem"></p>
        <div style="overflow:auto"><table>
          <thead id="thead"></thead>
          <tbody id="tbody"><tr><td class="muted">Loading…</td></tr></tbody>
        </table></div>
      </div>
    </div>

    <div class="panel" style="margin-top:1rem">
      <h3>Failed scans</h3>
      <table><thead><tr><th>Time</th><th>Attempted</th><th>Reason</th><th>Method</th><th>Device</th></tr></thead>
      <tbody id="failed"><tr><td colspan="5" class="muted">Loading…</td></tr></tbody></table>
    </div>`;

  const $ = (sel) => view.querySelector(sel);
  let currentCounts = {};
  const activeColumns = () => COLUMNS.filter((c) => visible[c.key]);

  const renderTable = () => {
    const cols = activeColumns();
    $("#thead").innerHTML = `<tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr>`;
    if (!cols.length) {
      $("#tbody").innerHTML = `<tr><td class="muted">Select at least one column.</td></tr>`;
      return;
    }
    $("#tbody").innerHTML = rows.length
      ? rows.map((r) => `<tr>${cols.map((c) => {
          if (c.key === "action") {
            return `<td><span class="badge ${r.action === "Entry" ? "ok" : ""}">${esc(r.action)}</span></td>`;
          }
          return `<td>${esc(c.value(r, { fmtDate }))}</td>`;
        }).join("")}</tr>`).join("")
      : `<tr><td colspan="${cols.length}" class="muted">No records for these filters.</td></tr>`;
  };

  const renderCalendar = (counts = {}) => {
    $("#monthLabel").textContent = `${MONTHS[month.getMonth()]} ${month.getFullYear()}`;
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const pad = first.getDay();
    const selected = $("#from").value === $("#to").value ? $("#from").value : "";

    const head = ["S", "M", "T", "W", "T", "F", "S"]
      .map((d) => `<div class="rep-cal-dow">${d}</div>`).join("");
    const blanks = Array.from({ length: pad }, () => `<div class="rep-cal-blank"></div>`).join("");
    const cells = Array.from({ length: days }, (_, i) => {
      const date = iso(new Date(month.getFullYear(), month.getMonth(), i + 1));
      const isSel = date === selected;
      const isToday = date === today;
      const n = counts[date] || 0;
      const cls = ["ghost", "rep-cal-day"];
      if (isSel) cls.push("is-selected");
      if (isToday) cls.push("is-today");
      if (n) cls.push("has-records");
      return `<button class="${cls.join(" ")}" data-date="${date}" data-count="${n}" title="${n} record(s)">
        <span class="rep-cal-num">${i + 1}</span>${n ? `<span class="rep-cal-count">${n}</span>` : ""}
      </button>`;
    }).join("");
    $("#calGrid").innerHTML = head + blanks + cells;


    for (const btn of view.querySelectorAll("#calGrid button[data-date]")) {
      btn.onclick = () => {
        $("#from").value = btn.dataset.date;
        $("#to").value = btn.dataset.date;
        load().catch((e) => toast(e.message, true));
      };
    }
  };

  const load = async () => {
    const params = new URLSearchParams({
      from: $("#from").value,
      to: $("#to").value,
      action: $("#action").value,
      method: $("#method").value,
      search: $("#search").value,
    });
    rows = (await api(`/api/reports/logs?${params}`)) || [];
    const from = $("#from").value;
    const to = $("#to").value;
    $("#count").textContent = `${rows.length} records${from === to && from ? ` on ${from}` : ""}`;
    renderTable();
    renderCalendar(currentCounts);
  };

  const refreshMonth = async () => {
    const from = iso(new Date(month.getFullYear(), month.getMonth(), 1));
    const to = iso(new Date(month.getFullYear(), month.getMonth() + 1, 0));
    const list = (await api(`/api/reports/logs?${new URLSearchParams({ from, to })}`).catch(() => [])) || [];
    currentCounts = {};
    for (const r of list) {
      const day = String(r.occurred_at).slice(0, 10);
      currentCounts[day] = (currentCounts[day] || 0) + 1;
    }
    renderCalendar(currentCounts);
  };

  $("#prevMonth").onclick = () => {
    month = new Date(month.getFullYear(), month.getMonth() - 1, 1);
    refreshMonth();
  };
  $("#nextMonth").onclick = () => {
    month = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    refreshMonth();
  };
  $("#todayBtn").onclick = () => {
    month = new Date();
    month.setDate(1);
    $("#from").value = today;
    $("#to").value = today;
    load().then(refreshMonth).catch((e) => toast(e.message, true));
  };

  for (const box of view.querySelectorAll("#colToggles input[data-col]")) {
    box.onchange = () => {
      visible = { ...visible, [box.dataset.col]: box.checked };
      localStorage.setItem(STORE_KEY, JSON.stringify(visible));
      renderTable();
    };
  }

  $("#apply").onclick = () => load().catch((e) => toast(e.message, true));

  $("#export").onclick = () => {
    const cols = activeColumns();
    if (!cols.length) return toast("Select at least one column", true);
    downloadCsv(
      "entry-exit-register.csv",
      rows.map((r) => Object.fromEntries(cols.map((c) => [c.label, c.raw(r)]))),
    );
  };

  $("#print").onclick = () => {
    const cols = activeColumns();
    if (!cols.length) return toast("Select at least one column", true);
    if (!rows.length) return toast("Nothing to print", true);
    const from = $("#from").value;
    const to = $("#to").value;
    const action = $("#action").value || "All";
    const method = $("#method").value || "All";
    const search = $("#search").value.trim();
    const title = "Entry / Exit Register";

    const html = `<!doctype html><html><head><meta charset="utf-8" />
      <title>${esc(title)}</title>
      <style>
        @page { size: A4 landscape; margin: 12mm; }
        * { box-sizing: border-box; }
        body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color:#111; margin:0; }
        h1 { font-size: 18px; margin: 0 0 4px; }
        .meta { font-size: 11px; color: #555; margin-bottom: 10px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        thead { display: table-header-group; }
        th, td { border: 1px solid #bbb; padding: 5px 6px; text-align: left; vertical-align: top; }
        th { background: #f0f2f4; font-weight: 600; }
        tr { page-break-inside: avoid; }
        .foot { margin-top: 10px; font-size: 10px; color:#666; }
      </style></head><body>
      <h1>${esc(title)}</h1>
      <div class="meta">
        ${esc(from === to ? from || "—" : `${from || "—"} to ${to || "—"}`)} &middot; Action: ${esc(action)} &middot; Method: ${esc(method)}
        ${search ? `&middot; Member: ${esc(search)}` : ""} &middot; ${rows.length} record(s)
        &middot; Printed ${esc(new Date().toLocaleString())}
      </div>
      <table>
        <thead><tr><th>#</th>${cols.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td>${cols
          .map((c) => `<td>${esc(c.value(r, { fmtDate }))}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
      <div class="foot">Generated by Library Entry &amp; Exit Register</div>
      </body></html>`;

    const win = window.open("", "_blank", "width=1100,height=800");
    if (win && win.document) {
      win.document.open();
      win.document.write(html);
      win.document.close();
      const go = () => {
        win.focus();
        win.print();
      };
      if (win.document.readyState === "complete") setTimeout(go, 150);
      else win.onload = () => setTimeout(go, 150);
      return;
    }

    toast("Pop-up blocked — printing inline instead");
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1123px;height:794px;border:0";
    frame.onload = () => {
      setTimeout(() => {
        try {
          frame.contentWindow.focus();
          frame.contentWindow.print();
        } catch {
          toast("Printing was blocked by the browser", true);
        }
        setTimeout(() => frame.remove(), 2000);
      }, 150);
    };
    document.body.appendChild(frame);
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
  };

  const failed = (await api("/api/reports/failed").catch(() => [])) || [];
  $("#failed").innerHTML = failed.length
    ? failed.map((f) => `<tr><td>${fmtDate(f.occurred_at)}</td><td>${esc(f.attempted_code || "—")}</td>
        <td>${esc(f.reason)}</td><td>${esc(f.method)}</td><td>${esc(f.device_id)}</td></tr>`).join("")
    : `<tr><td colspan="5" class="muted">No failed scans recorded.</td></tr>`;

  renderCalendar();
  await load();
  await refreshMonth();
}
