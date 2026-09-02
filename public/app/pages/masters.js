const KINDS = [
  {
    key: "courses",
    title: "Courses",
    hint: "Programmes such as B.Tech or M.A.",
    placeholder: "Add course",
    icon: `<path d="M12 3 2 8l10 5 10-5-10-5Z"/><path d="M6 11v5c0 1.1 2.7 2 6 2s6-.9 6-2v-5"/>`,
  },
  {
    key: "departments",
    title: "Departments",
    hint: "Academic departments members belong to.",
    placeholder: "Add department",
    icon: `<path d="M3 21h18"/><path d="M5 21V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v16"/><path d="M14 9h4a1 1 0 0 1 1 1v11"/><path d="M8 8h3M8 12h3M8 16h3"/>`,
  },
  {
    key: "years",
    title: "Academic years",
    hint: "Session labels like 2024-25.",
    placeholder: "Add academic year",
    icon: `<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/>`,
  },
];

const arr = (v) => (Array.isArray(v) ? v : []);

export async function renderMasters(view, { api, esc, toast }) {
  let data = (await api("/api/masters")) || {};

  view.innerHTML = `
    <div class="panel-head">
      <h3 style="margin:0">Master data</h3>
      <p class="muted">These lists power the member form, the bulk import matcher and every report filter.
        Every entry has a unique 1–2 character code (letters or digits, e.g. 01, BT, CS) — type that code in the bulk upload sheet
        and the system maps the row to this entry automatically.</p>
    </div>
    <div class="grid cols-2" style="margin-top:1rem">
      ${KINDS.map((k) => `
        <div class="panel master-card">
          <div class="master-head">
            <span class="master-title">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
                stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${k.icon}</svg>
              ${esc(k.title)}
            </span>
            <span class="muted" id="count_${k.key}">0</span>
          </div>
          <p class="muted">${esc(k.hint)}</p>
<div class="row master-add">
            <input id="code_${k.key}" placeholder="Code" maxlength="2" style="width:5rem;text-transform:uppercase" />
            <input id="new_${k.key}" placeholder="${esc(k.placeholder)}" style="flex:1" />
            <button data-add="${k.key}" title="Add" aria-label="Add ${esc(k.title)}">+</button>
          </div>
          <p class="muted" style="font-size:.8rem">Letters and digits allowed (1–2 chars). Leave blank to auto-assign the next free code.</p>
          <div id="list_${k.key}" class="master-list"></div>
        </div>`).join("")}
    </div>`;

  const paint = () => {
    for (const k of KINDS) {
      const items = arr(data[k.key]);
      view.querySelector(`#count_${k.key}`).textContent = String(items.length);
      view.querySelector(`#list_${k.key}`).innerHTML = items.length
        ? `<table><thead><tr><th style="width:5rem">Code</th><th>Name</th><th style="width:2rem"></th></tr></thead>
           <tbody>${items.map((i) => `<tr>
              <td><input data-code="${k.key}:${esc(i.id)}" value="${esc(i.code || "")}"
                   maxlength="2" style="width:4rem;text-transform:uppercase" /></td>
             <td><input data-name="${k.key}:${esc(i.id)}" value="${esc(i.name)}" style="width:100%" /></td>
             <td><a data-del="${k.key}:${esc(i.id)}" style="cursor:pointer" title="Remove">&times;</a></td>
           </tr>`).join("")}</tbody></table>`
        : `<span class="muted">Nothing yet.</span>`;
    }
  };
  paint();

  const refresh = async () => {
    data = (await api("/api/masters")) || {};
    paint();
  };

  view.onclick = async (e) => {
    const add = e.target.closest("[data-add]")?.dataset.add;
    const del = e.target.dataset.del;
    try {
      if (add) {
        const input = view.querySelector(`#new_${add}`);
        const codeInput = view.querySelector(`#code_${add}`);
        if (!input.value.trim()) return;
        await api(`/api/masters/${add}`, {
          method: "POST",
          body: { name: input.value.trim(), code: codeInput.value.trim() },
        });
        input.value = "";
        codeInput.value = "";
      } else if (del) {
        const [kind, id] = del.split(":");
        await api(`/api/masters/${kind}/${id}`, { method: "DELETE" });
      } else return;
      await refresh();
      toast("Master data updated");
    } catch (err) {
      toast(err.message, true);
    }
  };

  // Editing a code or a name in the table saves as soon as the field loses focus.
  view.addEventListener("change", async (e) => {
    const key = e.target.dataset.code || e.target.dataset.name;
    if (!key) return;
    const [kind, id] = key.split(":");
    const row = e.target.closest("tr");
    const code = row.querySelector("[data-code]").value.trim();
    const name = row.querySelector("[data-name]").value.trim();
    try {
      await api(`/api/masters/${kind}/${id}`, { method: "PUT", body: { name, code } });
      await refresh();
      toast("Master data updated");
    } catch (err) {
      toast(err.message, true);
      await refresh();
    }
  });

  view.onkeydown = (e) => {
    if (e.key !== "Enter") return;
    const id = e.target.id || "";
    if (!id.startsWith("new_") && !id.startsWith("code_")) return;
    view.querySelector(`[data-add="${id.slice(id.indexOf("_") + 1)}"]`)?.click();
  };
}

