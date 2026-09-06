/**
 * My account → two-step sign-in.
 *
 * Three optional methods, each switched on separately by the admin/owner:
 *   • Authenticator app (Google Authenticator, Authy, Microsoft Authenticator…)
 *   • Face authentication (camera check against an enrolled face)
 *   • Emailed one-time code
 * Any enabled method can be used at sign-in, so losing one never locks anyone out.
 */
import { describeFace } from "/app/face-engine.js";
import { attachFaceScan } from "/app/face-scan-fx.js";


export async function securityPanel(host, { api, esc, toast }) {
  const box = document.createElement("div");
  box.className = "panel";
  host.appendChild(box);

  let stream = null;
  const stopCam = () => { if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } };

  async function draw() {
    stopCam();
    let st = { methods: {}, email: "", emailReady: false };
    try { st = await api("/api/auth/2fa"); } catch (e) { toast(e.message, true); }
    const m = st.methods || {};
    const badge = (on) => `<span class="badge ${on ? "ok" : ""}">${on ? "Enabled" : "Not enabled"}</span>`;

    box.innerHTML = `
      <h3>Two-step sign-in</h3>
      <p class="muted">Extra security for <strong>${esc(st.email || "")}</strong>.
        Turn on one or more of the methods below — at sign-in you can use any of them.</p>

      <div class="panel" style="margin-top:.8rem">
        <h4 style="margin:0 0 .3rem">1 · Authenticator app</h4>
        <p class="muted" style="margin:0">A 6-digit code from Google Authenticator or a similar app.</p>
        <p style="margin:.6rem 0">${badge(m.totp)}</p>
        ${m.totp ? `
          <label for="tf_pw">Confirm your password to turn it off</label>
          <input id="tf_pw" type="password" autocomplete="current-password" style="max-width:320px" />
          <div class="row" style="margin-top:.6rem"><button class="ghost" id="tf_off">Turn off</button></div>
        ` : `
          <div class="row"><button id="tf_start">Set up with Authenticator app</button></div>
          <div id="tf_setup" hidden style="margin-top:.9rem">
            <p class="muted">1. Scan this QR code in your app (or type the key).
              2. Enter the 6-digit code it shows to finish.</p>
            <div class="row" style="align-items:flex-start;gap:1rem;flex-wrap:wrap">
              <img id="tf_qr" alt="Authenticator QR code" width="180" height="180"
                   style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:6px" />
              <div>
                <p class="muted" style="margin:0 0 .3rem">Setup key</p>
                <code id="tf_key" style="word-break:break-all"></code>
                <div style="margin-top:.7rem">
                  <label for="tf_code">6-digit code</label>
                  <input id="tf_code" inputmode="numeric" maxlength="8" style="max-width:180px" />
                </div>
                <div class="row" style="margin-top:.6rem"><button id="tf_on">Verify &amp; enable</button></div>
              </div>
            </div>
          </div>
        `}
      </div>

      <div class="panel" style="margin-top:.8rem">
        <h4 style="margin:0 0 .3rem">2 · Face authentication</h4>
        <p class="muted" style="margin:0">Look at the camera after your password. Your face is stored as a
          set of numbers (not a photo) and is checked on the server.</p>
        <p style="margin:.6rem 0">${badge(m.face)}</p>
        ${m.face ? `
          <div class="row" style="gap:.6rem;flex-wrap:wrap">
            <button class="ghost" id="fc_start">Re-capture my face</button>
          </div>
          <label for="fc_pw" style="margin-top:.6rem">Confirm your password to turn it off</label>
          <input id="fc_pw" type="password" autocomplete="current-password" style="max-width:320px" />
          <div class="row" style="margin-top:.6rem"><button class="ghost" id="fc_off">Turn off</button></div>
        ` : `<div class="row"><button id="fc_start">Set up face sign-in</button></div>`}
        <div id="fc_box" hidden style="margin-top:.9rem">
          <div id="fc_stage" style="position:relative;width:280px;max-width:100%;aspect-ratio:4/3;border-radius:12px;overflow:hidden;background:#000">
            <video id="fc_video" autoplay muted playsinline
                   style="width:100%;height:100%;object-fit:cover;display:block"></video>
          </div>
          <div class="row" style="margin-top:.6rem;gap:.6rem">
            <button id="fc_capture">Capture &amp; save face</button>
            <button class="ghost" id="fc_cancel">Cancel</button>
          </div>
          <p class="muted" id="fc_msg" style="margin:.5rem 0 0"></p>
        </div>

      </div>

      <div class="panel" style="margin-top:.8rem">
        <h4 style="margin:0 0 .3rem">3 · Emailed one-time code</h4>
        <p class="muted" style="margin:0">A 6-digit code sent to your email address at sign-in.
          ${st.emailReady ? "" : "<strong>Email is not configured yet — ask the platform owner.</strong>"}</p>
        <p style="margin:.6rem 0">${badge(m.email)}</p>
        ${m.email ? `
          <label for="em_pw">Confirm your password to turn it off</label>
          <input id="em_pw" type="password" autocomplete="current-password" style="max-width:320px" />
          <div class="row" style="margin-top:.6rem"><button class="ghost" id="em_off">Turn off</button></div>
        ` : `<div class="row"><button id="em_on" ${st.emailReady ? "" : "disabled"}>Turn on email codes</button></div>`}
      </div>`;

    const $ = (sel) => box.querySelector(sel);

    // ---- Authenticator app ----
    if (m.totp) {
      $("#tf_off").onclick = async () => {
        try {
          await api("/api/auth/2fa/disable", { method: "POST", body: { password: $("#tf_pw").value } });
          toast("Authenticator app turned off");
          draw();
        } catch (e) { toast(e.message, true); }
      };
    } else {
      $("#tf_start").onclick = async () => {
        try {
          const out = await api("/api/auth/2fa/setup", { method: "POST", body: {} });
          $("#tf_setup").hidden = false;
          $("#tf_qr").src = out.qr;
          $("#tf_key").textContent = out.secret;
        } catch (e) { toast(e.message, true); }
      };
      $("#tf_on").onclick = async () => {
        try {
          await api("/api/auth/2fa/enable", { method: "POST", body: { code: $("#tf_code").value } });
          toast("Authenticator app enabled");
          draw();
        } catch (e) { toast(e.message, true); }
      };
    }

    // ---- Face authentication ----
    let fx = null;
    const overlay = async () => {
      if (!fx) fx = attachFaceScan($("#fc_stage"), { compact: true });
      return fx;
    };
    $("#fc_start").onclick = async () => {
      $("#fc_box").hidden = false;
      $("#fc_msg").textContent = "Starting the camera…";
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        $("#fc_video").srcObject = stream;
        $("#fc_msg").textContent = "Face the camera, then press Capture.";
        (await overlay()).scanning("Scanning face…");
      } catch {
        $("#fc_msg").textContent = "The camera could not be opened — allow camera access and try again.";
      }
    };
    $("#fc_cancel").onclick = () => { stopCam(); fx?.idle(); $("#fc_box").hidden = true; };
    $("#fc_capture").onclick = async () => {
      $("#fc_msg").textContent = "Reading your face…";
      const o = await overlay();
      o.scanning("Scanning face…");
      try {
        const found = await describeFace($("#fc_video"));
        if (!found) {
          o.fail("No face detected — move closer");
          $("#fc_msg").textContent = "No clear face detected — move closer and try again.";
          return;
        }
        o.detected("Face detected");
        o.verifying("Saving your face…");
        await api("/api/auth/2fa/face/enable", { method: "POST", body: { descriptor: found.descriptor } });
        o.success("Face saved ✓");
        toast("Face sign-in saved");
        setTimeout(draw, 900);
      } catch (e) { o.fail("Could not save — try again"); $("#fc_msg").textContent = e.message; }
    };

    if (m.face) {
      $("#fc_off").onclick = async () => {
        try {
          await api("/api/auth/2fa/face/disable", { method: "POST", body: { password: $("#fc_pw").value } });
          toast("Face sign-in turned off");
          draw();
        } catch (e) { toast(e.message, true); }
      };
    }

    // ---- Emailed code ----
    if (m.email) {
      $("#em_off").onclick = async () => {
        try {
          await api("/api/auth/2fa/email", { method: "POST", body: { enabled: false, password: $("#em_pw").value } });
          toast("Email codes turned off");
          draw();
        } catch (e) { toast(e.message, true); }
      };
    } else {
      $("#em_on").onclick = async () => {
        try {
          await api("/api/auth/2fa/email", { method: "POST", body: { enabled: true } });
          toast("Email codes enabled");
          draw();
        } catch (e) { toast(e.message, true); }
      };
    }
  }

  await draw();
}
