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
      <p class="muted">These lists power the member form, the bulk import matcher and every report filter.</p>
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
          <div id="list_${k.key}" class="row master-list"></div>
          <div class="row master-add">
            <input id="new_${k.key}" placeholder="${esc(k.placeholder)}" style="flex:1" />
            <button data-add="${k.key}" title="Add" aria-label="Add ${esc(k.title)}">+</button>
          </div>
        </div>`).join("")}
    </div>`;

  const paint = () => {
    for (const k of KINDS) {
      const items = arr(data[k.key]);
      view.querySelector(`#count_${k.key}`).textContent = String(items.length);
      view.querySelector(`#list_${k.key}`).innerHTML = items.length
        ? items.map((i) => `<span class="badge">${esc(i.name)}
            <a data-del="${k.key}:${esc(i.id)}" style="cursor:pointer">&times;</a></span>`).join(" ")
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
        if (!input.value.trim()) return;
        await api(`/api/masters/${add}`, { method: "POST", body: { name: input.value.trim() } });
        input.value = "";
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

  view.onkeydown = (e) => {
    if (e.key !== "Enter") return;
    const id = e.target.id || "";
    if (!id.startsWith("new_")) return;
    view.querySelector(`[data-add="${id.slice(4)}"]`)?.click();
  };
}
