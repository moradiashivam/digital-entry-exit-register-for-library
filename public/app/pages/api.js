/**
 * API & developers — the university administrator issues keys for other
 * applications, watches how those keys are used, and reads the documentation
 * for every endpoint the server publishes.
 */
import { api, toast, esc, fmtDate } from "/app/api.js";

const TABS = [
  ["keys", "API keys"],
  ["logs", "Request log"],
  ["docs", "Documentation"],
];

const STATUS_STYLE = {
  Active: "background:rgba(22,163,74,.12);color:#15803d;border-color:rgba(22,163,74,.35)",
  Revoked: "background:rgba(220,38,38,.12);color:#b91c1c;border-color:rgba(220,38,38,.35)",
};

const pill = (text, style = "") =>
  `<span class="pill" style="${style}">${esc(text)}</span>`;

let SCOPES = [];

export async function renderApi(view) {
  view.innerHTML = `
    <div class="tabs" id="apiTabs">
      ${TABS.map(([k, label], i) => `<button class="tab${i ? "" : " active"}" data-tab="${k}">${label}</button>`).join("")}
    </div>
    <div id="apiBody"><p class="muted">Loading…</p></div>`;

  const body = document.getElementById("apiBody");
  const show = async (tab) => {
    for (const b of view.querySelectorAll("#apiTabs .tab")) b.classList.toggle("active", b.dataset.tab === tab);
    body.innerHTML = `<p class="muted">Loading…</p>`;
    try {
      if (tab === "keys") await renderKeys(body);
      else if (tab === "logs") await renderLogs(body);
      else await renderDocs(body);
    } catch (e) {
      body.innerHTML = `<div class="panel"><p class="muted">${esc(e.message)}</p></div>`;
    }
  };
  for (const b of view.querySelectorAll("#apiTabs .tab")) b.onclick = () => show(b.dataset.tab);
  await show("keys");
}

/* ------------------------------- keys tab -------------------------------- */

async function renderKeys(body) {
  const [{ keys, scopes }, usage] = await Promise.all([api("/api/api-keys"), api("/api/api-keys/usage")]);
  SCOPES = scopes;

  body.innerHTML = `
    <div class="panel">
      <div class="row" style="justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
        <div>
          <h3 style="margin:0 0 4px">Issue a new key</h3>
          <p class="muted" style="margin:0">Another application uses this key to read or write your university's data. It is shown once — copy it straight away.</p>
        </div>
        <div class="row" style="gap:18px">
          <div><div class="muted" style="font-size:12px">Calls (30 days)</div><strong>${usage.calls_30d}</strong></div>
          <div><div class="muted" style="font-size:12px">Failed</div><strong>${usage.failures_30d}</strong></div>
          <div><div class="muted" style="font-size:12px">Average time</div><strong>${usage.avg_ms} ms</strong></div>
        </div>
      </div>
      <div id="keyForm" style="margin-top:14px"></div>
    </div>
    <div class="panel" style="margin-top:16px">
      <h3 style="margin:0 0 10px">Your keys</h3>
      <div id="keyList"></div>
    </div>`;

  mountForm(document.getElementById("keyForm"), body);
  paintList(document.getElementById("keyList"), keys, body);
}

const scopeBoxes = (selected = []) =>
  SCOPES.map(
    (s) => `<label class="row" style="gap:6px;align-items:center">
      <input type="checkbox" value="${s.key}" ${selected.includes(s.key) ? "checked" : ""} />
      <span>${esc(s.label)}</span></label>`,
  ).join("");

function mountForm(host, body) {
  host.innerHTML = `
    <div class="row" style="gap:12px;flex-wrap:wrap;align-items:flex-end">
      <label style="flex:1 1 220px">Key name<input id="kName" placeholder="Campus mobile app" maxlength="120" /></label>
      <label>Requests per minute<input id="kLimit" type="number" min="1" max="6000" value="120" style="width:130px" /></label>
      <label>Expires on (optional)<input id="kExpiry" type="date" /></label>
      <label style="flex:1 1 200px">Allowed IP addresses (optional)<input id="kIps" placeholder="203.0.113.9, 203.0.113.10" /></label>
    </div>
    <div class="row" style="gap:16px;flex-wrap:wrap;margin-top:10px" id="kScopes">${scopeBoxes()}</div>
    <label class="row" style="gap:6px;align-items:center;margin-top:8px">
      <input type="checkbox" id="kPii" />
      <span>Allow full mobile numbers and email addresses (otherwise they are partly hidden)</span>
    </label>
    <div class="row" style="margin-top:12px"><button class="btn" id="kCreate">Create key</button></div>`;

  document.getElementById("kCreate").onclick = async () => {
    const scopes = [...host.querySelectorAll("#kScopes input:checked")].map((i) => i.value);
    try {
      const out = await api("/api/api-keys", {
        method: "POST",
        body: {
          name: document.getElementById("kName").value,
          scopes,
          allow_pii: document.getElementById("kPii").checked,
          rate_limit_per_min: Number(document.getElementById("kLimit").value),
          expires_at: document.getElementById("kExpiry").value || null,
          allowed_ips: document.getElementById("kIps").value,
        },
      });
      showSecret(out.key);
      await renderKeys(body.closest("#apiBody") || body);
    } catch (e) {
      toast(e.message, true);
    }
  };
}

/** The plain key exists only in this moment — make copying it easy. */
function showSecret(key) {
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `
    <div class="panel modal-card" style="max-width:560px">
      <h3 style="margin:0 0 6px">Copy your key now</h3>
      <p class="muted">This is the only time it can be seen. If it is lost, regenerate the key to get a new one.</p>
      <code style="display:block;padding:12px;border:1px solid var(--line);border-radius:10px;
        background:var(--panel-2);word-break:break-all">${esc(key)}</code>
      <div class="row" style="margin-top:14px;gap:8px">
        <button class="btn" id="copyKey">Copy</button>
        <button class="btn ghost" id="closeKey">Done</button>
      </div>
    </div>`;
  document.body.appendChild(back);
  back.querySelector("#copyKey").onclick = async () => {
    try { await navigator.clipboard.writeText(key); toast("Key copied"); } catch { toast("Select the key and copy it", true); }
  };
  back.querySelector("#closeKey").onclick = () => back.remove();
}

function paintList(host, keys, body) {
  if (!keys.length) {
    host.innerHTML = `<p class="muted">No keys yet. Create one above to let another application use these APIs.</p>`;
    return;
  }
  host.innerHTML = `
    <table class="tbl">
      <thead><tr>
        <th>Name</th><th>Key</th><th>Permissions</th><th>Limit</th><th>Calls</th><th>Last used</th><th>Status</th><th></th>
      </tr></thead>
      <tbody>${keys.map((k) => `
        <tr>
          <td>${esc(k.name)}<div class="muted" style="font-size:12px">Created ${fmtDate(k.created_at)}${k.expires_at ? ` · expires ${esc(k.expires_at)}` : ""}</div></td>
          <td><code>${esc(k.key_prefix)}_…</code></td>
          <td style="max-width:260px">${k.scopes.map((s) => pill(s)).join(" ") || pill("none")}${k.allow_pii ? " " + pill("full contact details") : ""}</td>
          <td>${k.rate_limit_per_min}/min</td>
          <td>${k.request_count}</td>
          <td>${k.last_used_at ? fmtDate(k.last_used_at) : "—"}</td>
          <td>${pill(k.status, STATUS_STYLE[k.status] || "")}</td>
          <td class="row" style="gap:6px;justify-content:flex-end">
            <button class="btn ghost" data-edit="${k.id}">Edit</button>
            <button class="btn ghost" data-regen="${k.id}">Regenerate</button>
            ${k.status === "Active" ? `<button class="btn ghost" data-revoke="${k.id}">Revoke</button>` : `<button class="btn ghost" data-del="${k.id}">Delete</button>`}
          </td>
        </tr>`).join("")}
      </tbody>
    </table>`;

  const refresh = () => renderKeys(body.closest("#apiBody") || body);

  for (const btn of host.querySelectorAll("[data-revoke]")) {
    btn.onclick = async () => {
      if (!confirm("Revoke this key? Any application using it stops working immediately.")) return;
      try { await api(`/api/api-keys/${btn.dataset.revoke}/revoke`, { method: "POST" }); toast("Key revoked"); await refresh(); }
      catch (e) { toast(e.message, true); }
    };
  }
  for (const btn of host.querySelectorAll("[data-regen]")) {
    btn.onclick = async () => {
      if (!confirm("Create a new secret for this key? The current one stops working.")) return;
      try {
        const out = await api(`/api/api-keys/${btn.dataset.regen}/regenerate`, { method: "POST" });
        showSecret(out.key);
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  }
  for (const btn of host.querySelectorAll("[data-del]")) {
    btn.onclick = async () => {
      if (!confirm("Delete this revoked key from the list?")) return;
      try { await api(`/api/api-keys/${btn.dataset.del}`, { method: "DELETE" }); await refresh(); }
      catch (e) { toast(e.message, true); }
    };
  }
  for (const btn of host.querySelectorAll("[data-edit]")) {
    btn.onclick = () => editKey(keys.find((k) => k.id === btn.dataset.edit), refresh);
  }
}

function editKey(key, refresh) {
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `
    <div class="panel modal-card" style="max-width:560px">
      <h3 style="margin:0 0 10px">Edit “${esc(key.name)}”</h3>
      <label>Key name<input id="eName" value="${esc(key.name)}" maxlength="120" /></label>
      <div class="row" style="gap:12px;margin-top:8px">
        <label>Requests per minute<input id="eLimit" type="number" min="1" max="6000" value="${key.rate_limit_per_min}" /></label>
        <label>Expires on<input id="eExpiry" type="date" value="${esc(key.expires_at || "")}" /></label>
      </div>
      <label style="display:block;margin-top:8px">Allowed IP addresses<input id="eIps" value="${esc(key.allowed_ips)}" placeholder="Leave empty to allow any" /></label>
      <div class="row" style="gap:16px;flex-wrap:wrap;margin-top:10px" id="eScopes">${scopeBoxes(key.scopes)}</div>
      <label class="row" style="gap:6px;align-items:center;margin-top:8px">
        <input type="checkbox" id="ePii" ${key.allow_pii ? "checked" : ""} />
        <span>Allow full mobile numbers and email addresses</span>
      </label>
      <div class="row" style="margin-top:14px;gap:8px">
        <button class="btn" id="eSave">Save</button>
        <button class="btn ghost" id="eCancel">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(back);
  back.querySelector("#eCancel").onclick = () => back.remove();
  back.querySelector("#eSave").onclick = async () => {
    try {
      await api(`/api/api-keys/${key.id}`, {
        method: "PATCH",
        body: {
          name: back.querySelector("#eName").value,
          scopes: [...back.querySelectorAll("#eScopes input:checked")].map((i) => i.value),
          allow_pii: back.querySelector("#ePii").checked,
          rate_limit_per_min: Number(back.querySelector("#eLimit").value),
          expires_at: back.querySelector("#eExpiry").value || null,
          allowed_ips: back.querySelector("#eIps").value,
        },
      });
      back.remove();
      toast("Key updated");
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
}

/* ------------------------------- logs tab -------------------------------- */

async function renderLogs(body) {
  const { keys } = await api("/api/api-keys");
  body.innerHTML = `
    <div class="panel">
      <div class="row" style="gap:12px;flex-wrap:wrap;align-items:flex-end">
        <label>Key<select id="lKey"><option value="">All keys</option>
          ${keys.map((k) => `<option value="${k.id}">${esc(k.name)} (${esc(k.key_prefix)})</option>`).join("")}
        </select></label>
        <label>From<input id="lFrom" type="date" /></label>
        <label>To<input id="lTo" type="date" /></label>
        <label class="row" style="gap:6px;align-items:center"><input type="checkbox" id="lFail" /><span>Only failed calls</span></label>
        <button class="btn" id="lGo">Show</button>
      </div>
    </div>
    <div class="panel" style="margin-top:16px" id="logTable"><p class="muted">Loading…</p></div>`;

  const table = document.getElementById("logTable");
  const load = async () => {
    const params = new URLSearchParams();
    const keyId = document.getElementById("lKey").value;
    if (keyId) params.set("api_key_id", keyId);
    for (const [id, name] of [["lFrom", "from"], ["lTo", "to"]]) {
      const v = document.getElementById(id).value;
      if (v) params.set(name, v);
    }
    if (document.getElementById("lFail").checked) params.set("failed_only", "1");
    table.innerHTML = `<p class="muted">Loading…</p>`;
    try {
      const { logs } = await api(`/api/api-keys/logs?${params}`);
      table.innerHTML = logs.length
        ? `<table class="tbl"><thead><tr><th>When</th><th>Key</th><th>Method</th><th>Path</th><th>Result</th><th>Time</th><th>From</th></tr></thead>
           <tbody>${logs.map((l) => `<tr>
             <td>${fmtDate(l.created_at)}</td>
             <td><code>${esc(l.key_prefix || "—")}</code></td>
             <td>${esc(l.method)}</td>
             <td style="max-width:280px;word-break:break-all">${esc(l.path)}</td>
             <td>${pill(l.status_code, l.status_code >= 400 ? STATUS_STYLE.Revoked : STATUS_STYLE.Active)}${l.error ? `<div class="muted" style="font-size:12px">${esc(l.error)}</div>` : ""}</td>
             <td>${l.duration_ms} ms</td>
             <td>${esc(l.ip || "—")}</td></tr>`).join("")}</tbody></table>`
        : `<p class="muted">No API calls recorded for this filter.</p>`;
    } catch (e) {
      table.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    }
  };
  document.getElementById("lGo").onclick = load;
  await load();
}

/* ------------------------------- docs tab -------------------------------- */

const block = (title, content) =>
  `<div style="margin-top:10px"><div class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:.05em">${title}</div>
   <pre style="margin:4px 0 0;padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--panel-2);
     overflow:auto;font-size:13px">${esc(content)}</pre></div>`;

async function renderDocs(body) {
  const doc = await api("/api/api-keys/docs");
  const origin = location.origin;

  body.innerHTML = `
    <div class="panel">
      <h3 style="margin:0 0 6px">Build your own application on these APIs</h3>
      <p class="muted">Every endpoint below lives under <code>${esc(origin)}/api/v1</code>. Your application never talks to the database directly — it uses these endpoints with an API key created in the first tab.</p>
      <p><strong>Authentication.</strong> ${esc(doc.authentication.replace(/`/g, ""))}</p>
      <div class="row" style="gap:8px;flex-wrap:wrap">${doc.scopes.map((s) => pill(`${s.key} — ${s.label}`)).join(" ")}</div>
      ${block("Error responses", doc.errors.map((e) => `${e.code}  ${e.meaning}`).join("\n"))}
    </div>

    ${doc.endpoints.map((e) => `
      <div class="panel" style="margin-top:14px">
        <div class="row" style="gap:10px;align-items:center;flex-wrap:wrap">
          ${pill(e.method)}
          <code style="font-size:14px">${esc(e.path)}</code>
          ${pill(e.scope ? `needs ${e.scope}` : "any active key")}
        </div>
        <p style="margin:8px 0 0">${esc(e.summary)}</p>
        ${e.params?.length
          ? `<div style="margin-top:10px"><table class="tbl"><thead><tr><th>Parameter</th><th>In</th><th>Required</th><th>Description</th></tr></thead>
             <tbody>${e.params.map((p) => `<tr><td><code>${esc(p.name)}</code></td><td>${esc(p.in || "query")}</td>
               <td>${p.required ? "Yes" : "No"}</td><td>${esc(p.description || "")}</td></tr>`).join("")}</tbody></table></div>`
          : ""}
        ${e.request ? block("Request body", JSON.stringify(e.request, null, 2)) : ""}
        ${e.response ? block("Response", JSON.stringify(e.response, null, 2)) : ""}
        ${e.example_curl ? block("Example request", e.example_curl.replace("https://your-server", origin)) : ""}
      </div>`).join("")}`;
}
