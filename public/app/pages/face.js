/**
 * Face ID — enrol member faces so the kiosk camera can recognise them.
 *
 * All face maths runs in this browser (face-api.js). Only the resulting
 * 128-number descriptor is stored; face images never leave the page.
 */
import * as fr from "/app/face-engine.js";

let rows = [];
let camStream = null;

const statusText = (m) =>
  m.face_id ? `Enrolled · ${m.face_source === "camera" ? "webcam" : "photo"}` : (m.photo_url ? "Photo ready" : "No photo");

export async function renderFace(view, { api, esc, toast }) {
  const settings = await api("/api/settings/kiosk");

  view.innerHTML = `
    <div class="panel">
      <h3>Face recognition</h3>
      <p class="muted">Enrol each member's face from their library photo (or a live webcam capture).
        At the kiosk, the <strong>Face scan</strong> tab then matches the person in front of the camera
        with the enrolled photo and records the entry or exit automatically.</p>
      <div class="row" style="flex-wrap:wrap;gap:.6rem;align-items:end">
        <label class="toggle-item"><input type="checkbox" id="allowFace" ${settings.allow_face ? "checked" : ""} />
          <span>Allow face scan at the kiosk</span></label>
        <div class="field"><label for="thr">Match strictness (distance ${"0.40"}–0.70)</label>
          <input id="thr" type="number" step="0.01" min="0.3" max="0.8" value="${esc(settings.face_threshold ?? 0.55)}" /></div>
        <button id="saveFaceSettings">Save</button>
      </div>
      <p class="muted" style="margin:.4rem 0 0">Lower value = stricter matching (fewer wrong matches, more retries).
        0.55 works well for most libraries.</p>
    </div>

    <div class="panel">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:.6rem">
        <div class="row" style="gap:.5rem">
          <input id="search" placeholder="Search name or member code" />
          <button class="ghost" id="reload">Refresh</button>
        </div>
        <div class="row" style="gap:.5rem">
          <button id="enrolAll">Enrol all photos</button>
          <button class="ghost" id="clearAll">Remove all faces</button>
        </div>
      </div>
      <p class="muted" id="progress" style="margin:.6rem 0 0"></p>
      <div class="table-wrap" style="margin-top:.8rem">
        <table class="table">
          <thead><tr><th>Member</th><th>Code</th><th>Photo</th><th>Face status</th><th></th></tr></thead>
          <tbody id="tbody"></tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <h3>Live webcam enrolment</h3>
      <p class="muted">Use this when a member has no usable photo. Pick the member, look at the camera and capture.</p>
      <div class="row" style="gap:.6rem;flex-wrap:wrap;align-items:end">
        <div class="field"><label for="camMember">Member</label><select id="camMember"></select></div>
        <button class="ghost" id="camStart">Allow camera</button>
        <button id="camCapture" disabled>Capture &amp; enrol</button>
        <button class="ghost" id="camStop" disabled>Stop camera</button>
      </div>
      <video id="camVideo" playsinline muted style="margin-top:.7rem;max-width:340px;width:100%;border-radius:10px;background:#000"></video>
      <p class="muted" id="camHint"></p>
    </div>`;

  const el = (id) => view.querySelector(`#${id}`);
  const setProgress = (t) => { el("progress").textContent = t; };

  async function load() {
    const search = el("search").value.trim();
    rows = (await api(`/api/faces?search=${encodeURIComponent(search)}`)) || [];
    el("tbody").innerHTML = rows.map((m) => `
      <tr>
        <td>${esc(m.full_name)}</td>
        <td>${esc(m.member_code)}</td>
        <td>${m.photo_url ? `<img src="${esc(m.photo_url)}" alt="" style="height:32px;width:32px;border-radius:50%;object-fit:cover" />` : `<span class="muted">—</span>`}</td>
        <td>${esc(statusText(m))}</td>
        <td class="row" style="gap:.4rem">
          <button class="ghost" data-enrol="${esc(m.id)}" ${m.photo_url ? "" : "disabled"}>Enrol from photo</button>
          ${m.face_id ? `<button class="ghost" data-remove="${esc(m.id)}">Remove</button>` : ""}
        </td>
      </tr>`).join("") || `<tr><td colspan="5" class="muted">No members found.</td></tr>`;
    el("camMember").innerHTML = rows
      .map((m) => `<option value="${esc(m.id)}">${esc(m.full_name)} · ${esc(m.member_code)}</option>`).join("");
  }

  async function enrolOne(member) {
    if (!member.photo_url) throw new Error("No photo");
    const img = await fr.loadImage(member.photo_url);
    const found = await fr.describeFace(img, settings.face_model_url);
    if (!found) throw new Error("No face detected in the photo");
    await api(`/api/faces/${member.id}`, {
      method: "PUT",
      body: { descriptor: found.descriptor, source: "photo", quality: found.score },
    });
  }

  el("saveFaceSettings").onclick = async () => {
    await api("/api/settings/kiosk", {
      method: "PUT",
      body: { allow_face: el("allowFace").checked ? 1 : 0, face_threshold: Number(el("thr").value) || 0.55 },
    });
    toast("Face settings saved");
  };

  el("reload").onclick = load;
  el("search").onkeydown = (e) => { if (e.key === "Enter") load(); };

  el("tbody").onclick = async (e) => {
    const enrol = e.target.dataset.enrol;
    const remove = e.target.dataset.remove;
    if (enrol) {
      const member = rows.find((m) => m.id === enrol);
      setProgress(`Reading ${member.full_name}'s photo…`);
      try {
        await enrolOne(member);
        toast("Face enrolled");
      } catch (err) { toast(err.message || "Could not enrol this photo", true); }
      setProgress("");
      await load();
    }
    if (remove) {
      await api(`/api/faces/${remove}`, { method: "DELETE" });
      toast("Face removed");
      await load();
    }
  };

  el("enrolAll").onclick = async () => {
    const todo = rows.filter((m) => m.photo_url && !m.face_id);
    if (!todo.length) return toast("Every member with a photo is already enrolled");
    let done = 0, failed = 0;
    setProgress("Loading the face model…");
    try { await fr.loadModels(settings.face_model_url); }
    catch { return setProgress("Face model could not be downloaded — check the internet connection."); }
    for (const m of todo) {
      try { await enrolOne(m); done += 1; } catch { failed += 1; }
      setProgress(`Enrolled ${done} of ${todo.length}${failed ? ` · ${failed} without a usable face` : ""}`);
    }
    await load();
  };

  el("clearAll").onclick = async () => {
    if (!confirm("Remove every enrolled face for this university?")) return;
    await api("/api/faces/clear", { method: "POST", body: {} });
    toast("All faces removed");
    await load();
  };

  /* ---------- webcam enrolment ---------- */
  const camHint = (t) => { el("camHint").textContent = t; };

  el("camStart").onclick = async () => {
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 } }, audio: false });
    } catch { return camHint("Camera permission was blocked."); }
    el("camVideo").srcObject = camStream;
    await el("camVideo").play().catch(() => {});
    el("camCapture").disabled = false;
    el("camStop").disabled = false;
    camHint("Camera ready — look straight ahead and press Capture.");
  };

  el("camCapture").onclick = async () => {
    const id = el("camMember").value;
    if (!id) return camHint("Pick a member first.");
    camHint("Reading the face…");
    try {
      const found = await fr.describeFace(el("camVideo"), settings.face_model_url);
      if (!found) return camHint("No face detected — move closer to the camera.");
      await api(`/api/faces/${id}`, {
        method: "PUT",
        body: { descriptor: found.descriptor, source: "camera", quality: found.score },
      });
      camHint("Face enrolled from the webcam.");
      await load();
    } catch (err) { camHint(err.message || "Could not enrol this face."); }
  };

  el("camStop").onclick = () => {
    camStream?.getTracks().forEach((t) => t.stop());
    camStream = null;
    el("camVideo").srcObject = null;
    el("camCapture").disabled = true;
    el("camStop").disabled = true;
    camHint("Camera stopped.");
  };

  await load();
}
