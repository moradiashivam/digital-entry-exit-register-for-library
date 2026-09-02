/**
 * Library Activities / Kiosk Display.
 * Central place where the librarian manages what each kiosk shows while it is
 * idle: services, activities, events, announcements, images and videos.
 */

const STATUS_ORDER = ["Active", "Scheduled", "Inactive", "Expired"];
const CATEGORIES = [
  "General", "Library service", "Activity", "Event", "Workshop", "Announcement",
  "New facility", "New books", "Digital resource", "Special occasion",
];

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result);
  fr.onerror = () => reject(new Error("Could not read the file"));
  fr.readAsDataURL(file);
});

const blank = () => ({
  id: null, title: "", body: "", category: "General", post_type: "regular",
  media_url: "", media_type: "none", media_data: "",
  start_date: "", end_date: "", start_time: "08:00", end_time: "23:00",
  is_active: 1, sort_order: 0, kiosks: [],
});

export async function renderKioskDisplay(view, { api, esc, toast }) {
  let data = { posts: [], devices: [], settings: {} };
  let draft = blank();

  const load = async () => { data = (await api("/api/display/posts")) || data; };
  await load();

  view.innerHTML = `
    <div class="panel-head kd-head">
      <h3 style="margin:0">Library activities &amp; kiosk display</h3>
      <p class="muted">When a kiosk is not being used, it can show your library services, activities,
        events, announcements, photographs and videos instead of an empty screen.
        Scanning is never blocked — the moment a student touches the screen or scans a card the normal kiosk returns.</p>
    </div>

    <div class="panel" style="margin-top:1rem">
      <h4 style="margin:0 0 .6rem">Idle screen</h4>
      <div class="row" style="flex-wrap:wrap;align-items:flex-end;gap:1rem">
        <label style="display:flex;align-items:center;gap:.4rem;font-weight:500">
          <input type="checkbox" id="dEnabled" /> Show library content when the kiosk is idle
        </label>
        <div><label for="dIdle">Start after (seconds of no activity)</label>
          <input id="dIdle" type="number" min="5" max="3600" style="width:130px" /></div>
        <div><label for="dSlide">Seconds per slide</label>
          <input id="dSlide" type="number" min="3" max="300" style="width:130px" /></div>
        <button id="dSave">Save idle settings</button>
      </div>
    </div>

    <div class="grid cols-2" style="margin-top:1rem;align-items:start">
      <div class="panel">
        <h4 id="formTitle" style="margin:0 0 .6rem">Add new post</h4>
        <div><label for="pTitle">Title</label><input id="pTitle" maxlength="180" placeholder="e.g. New arrivals this week" /></div>
        <div><label for="pBody">Content</label><textarea id="pBody" rows="3" placeholder="Short description shown under the title"></textarea></div>
        <div class="row" style="flex-wrap:wrap">
          <div><label for="pCategory">Type of content</label><select id="pCategory">
            ${CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}</select></div>
          <div><label for="pType">Post type</label><select id="pType">
            <option value="regular">Regular daily post</option>
            <option value="occasion">Occasion-wise post (scheduled)</option></select></div>
          <div><label for="pOrder">Display order</label><input id="pOrder" type="number" min="0" max="9999" value="0" style="width:110px" /></div>
        </div>

        <div id="schedule" hidden>
          <div class="row" style="flex-wrap:wrap">
            <div><label for="pStartDate">Start date</label><input id="pStartDate" type="date" /></div>
            <div><label for="pEndDate">End date</label><input id="pEndDate" type="date" /></div>
            <div><label for="pStartTime">Start time</label><input id="pStartTime" type="time" value="08:00" /></div>
            <div><label for="pEndTime">End time</label><input id="pEndTime" type="time" value="23:00" /></div>
          </div>
        </div>

        <div><label for="pMedia">Image or video</label><input id="pMedia" type="file" accept="image/*,video/*" /></div>
        <div id="mediaPreview" class="kd-preview"></div>

        <div style="margin-top:.6rem">
          <label>Show on</label>
          <label style="display:flex;align-items:center;gap:.4rem;font-weight:500">
            <input type="checkbox" id="pAllKiosks" checked /> All kiosks
          </label>
          <div id="kioskPick" class="kd-kiosks"></div>
        </div>

        <label style="display:flex;align-items:center;gap:.4rem;font-weight:500;margin-top:.6rem">
          <input type="checkbox" id="pActive" checked /> Active
        </label>

        <div class="row" style="margin-top:.8rem">
          <button id="pSave">Save post</button>
          <button class="ghost" id="pReset">Clear</button>
        </div>
      </div>

      <div class="panel">
        <div class="row" style="justify-content:space-between;align-items:center">
          <h4 style="margin:0">Posts</h4>
          <select id="statusFilter" style="width:auto">
            <option value="">All statuses</option>
            ${STATUS_ORDER.map((s) => `<option value="${s}">${s}</option>`).join("")}
          </select>
        </div>
        <div id="postList" class="kd-list"></div>
      </div>
    </div>`;

  const $ = (s) => view.querySelector(s);

  const paintKioskPick = () => {
    $("#kioskPick").innerHTML = data.devices.length
      ? data.devices.map((d) => `<label class="kd-kiosk">
          <input type="checkbox" data-kiosk="${esc(d.id)}" ${draft.kiosks.includes(d.id) ? "checked" : ""} />
          ${esc(d.name)}${d.location ? ` · ${esc(d.location)}` : ""}
        </label>`).join("")
      : `<p class="muted">No kiosks defined yet — add them under Master setting → Kiosks / terminals.</p>`;
    $("#kioskPick").hidden = $("#pAllKiosks").checked;
  };

  const paintMedia = () => {
    const url = draft.media_data || draft.media_url;
    $("#mediaPreview").innerHTML = !url ? "" :
      (draft.media_type === "video"
        ? `<video src="${esc(url)}" controls muted></video>`
        : `<img src="${esc(url)}" alt="Post media" />`) +
      `<button type="button" class="ghost" id="mediaClear">Remove media</button>`;
    const clear = $("#mediaClear");
    if (clear) clear.onclick = () => {
      draft.media_data = ""; draft.media_url = ""; draft.media_type = "none";
      draft.remove_media = true;
      $("#pMedia").value = "";
      paintMedia();
    };
  };

  const fillForm = () => {
    $("#formTitle").textContent = draft.id ? "Edit post" : "Add new post";
    $("#pTitle").value = draft.title || "";
    $("#pBody").value = draft.body || "";
    $("#pCategory").value = CATEGORIES.includes(draft.category) ? draft.category : "General";
    $("#pType").value = draft.post_type;
    $("#pOrder").value = draft.sort_order || 0;
    $("#pStartDate").value = (draft.start_date || "").slice(0, 10);
    $("#pEndDate").value = (draft.end_date || "").slice(0, 10);
    $("#pStartTime").value = (draft.start_time || "08:00").slice(0, 5);
    $("#pEndTime").value = (draft.end_time || "23:00").slice(0, 5);
    $("#pActive").checked = !!Number(draft.is_active);
    $("#pAllKiosks").checked = !draft.kiosks.length;
    $("#schedule").hidden = draft.post_type !== "occasion";
    paintKioskPick();
    paintMedia();
  };

  const badge = (status) => `<span class="kd-badge kd-${status.toLowerCase()}">${status}</span>`;

  const paintList = () => {
    const filter = $("#statusFilter").value;
    const rows = data.posts.filter((p) => !filter || p.status === filter);
    $("#postList").innerHTML = rows.length ? rows.map((p) => `
      <div class="kd-item">
        <div class="kd-thumb">${p.media_url
          ? (p.media_type === "video"
            ? `<video src="${esc(p.media_url)}" muted></video>`
            : `<img src="${esc(p.media_url)}" alt="" />`)
          : `<span>${esc((p.category || "?").slice(0, 1))}</span>`}</div>
        <div class="kd-body">
          <strong>${esc(p.title)}</strong> ${badge(p.status)}
          <p class="muted">${esc(p.category)} · ${p.post_type === "occasion" ? "Occasion" : "Regular"}
            ${p.post_type === "occasion" && p.start_date
              ? ` · ${esc(String(p.start_date).slice(0, 10))} → ${esc(String(p.end_date || "").slice(0, 10))}
                  ${esc((p.start_time || "").slice(0, 5))}–${esc((p.end_time || "").slice(0, 5))}` : ""}
            · ${p.kiosks.length ? esc(p.kiosks.map((k) => k.name).join(", ")) : "All kiosks"}</p>
        </div>
        <div class="kd-actions">
          <button class="ghost" data-edit="${esc(p.id)}">Edit</button>
          <button class="ghost" data-toggle="${esc(p.id)}">${Number(p.is_active) ? "Deactivate" : "Activate"}</button>
          <button class="ghost danger" data-del="${esc(p.id)}">Delete</button>
        </div>
      </div>`).join("")
      : `<p class="muted">No posts yet. Add your first library activity or service on the left.</p>`;

    for (const b of view.querySelectorAll("[data-edit]")) {
      b.onclick = () => {
        const post = data.posts.find((p) => p.id === b.dataset.edit);
        if (!post) return;
        draft = { ...blank(), ...post, media_data: "", kiosks: post.kiosks.map((k) => k.id) };
        fillForm();
        view.scrollIntoView({ behavior: "smooth", block: "start" });
      };
    }
    for (const b of view.querySelectorAll("[data-toggle]")) {
      b.onclick = async () => {
        const post = data.posts.find((p) => p.id === b.dataset.toggle);
        try {
          await api(`/api/display/posts/${post.id}/active`, { method: "PATCH", body: { is_active: !Number(post.is_active) } });
          await refresh();
        } catch (e) { toast(e.message, true); }
      };
    }
    for (const b of view.querySelectorAll("[data-del]")) {
      b.onclick = async () => {
        if (!confirm("Delete this post? It will stop showing on every kiosk.")) return;
        try {
          await api(`/api/display/posts/${b.dataset.del}`, { method: "DELETE" });
          toast("Post deleted");
          if (draft.id === b.dataset.del) { draft = blank(); fillForm(); }
          await refresh();
        } catch (e) { toast(e.message, true); }
      };
    }
  };

  const refresh = async () => { await load(); paintSettings(); paintList(); };

  function paintSettings() {
    const s = data.settings || {};
    $("#dEnabled").checked = Number(s.display_enabled) === 1;
    $("#dIdle").value = Number(s.display_idle_seconds) || 30;
    $("#dSlide").value = Number(s.display_slide_seconds) || 10;
  }

  $("#dSave").onclick = async () => {
    try {
      await api("/api/display/settings", {
        method: "PUT",
        body: {
          display_enabled: $("#dEnabled").checked,
          display_idle_seconds: Number($("#dIdle").value),
          display_slide_seconds: Number($("#dSlide").value),
        },
      });
      toast("Idle screen settings saved");
      await refresh();
    } catch (e) { toast(e.message, true); }
  };

  $("#pType").onchange = () => {
    draft.post_type = $("#pType").value;
    $("#schedule").hidden = draft.post_type !== "occasion";
  };
  $("#pAllKiosks").onchange = () => { $("#kioskPick").hidden = $("#pAllKiosks").checked; };
  $("#statusFilter").onchange = paintList;
  $("#pReset").onclick = () => { draft = blank(); fillForm(); };

  $("#pMedia").onchange = async () => {
    const file = $("#pMedia").files?.[0];
    if (!file) return;
    try {
      draft.media_data = await fileToDataUrl(file);
      draft.media_type = file.type.startsWith("video/") ? "video" : "image";
      draft.remove_media = false;
      paintMedia();
    } catch (e) { toast(e.message, true); }
  };

  $("#pSave").onclick = async () => {
    const body = {
      title: $("#pTitle").value.trim(),
      body: $("#pBody").value,
      category: $("#pCategory").value,
      post_type: $("#pType").value,
      sort_order: Number($("#pOrder").value) || 0,
      is_active: $("#pActive").checked,
      start_date: $("#pStartDate").value,
      end_date: $("#pEndDate").value,
      start_time: $("#pStartTime").value,
      end_time: $("#pEndTime").value,
      media_data: draft.media_data || "",
      remove_media: !!draft.remove_media,
      kiosk_ids: $("#pAllKiosks").checked
        ? []
        : [...view.querySelectorAll("#kioskPick input[data-kiosk]:checked")].map((i) => i.dataset.kiosk),
    };
    if (!body.title) return toast("Enter a title", true);
    try {
      if (draft.id) await api(`/api/display/posts/${draft.id}`, { method: "PUT", body });
      else await api("/api/display/posts", { method: "POST", body });
      toast(draft.id ? "Post updated" : "Post added");
      draft = blank();
      fillForm();
      await refresh();
    } catch (e) { toast(e.message, true); }
  };

  paintSettings();
  fillForm();
  paintList();
}
