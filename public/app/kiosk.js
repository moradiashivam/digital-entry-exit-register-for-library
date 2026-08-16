import { esc } from "/app/api.js";

const slug = location.pathname.split("/").filter(Boolean)[1] || "";
const deviceId = localStorage.getItem("ler_device") || "kiosk-1";
const el = (id) => document.getElementById(id);

let settings = {};
let method = "Manual";
let resetTimer = null;

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
    el("clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };
  tick();
  setInterval(tick, 1000);
};

function paintTabs() {
  const options = [
    ["Palm", settings.allow_palm, "Palm scan"],
    ["RFID", settings.allow_rfid, "RFID card"],
    ["Manual", settings.allow_manual, "Manual code"],
  ].filter(([, on]) => on);
  method = options.some(([m]) => m === method) ? method : options[0]?.[0] ?? "Manual";
  el("tabs").innerHTML = options
    .map(([m, , label]) => `<button data-method="${m}" class="${m === method ? "active" : ""}">${label}</button>`)
    .join("");
  el("code").placeholder =
    method === "RFID" ? "Tap the RFID card…" :
    method === "Palm" ? "Waiting for the palm scanner…" : "Type the member code";
}

async function boot() {
  const res = await fetch(`/api/public/kiosk/${encodeURIComponent(slug)}`, { cache: "no-store" });
  if (!res.ok) {
    document.body.innerHTML = `<main class="kiosk"><section class="panel kiosk-card">
      <h1>Kiosk not configured</h1><p class="muted">No university uses the link “${esc(slug)}”.</p></section></main>`;
    return;
  }
  const data = await res.json();
  settings = data.settings || {};
  document.body.classList.toggle("light", settings.theme === "light");
  applyCustomCss(settings.custom_css);
  el("institution").textContent = settings.institution_name || data.institute.name;
  el("title").textContent = settings.kiosk_title || "Library Entry Kiosk";
  el("welcome").textContent = settings.welcome_message || "";
  el("footer").textContent = settings.footer_note || "";
  if (settings.logo_url) {
    el("logo").src = settings.logo_url;
    el("logo").hidden = false;
  }
  if (settings.show_clock === 0) el("clock").hidden = true; else startClock();
  if (!data.subscription_active) {
    const suspended = data.kiosk_disabled_reason === "suspended";
    el("result").innerHTML = `<div class="result bad"><h2>Kiosk disabled</h2>
      <p>${suspended
        ? "This university's account is suspended. Scanning resumes once the administrator re-activates it."
        : "This university's subscription has ended. Scanning resumes once the subscription is extended."}</p></div>`;
    el("scanForm").hidden = true;
    return;
  }
  paintTabs();
  el("code").focus();
}

el("tabs").addEventListener("click", (e) => {
  const m = e.target.dataset.method;
  if (!m) return;
  method = m;
  paintTabs();
  el("code").focus();
});

el("scanForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const value = el("code").value.trim();
  if (!value) return;
  el("code").value = "";
  clearTimeout(resetTimer);

  const body = { institute: slug, method, device_id: deviceId };
  if (method === "RFID") body.rfid_uid = value; else body.member_code = value;

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
        <p class="muted">${new Date(out.occurred_at).toLocaleString()}</p></div>`;
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
  el("code").focus();
});

boot();
