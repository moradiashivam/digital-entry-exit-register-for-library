const money = (v) => `₹${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const arr = (v) => (Array.isArray(v) ? v : []);

export async function renderOwnerPlans(view, { api, esc, toast }) {
  const draw = async () => {
    const plans = arr(await api("/api/owner/plans"));
    view.innerHTML = `
      <div class="panel">
        <h3 style="margin-top:0">Create a plan</h3>
        <form id="new" class="row">
          <div><label for="p_name">Plan name</label><input id="p_name" required placeholder="Standard" /></div>
          <div><label for="p_price">Price (₹)</label><input id="p_price" type="number" min="0" step="0.01" value="0" /></div>
          <div><label for="p_cycle">Billing cycle</label><select id="p_cycle">
            <option>Monthly</option><option>Quarterly</option><option selected>Yearly</option></select></div>
          <div><label for="p_students">Max students</label><input id="p_students" type="number" min="0" value="0" /></div>
          <div><label for="p_staff">Max staff</label><input id="p_staff" type="number" min="0" value="0" /></div>
          <div><label for="p_storage">Storage (GB)</label><input id="p_storage" type="number" min="0" value="0" /></div>
          <div style="flex:2;min-width:220px"><label for="p_features">Features</label>
            <input id="p_features" style="width:100%" placeholder="Palm + RFID, reports, email support" /></div>
          <div><label>&nbsp;</label><button type="submit">Add plan</button></div>
        </form>
        <p class="muted">Zero means unlimited. Retired plans stay attached to existing universities.</p>
      </div>

      <div class="panel" style="margin-top:1rem">
        <h3 style="margin-top:0">Plans</h3>
        <div style="overflow:auto"><table>
          <thead><tr><th>Name</th><th>Price</th><th>Cycle</th><th>Students</th><th>Staff</th>
            <th>Storage</th><th>Features</th><th>In use</th><th>Status</th><th></th></tr></thead>
          <tbody>${plans.length ? plans.map((p) => `<tr data-id="${esc(p.id)}">
            <td><input data-f="name" value="${esc(p.name)}" style="width:9rem" /></td>
            <td><input data-f="price" type="number" step="0.01" value="${esc(p.price)}" style="width:6.5rem" /></td>
            <td><select data-f="billing_cycle">${["Monthly", "Quarterly", "Yearly"].map((c) =>
              `<option ${c === p.billing_cycle ? "selected" : ""}>${c}</option>`).join("")}</select></td>
            <td><input data-f="max_students" type="number" value="${esc(p.max_students)}" style="width:5.5rem" /></td>
            <td><input data-f="max_staff" type="number" value="${esc(p.max_staff)}" style="width:5rem" /></td>
            <td><input data-f="storage_limit_gb" type="number" value="${esc(p.storage_limit_gb)}" style="width:5rem" /></td>
            <td><input data-f="features" value="${esc(p.features || "")}" style="width:12rem" /></td>
            <td>${p.institutes}</td>
            <td><span class="badge ${p.is_active ? "ok" : "bad"}">${p.is_active ? "Active" : "Retired"}</span></td>
            <td class="row" style="gap:.3rem">
              <button class="ghost" data-save="${esc(p.id)}">Save</button>
              <button class="ghost" data-toggle="${esc(p.id)}">${p.is_active ? "Retire" : "Re-activate"}</button>
            </td></tr>`).join("")
            : `<tr><td colspan="10" class="muted">No plans yet — create your first one above.</td></tr>`}
          </tbody></table></div>
        <p class="muted" style="margin-top:.6rem">Total plan value in use:
          ${money(plans.reduce((s, p) => s + Number(p.price) * Number(p.institutes), 0))}</p>
      </div>`;

    view.querySelector("#new").onsubmit = async (e) => {
      e.preventDefault();
      const val = (id) => view.querySelector(id).value;
      try {
        await api("/api/owner/plans", {
          method: "POST",
          body: {
            name: val("#p_name"), price: Number(val("#p_price")), billing_cycle: val("#p_cycle"),
            max_students: Number(val("#p_students")), max_staff: Number(val("#p_staff")),
            storage_limit_gb: Number(val("#p_storage")), features: val("#p_features"),
          },
        });
        toast("Plan created");
        await draw();
      } catch (err) {
        toast(err.message, true);
      }
    };

    view.querySelector("table tbody").addEventListener("click", async (e) => {
      const saveId = e.target.dataset.save;
      const toggleId = e.target.dataset.toggle;
      if (!saveId && !toggleId) return;
      const row = e.target.closest("tr");
      try {
        if (saveId) {
          const body = {};
          for (const el of row.querySelectorAll("[data-f]")) {
            body[el.dataset.f] = el.type === "number" ? Number(el.value) : el.value;
          }
          await api(`/api/owner/plans/${saveId}`, { method: "PATCH", body });
          toast("Plan updated");
        } else {
          const active = row.querySelector(".badge").textContent === "Active";
          await api(`/api/owner/plans/${toggleId}`, { method: "PATCH", body: { is_active: !active } });
          toast(active ? "Plan retired" : "Plan re-activated");
        }
        await draw();
      } catch (err) {
        toast(err.message, true);
      }
    });
  };

  await draw();
}
