import { esc } from "/app/api.js";
import { templateCss } from "/app/kiosk-templates.js";

const slug = location.pathname.split("/").filter(Boolean)[1] || "";
// ?device=main-gate pins this screen to a named kiosk and remembers it on this computer.
const askedDevice = new URLSearchParams(location.search).get("device");
if (askedDevice) localStorage.setItem(`ler_device_${slug}`, askedDevice);
let deviceId = askedDevice
  || localStorage.getItem(`ler_device_${slug}`)
  || localStorage.getItem("ler_device")
  || "kiosk-1";

const el = (id) => document.getElementById(id);

let settings = {};
let method = "Manual";
let resetTimer = null;

function applyTemplate(id) {
  const style = document.getElementById("kioskTemplateCss");
  document.body.dataset.template = id || "classic";
  if (style) style.textContent = templateCss(id);
}

function applyCustomCss(css) {
  let style = document.getElementById("kioskCustomCss");
  if (!style) {
    style = document.createElement("style");
    style.id = "kioskCustomCss";
    document.head.appendChild(style);
  }
  // Accept plain CSS as well as CSS copied with an outer <style> wrapper.
  // Removing every wrapper also repairs values saved by older editor versions.
  style.textContent = String(css || "")
    .replace(/^\uFEFF/, "")
    .replace(/<\/?style(?:\s[^>]*)?>/gi, "")
    .trim();
}

const startClock = () => {
  const tick = () => {
    // Kiosk clock = this computer's system time.
    el("clock").textContent = new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  };
  tick();
  setInterval(tick, 1000);
};

function paintTabs() {
  const options = [
    ["Palm", settings.allow_palm, "Palm scan"],
    ["RFID", settings.allow_rfid, "RFID card"],
    ["Manual", settings.allow_manual, "Manual code"],
    ["Barcode", settings.allow_barcode, "Camera barcode"],
    ["Face", settings.allow_face, "Face scan"],
  ].filter(([, on]) => on);
  method = options.some(([m]) => m === method) ? method : options[0]?.[0] ?? "Manual";
  el("tabs").innerHTML = options
    .map(([m, , label]) => `<button data-method="${m}" class="${m === method ? "active" : ""}">${label}</button>`)
    .join("");
  el("code").placeholder =
    method === "RFID" ? "Tap the RFID card…" :
    method === "Palm" ? "Waiting for the palm scanner…" :
    method === "Barcode" ? "Or type the member code" :
    method === "Face" ? "Or type the member code" : "Type the member code";
  const cam = el("camera");
  const usesCamera = method === "Barcode" || method === "Face";
  if (cam) {
    cam.hidden = !usesCamera;
    if (!usesCamera) stopCamera();
  }
  camHint(method === "Face"
    ? "Look straight at the camera — your face is matched with your library photo."
    : "Hold the ID card barcode inside the frame.");
}

/* ---------- camera barcode scanning ---------- */
let stream = null;
let scanning = false;
let zxingReader = null;
let lastCode = "";
let lastCodeAt = 0;

function camHint(text) { const h = el("cameraHint"); if (h) h.textContent = text; }

function stopCamera() {
  scanning = false;
  faceRunning = false;
  try { zxingReader?.reset?.(); } catch {}
  zxingReader = null;
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  const v = el("video");
  if (v) v.srcObject = null;
  el("camStop").hidden = true;
  el("camStart").hidden = false;
}

function onDetected(raw) {
  const value = String(raw || "").trim();
  if (!value) return;
  const now = Date.now();
  if (value === lastCode && now - lastCodeAt < 4000) return;   // ignore repeat frames
  lastCode = value; lastCodeAt = now;
  camHint(`Barcode read: ${value}`);
  submitScan(value, "Barcode");
}

async function startCamera() {
  if (scanning) return;
  camHint("Asking for camera permission…");
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
      audio: false,
    });
  } catch (err) {
    camHint(err?.name === "NotAllowedError"
      ? "Camera permission was blocked. Allow it in the browser address bar, then press Allow camera again."
      : "No camera available on this device.");
    return;
  }
  const video = el("video");
  video.srcObject = stream;
  await video.play().catch(() => {});
  scanning = true;
  el("camStart").hidden = true;
  el("camStop").hidden = false;
  if (method === "Face") {
    camHint("Look at the camera…");
    startFaceLoop(video);
    return;
  }
  camHint("Hold the ID card barcode inside the frame.");

  if ("BarcodeDetector" in window) {
    let formats = ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "itf", "codabar", "qr_code"];
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      formats = formats.filter((f) => supported.includes(f));
    } catch {}
    const detector = new window.BarcodeDetector(formats.length ? { formats } : undefined);
    const loop = async () => {
      if (!scanning) return;
      try {
        const found = await detector.detect(video);
        if (found?.length) onDetected(found[0].rawValue);
      } catch {}
      setTimeout(() => requestAnimationFrame(loop), 180);
    };
    requestAnimationFrame(loop);
    return;
  }

  // Older browsers: fall back to the ZXing decoder loaded on demand.
  try {
    const zx = await import("https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/+esm");
    zxingReader = new zx.BrowserMultiFormatReader();
    zxingReader.decodeFromStream(stream, video, (result) => { if (result) onDetected(result.getText()); });
  } catch {
    camHint("This browser cannot read barcodes. Use Chrome or Edge, or type the member code.");
  }
}

/* ---------- facial recognition ----------
   Descriptors are matched in the browser (face-api.js). The kiosk only sends
   the matched member id to the register, never any face image. */
let faceRunning = false;
let faceData = null;
let lastFaceMember = "";
let lastFaceAt = 0;

async function loadFaceData() {
  if (faceData) return faceData;
  const res = await fetch(`/api/public/kiosk/${encodeURIComponent(slug)}/faces`, { cache: "no-store" });
  if (!res.ok) throw new Error("Face recognition is not switched on for this library");
  faceData = await res.json();
  return faceData;
}

async function startFaceLoop(video) {
  if (faceRunning) return;
  faceRunning = true;
  let fr;
  try {
    fr = await import("/app/face-engine.js");
    const data = await loadFaceData();
    if (!data.faces.length) {
      camHint("No faces are enrolled yet. Ask the library desk to enrol photos first.");
      faceRunning = false;
      return;
    }
    camHint("Loading the face model…");
    await fr.loadModels(data.model_url);
    camHint("Look straight at the camera.");
  } catch (e) {
    camHint(e.message || "Face recognition could not start.");
    faceRunning = false;
    return;
  }

  const loop = async () => {
    if (!faceRunning || !scanning) return;
    try {
      const found = await fr.describeFace(video, faceData.model_url);
      if (found) {
        const match = fr.bestMatch(found.descriptor, faceData.faces, faceData.threshold || 0.55);
        const now = Date.now();
        if (!match) {
          camHint("Face not recognised — try again or use your member code.");
        } else if (match.member_id !== lastFaceMember || now - lastFaceAt > 6000) {
          lastFaceMember = match.member_id;
          lastFaceAt = now;
          camHint(`Face matched (${match.confidence}%)`);
          submitScan(match.member_id, "Face", match.confidence);
        }
      }
    } catch {}
    setTimeout(() => requestAnimationFrame(loop), 500);
  };
  requestAnimationFrame(loop);
}


/* ---------- Library activities / services: idle display ----------
   Shown only when nobody has used the kiosk for a while. It never blocks a
   scan: any key, touch, click or scanner input hides it immediately, and the
   normal kiosk (palm / RFID / manual / barcode / face) keeps running behind it. */
let idlePosts = [];
let idleIndex = 0;
let idleTimer = null;
let idleSlideTimer = null;
let idleConfig = { enabled: false, idle_seconds: 30, slide_seconds: 10 };
let idleShowing = false;

async function loadIdlePosts() {
  try {
    const res = await fetch(
      `/api/public/kiosk/${encodeURIComponent(slug)}/posts?device=${encodeURIComponent(deviceId)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return;
    const data = await res.json();
    idleConfig = data;
    idlePosts = Array.isArray(data.posts) ? data.posts : [];
    if (!idleConfig.enabled || !idlePosts.length) hideIdle();
    if (idleIndex >= idlePosts.length) idleIndex = 0;
  } catch { /* kiosk keeps working without promotional content */ }
}

function paintIdleSlide() {
  const post = idlePosts[idleIndex];
  if (!post) return hideIdle();
  const media = el("idleMedia");
  if (media) {
    media.innerHTML = post.media_url
      ? (post.media_type === "video"
        ? `<video src="${esc(post.media_url)}" autoplay muted loop playsinline></video>`
        : `<img src="${esc(post.media_url)}" alt="${esc(post.title)}" />`)
      : "";
  }
  el("idleCategory").textContent = post.category || "";
  el("idleTitle").textContent = post.title || "";
  el("idleBody").textContent = post.body || "";
  el("idleDots").innerHTML = idlePosts
    .map((_, i) => `<span class="${i === idleIndex ? "on" : ""}"></span>`).join("");
}

function showIdle() {
  if (idleShowing || !idleConfig.enabled || !idlePosts.length) return;
  idleShowing = true;
  const box = el("idleShow");
  box.hidden = false;
  box.setAttribute("aria-hidden", "false");
  paintIdleSlide();
  clearInterval(idleSlideTimer);
  idleSlideTimer = setInterval(() => {
    idleIndex = (idleIndex + 1) % idlePosts.length;
    paintIdleSlide();
  }, Math.max(3, Number(idleConfig.slide_seconds) || 10) * 1000);
}

function hideIdle() {
  clearInterval(idleSlideTimer);
  if (!idleShowing) return;
  idleShowing = false;
  const box = el("idleShow");
  if (box) { box.hidden = true; box.setAttribute("aria-hidden", "true"); }
  const media = el("idleMedia");
  if (media) media.innerHTML = "";
}

function noteActivity() {
  hideIdle();
  clearTimeout(idleTimer);
  if (!idleConfig.enabled || !idlePosts.length) return;
  idleTimer = setTimeout(showIdle, Math.max(5, Number(idleConfig.idle_seconds) || 30) * 1000);
}

async function startIdleDisplay() {
  await loadIdlePosts();
  for (const evt of ["pointerdown", "mousemove", "keydown", "touchstart", "wheel"]) {
    document.addEventListener(evt, noteActivity, { passive: true });
  }
  // Refresh content so scheduled occasion posts start and expire on time.
  setInterval(() => loadIdlePosts().then(() => { if (idleShowing) paintIdleSlide(); }), 60000);
  noteActivity();
}

async function boot() {
  const res = await fetch(
    `/api/public/kiosk/${encodeURIComponent(slug)}?device=${encodeURIComponent(deviceId)}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    document.body.innerHTML = `<main class="kiosk"><section class="panel kiosk-card">
      <h1>Kiosk not configured</h1><p class="muted">No university uses the link “${esc(slug)}”.</p></section></main>`;
    return;
  }
  const data = await res.json();
  settings = data.settings || {};
  if (data.device?.device_id) {
    deviceId = data.device.device_id;
    localStorage.setItem(`ler_device_${slug}`, deviceId);
  }
  document.body.classList.toggle("light", settings.theme === "light");
  applyTemplate(settings.kiosk_template);
  applyCustomCss(settings.custom_css);
  el("institution").textContent = settings.institution_name || data.institute.name;
  el("title").textContent = settings.kiosk_title || "Library Entry Kiosk";
  const nameEl = el("kioskName");
  if (nameEl) {
    const label = data.device
      ? [data.device.name, data.device.location].filter(Boolean).join(" · ")
      : "";
    nameEl.textContent = label;
    nameEl.hidden = !label;
  }
  el("welcome").textContent = settings.welcome_message || "";
  el("footer").textContent = settings.footer_note || "";
  if (settings.logo_url) {
    el("logo").src = settings.logo_url;
    el("logo").hidden = false;
  }
  if (settings.show_clock === 0) el("clock").hidden = true; else startClock();

  if (!data.subscription_active) {
    const why = data.kiosk_disabled_reason;
    const text = why === "suspended"
      ? "This university's account is suspended. Scanning resumes once the administrator re-activates it."
      : why === "inactive"
        ? "This terminal is switched off. Tick “Active” for it under Master Setting → Kiosks / terminals."
        : "This university's subscription has ended. Scanning resumes once the subscription is extended.";
    el("result").innerHTML = `<div class="result bad"><h2>Kiosk disabled</h2><p>${text}</p></div>`;
    el("scanForm").hidden = true;
    return;
  }
  paintTabs();
  if (method === "Barcode" || method === "Face") startCamera(); else el("code").focus();
  startIdleDisplay();
}

el("tabs").addEventListener("click", (e) => {
  const m = e.target.dataset.method;
  if (!m) return;
  method = m;
  stopCamera();
  paintTabs();
  if (method === "Barcode" || method === "Face") startCamera(); else el("code").focus();
});

el("scanForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const value = el("code").value.trim();
  if (!value) return;
  el("code").value = "";
  submitScan(value, method);
});

/* ---------- USB / hand-held barcode scanner (keyboard wedge) ----------
   Hand-held scanners type the code very fast and usually end with Enter.
   We buffer fast keystrokes anywhere on the kiosk page and auto-submit,
   so staff never have to click the input or press a button. */
let wedgeBuffer = "";
let wedgeLastKey = 0;
let wedgeIdleTimer = null;
const WEDGE_MAX_GAP_MS = 60;   // slower than this = a human typing
const WEDGE_IDLE_MS = 120;     // submit if the scanner sends no Enter
const WEDGE_MIN_LENGTH = 3;

function wedgeSubmit() {
  clearTimeout(wedgeIdleTimer);
  const value = wedgeBuffer.trim();
  wedgeBuffer = "";
  if (value.length < WEDGE_MIN_LENGTH) return;
  const input = el("code");
  if (input) input.value = "";
  // A wedge scanner reads the printed barcode on the ID card.
  submitScan(value, method === "RFID" ? "RFID" : "Barcode");
}

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const now = Date.now();
  const gap = now - wedgeLastKey;
  wedgeLastKey = now;

  if (e.key === "Enter") {
    if (wedgeBuffer.length >= WEDGE_MIN_LENGTH && gap < WEDGE_MAX_GAP_MS * 4) {
      e.preventDefault();
      wedgeSubmit();
    } else {
      wedgeBuffer = "";
    }
    return;
  }
  if (e.key.length !== 1) return;

  if (gap > WEDGE_MAX_GAP_MS) wedgeBuffer = "";
  wedgeBuffer += e.key;
  clearTimeout(wedgeIdleTimer);
  wedgeIdleTimer = setTimeout(wedgeSubmit, WEDGE_IDLE_MS);
});


/**
 * “Did You Know?” student insight cards under the scan result.
 * Admins can supply their own item markup in Settings using the placeholders
 * {{icon}}, {{text}} and {{category}}; otherwise the default card is used.
 */
function insightsHtml(out) {
  const items = Array.isArray(out.insights) ? out.insights : [];
  if (!items.length) return "";
  let tpl = String(out.insights_item_html || "").trim();
  // Guard: CSS pasted here by mistake (no {{placeholders}}) must not be shown as text.
  if (tpl && !/\{\{\s*(icon|text|category)\s*\}\}/.test(tpl)) tpl = "";
  const cards = items.map((i) => {
    if (tpl) {
      return tpl
        .replace(/\{\{\s*icon\s*\}\}/g, esc(i.icon || ""))
        .replace(/\{\{\s*text\s*\}\}/g, esc(i.text || ""))
        .replace(/\{\{\s*category\s*\}\}/g, esc(i.category || ""));
    }
    return `<div class="insight" data-category="${esc(i.category || "")}">
      <span class="insight-icon">${esc(i.icon || "💡")}</span>
      <span class="insight-text">${esc(i.text || "")}</span></div>`;
  }).join("");
  return `<div class="kiosk-insights">
    <p class="insights-title">${esc(out.insights_title || "Did You Know?")}</p>
    ${cards}</div>`;
}

async function submitScan(value, methodUsed, confidence) {
  clearTimeout(resetTimer);
  noteActivity();   // a scan always brings the normal kiosk back
  const method = methodUsed;
  const body = { institute: slug, method, device_id: deviceId };
  if (confidence != null) body.confidence = confidence;
  if (method === "RFID") body.rfid_uid = value;
  else if (method === "Face") body.member_id = value;
  else body.member_code = value;

  try {
    const res = await fetch("/api/public/scan-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const out = await res.json();
    if (out.status === "ok") {
      const label = out.action === "Entry" ? (settings.entry_label || "Entry") : (settings.exit_label || "Exit");
      const photo = settings.show_photo !== 0 && out.member.photo_url
        ? `<img src="${esc(out.member.photo_url)}" alt="${esc(out.member.full_name)}" />` : "";
      el("result").innerHTML = `<div class="result ${out.action === "Entry" ? "entry" : "exit"}">
        ${photo}<h2>${esc(label)} recorded</h2>
        <p>${esc(out.member.full_name)} · ${esc(out.member.member_code)}</p>
        <p class="muted">${new Date(out.occurred_at).toLocaleString("en-GB")}</p>
        ${insightsHtml(out)}</div>`;

    } else if (out.reason === "membership_expired") {
      const who = out.member_name
        ? `<p>${esc(out.member_name)}${out.member_code ? ` · ${esc(out.member_code)}` : ""}</p>` : "";
      const until = out.valid_to
        ? `<p class="muted">Valid until ${esc(String(out.valid_to).slice(0, 10))}</p>` : "";
      el("result").innerHTML = `<div class="result bad expired"><h2>Membership expired</h2>
        ${who}<p>Kindly renew your membership at the library desk.</p>${until}</div>`;
    } else {
      el("result").innerHTML = `<div class="result bad"><h2>Scan rejected</h2>
        <p>${esc(out.message || "Try again or see the desk")}</p></div>`;
    }
  } catch {
    el("result").innerHTML = `<div class="result bad"><h2>Kiosk offline</h2>
      <p>Cannot reach the register server.</p></div>`;
  }

  resetTimer = setTimeout(() => { el("result").innerHTML = ""; }, (settings.result_seconds || 7) * 1000);
  if (method !== "Barcode" && method !== "Face") el("code").focus();
}

el("camStart").addEventListener("click", startCamera);
el("camStop").addEventListener("click", () => { stopCamera(); camHint("Camera stopped."); });

boot();
