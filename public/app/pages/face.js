/**
 * Face ID — enrol one member at a time by membership number.
 *
 * All face maths runs in this browser (face-api.js). Only the resulting
 * 128-number descriptor is stored; face images never leave the page.
 */
import * as fr from "/app/face-engine.js";

let current = null;
let camStream = null;

export async function renderFace(view, { api, esc, toast }) {
  const settings = await api("/api/settings/kiosk");

view.innerHTML = `
    <div class="grid cols-3" style="margin-bottom:.9rem">
      <div class="panel stat"><p class="muted">Active members with Face ID</p><div class="v" id="statFaceActive">…</div></div>
      <div class="panel stat"><p class="muted">Total face registrations</p><div class="v" id="statFaceTotal">…</div></div>
      <div class="panel stat"><p class="muted">Active members</p><div class="v" id="statMembers">…</div></div>
    </div>

    <div class="panel">
      <h3>Face recognition</h3>
      <p class="muted">Enter the membership number, press <strong>Enter</strong> to load the member, then enrol
        the face from their library photo or from a live camera capture.</p>
      <div class="row" style="flex-wrap:wrap;gap:.6rem;align-items:end">
        <label class="toggle-item"><input type="checkbox" id="allowFace" ${settings.allow_face ? "checked" : ""} />
          <span>Allow face scan at the kiosk</span></label>
        <div class="field"><label for="thr">Match strictness (distance 0.40–0.70)</label>
          <input id="thr" type="number" step="0.01" min="0.3" max="0.8" value="${esc(settings.face_threshold ?? 0.55)}" /></div>
        <button id="saveFaceSettings">Save</button>
      </div>
      <p class="muted" style="margin:.4rem 0 0">Lower value = stricter matching (fewer wrong matches, more retries).
        0.55 works well for most libraries.</p>
    </div>

    <div class="panel">
      <h3>Find member</h3>
      <div class="row" style="gap:.5rem;flex-wrap:wrap;align-items:end">
        <div class="field" style="min-width:240px">
          <label for="code">Membership number</label>
          <input id="code" placeholder="Enter membership number and press Enter" autocomplete="off" />
        </div>
<button id="find">Enter</button>
      </div>
      <div id="card" style="margin-top:.9rem"></div>
      <p class="muted" id="progress" style="margin:.6rem 0 0"></p>
    </div>

    <div class="panel" id="camPanel" style="display:none">
      <h3>Live photo</h3>
      <p class="muted">Ask the member to look straight at the camera, then capture.</p>
      <div class="row" style="gap:.6rem;flex-wrap:wrap">
        <button class="ghost" id="camStart">Allow camera</button>
        <button id="camCapture" disabled>Capture &amp; enrol</button>
        <button class="ghost" id="camStop" disabled>Stop camera</button>
      </div>
      <video id="camVideo" playsinline muted style="margin-top:.7rem;max-width:340px;width:100%;border-radius:10px;background:#000"></video>
      <p class="muted" id="camHint"></p>
    </div>`;

  const el = (id) => view.querySelector(`#${id}`);
  const setProgress = (t) => { el("progress").textContent = t; };
const camHint = (t) => { el("camHint").textContent = t; };

  /** Refresh the Face ID summary box from the server. */
  async function loadStats() {
    try {
      const s = await api("/api/faces/stats");
      el("statFaceActive").textContent = s.face_active ?? 0;
      el("statFaceTotal").textContent = s.face_total ?? 0;
      el("statMembers").textContent = s.active_members ?? 0;
    } catch { /* leave the placeholders on failure */ }
  }

  function paint() {
    if (!current) { el("card").innerHTML = ""; el("camPanel").style.display = "none"; return; }
    const m = current;
    const status = m.face_id
      ? `Face enrolled · ${m.face_source === "camera" ? "live photo" : "photo"}`
      : "No face enrolled yet";
    el("card").innerHTML = `
      <div class="row" style="gap:.9rem;align-items:center;flex-wrap:wrap">
        ${m.photo_url
          ? `<img src="${esc(m.photo_url)}" alt="" style="height:72px;width:72px;border-radius:50%;object-fit:cover" />`
          : `<div class="muted" style="height:72px;width:72px;border-radius:50%;display:grid;place-items:center;border:1px dashed var(--line,#ccc)">No photo</div>`}
        <div>
          <div style="font-size:1.1rem;font-weight:600">${esc(m.full_name)}</div>
          <div class="muted">${esc(m.member_code)} · ${esc(m.status || "")}</div>
          <div class="muted">${esc(status)}</div>
        </div>
      </div>
      <div class="row" style="gap:.5rem;margin-top:.8rem;flex-wrap:wrap">
        <button id="enrolPhoto" ${m.photo_url ? "" : "disabled"}>Enrol from photo</button>
        <button class="ghost" id="useCam">Enrol by live photo</button>
        ${m.face_id ? `<button class="ghost" id="removeFace">Remove face</button>` : ""}
      </div>`;

    el("enrolPhoto").onclick = async () => {
      setProgress(`Reading ${m.full_name}'s photo…`);
      try {
        const img = await fr.loadImage(m.photo_url);
        const found = await fr.describeFace(img, settings.face_model_url);
        if (!found) throw new Error("No face detected in the photo");
        await save(found, "photo");
        toast("Face enrolled");
      } catch (err) { toast(err.message || "Could not enrol this photo", true); }
      setProgress("");
    };
    el("useCam").onclick = () => {
      el("camPanel").style.display = "";
      el("camPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    };
if (el("removeFace")) el("removeFace").onclick = async () => {
      await api(`/api/faces/${m.id}`, { method: "DELETE" });
      toast("Face removed");
      loadStats();
      await find(m.member_code);
    };
  }

async function save(found, source) {
    await api(`/api/faces/${current.id}`, {
      method: "PUT",
      body: { descriptor: found.descriptor, source, quality: found.score },
    });
    loadStats();
    await find(current.member_code);
  }

  async function find(code) {
    const value = String(code || "").trim();
    if (!value) return;
    setProgress("Looking up member…");
    const rows = (await api(`/api/faces?search=${encodeURIComponent(value)}`)) || [];
    const exact = rows.find((r) => String(r.member_code).toLowerCase() === value.toLowerCase());
    current = exact || null;
    setProgress(current ? "" : "No member found with that membership number.");
    paint();
  }

  el("find").onclick = () => find(el("code").value);
  el("code").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); find(el("code").value); } };

  el("saveFaceSettings").onclick = async () => {
    await api("/api/settings/kiosk", {
      method: "PUT",
      body: { allow_face: el("allowFace").checked ? 1 : 0, face_threshold: Number(el("thr").value) || 0.55 },
    });
    toast("Face settings saved");
  };

/* ---------- webcam enrolment ---------- */
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
    if (!current) return camHint("Load a member by membership number first.");
    camHint("Reading the face…");
    try {
      const found = await fr.describeFace(el("camVideo"), settings.face_model_url);
      if (!found) return camHint("No face detected — move closer to the camera.");
      await save(found, "camera");
      camHint("Face enrolled from the live photo.");
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

loadStats();
  el("code").focus();
}
