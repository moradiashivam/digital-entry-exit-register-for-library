import { state } from "/app/admin.js";
import { TIMEZONES, setTimezone } from "/app/api.js";
import { ACCENTS, getAccent, applyAccent, getTheme, applyTheme } from "/app/theme.js";

const TEXT_FIELDS = [
  ["institution_name", "University / institution name"],
  ["kiosk_title", "Kiosk screen title"],
  ["logo_url", "Logo URL"],
  ["welcome_message", "Welcome message"],
  ["entry_label", "Entry button label"],
  ["exit_label", "Exit button label"],
  ["footer_note", "Footer note"],
];
const TOGGLES = [
  ["allow_palm", "Allow palm scan"],
  ["allow_rfid", "Allow RFID card"],
  ["allow_manual", "Allow manual code entry"],
  ["allow_barcode", "Allow camera barcode scan"],
  ["show_photo", "Show student photo"],
  ["show_clock", "Show clock"],
  ["multi_kiosk_transfer", "Automatic transfer between kiosks (a visit opened at one kiosk closes there and re-opens here)"],
];


export async function renderSettings(view, { api, esc, toast }) {
  const s = await api("/api/settings/kiosk");
  const slug = state.institute?.slug ?? "";

  view.innerHTML = `
    <div class="settings-layout">
      <div class="settings-col">
        <div class="panel">
          <h3>Kiosk branding</h3>
          <p class="muted">Kiosk link: <a href="/kiosk/${esc(slug)}" target="_blank">/kiosk/${esc(slug)}</a></p>
          <div class="field-grid">
            ${TEXT_FIELDS.map(([k, label]) =>
              `<div class="field"><label for="s_${k}">${label}</label><input id="s_${k}" value="${esc(s[k] ?? "")}" /></div>`).join("")}
            <div class="field"><label for="s_result_seconds">Result screen seconds</label>
              <input id="s_result_seconds" type="number" min="2" max="30" value="${esc(s.result_seconds ?? 7)}" /></div>
            <div class="field"><label for="s_timezone">Local time zone</label>
              <select id="s_timezone">
                ${TIMEZONES.map(([id, label]) =>
                  `<option value="${esc(id)}"${(s.timezone || "Asia/Kolkata") === id ? " selected" : ""}>${esc(label)}</option>`).join("")}
              </select></div>
            <div class="field"><label for="s_theme">Kiosk colour mode</label>
              <select id="s_theme">
                <option value="dark"${s.theme === "dark" ? " selected" : ""}>Dark</option>
                <option value="light"${s.theme === "dark" ? "" : " selected"}>Light</option>
              </select></div>
          </div>
          <div class="toggle-grid">
            ${TOGGLES.map(([k, label]) =>
              `<label class="toggle-item">
                <input type="checkbox" id="s_${k}" ${s[k] ? "checked" : ""} /> <span>${label}</span></label>`).join("")}
          </div>
          <button id="save" style="margin-top:1rem">Save kiosk settings</button>
        </div>

        <div class="panel appearance">
          <h3 style="display:flex;align-items:center;gap:.45rem"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="var(--brand)"/><circle cx="17.5" cy="10.5" r=".5" fill="var(--brand)"/><circle cx="8.5" cy="7.5" r=".5" fill="var(--brand)"/><circle cx="6.5" cy="12.5" r=".5" fill="var(--brand)"/><path d="M12 2a10 10 0 0 0 0 20 2 2 0 0 0 2-2 2 2 0 0 1 2-2h2a4 4 0 0 0 4-4 10 10 0 0 0-10-10z"/></svg>Appearance</h3>
          <p class="muted">Pick the accent colour used across charts, buttons and the kiosk preview.</p>
          <div class="accent-grid">
            ${ACCENTS.map((a) => `
              <button type="button" class="accent-option" data-accent="${a.id}">
                <span class="accent-dot" style="background:${a.brand}"></span>${esc(a.label)}
              </button>`).join("")}
          </div>
          <div class="appearance-row">
            <span>Dark mode</span>
            <label class="switch"><input type="checkbox" id="darkToggle" /><span class="slider"></span></label>
          </div>
          <button class="ghost" id="resetAppearance" style="width:100%;margin-top:.7rem">Reset to default</button>
        </div>

      </div>



      <div class="settings-col">
        <div class="panel">
          <h3>Kiosk custom CSS</h3>
          <p class="muted">Restyle your kiosk home page. These class names are fixed and safe to target:</p>
          <ul class="muted class-list">
            <li><code>.kiosk</code> — full screen background</li>
            <li><code>.kiosk-card</code> — the centred card</li>
            <li><code>.kiosk-logo</code> — university logo image</li>
            <li><code>.kiosk-institution</code> — university name (h1)</li>
            <li><code>.kiosk-title</code> — kiosk screen title</li>
            <li><code>.kiosk-clock</code> — live clock</li>
            <li><code>.kiosk-welcome</code> — welcome message</li>
            <li><code>.kiosk-tabs button</code> — palm / RFID / manual buttons</li>
            <li><code>.kiosk-form</code>, <code>.kiosk-input</code> — scan form and input</li>
            <li><code>.kiosk-result</code>, <code>.result.entry</code>, <code>.result.exit</code>, <code>.result.bad</code> — result panel</li>
            <li><code>.kiosk-footer</code> — footer note</li>
          </ul>
          <textarea id="s_custom_css" rows="10" spellcheck="false"
            style="width:100%;font-family:ui-monospace,Consolas,monospace;font-size:.82rem"
            placeholder=".kiosk-card { background: #0b3d2e; }">${esc(s.custom_css ?? "")}</textarea>
          <div class="row" style="margin-top:.6rem">
            <button id="saveCss">Save custom CSS</button>
            <button class="ghost" id="clearCss">Clear</button>
            <a class="badge" href="/kiosk/${esc(slug)}" target="_blank">Preview kiosk</a>
          </div>
          <p class="muted" style="margin-top:.8rem">Live preview</p>
          <iframe id="kioskPreview" title="Kiosk preview" src="/kiosk/${esc(slug)}"
            style="width:100%;height:340px;border:1px solid var(--line);border-radius:12px;background:#000"></iframe>
        </div>

        <div class="panel">
          <p class="muted" style="margin:0">Kiosks / terminals, library working hours, staff, SIP2 / LMS and
            data backup now live in <strong>Master Setting</strong>.</p>
        </div>

      </div>
    </div>`;


  const paintAccents = () => {
    const current = getAccent();
    for (const b of view.querySelectorAll(".accent-option"))
      b.classList.toggle("active", b.dataset.accent === current);
    view.querySelector("#darkToggle").checked = getTheme() === "dark";
  };
  paintAccents();
  for (const b of view.querySelectorAll(".accent-option")) {
    b.onclick = () => {
      applyAccent(b.dataset.accent);
      paintAccents();
    };
  }
  view.querySelector("#darkToggle").onchange = (e) => {
    applyTheme(e.target.checked ? "dark" : "light");
    const t = document.getElementById("themeToggle");
    if (t) t.textContent = getTheme() === "light" ? "Switch to dark mode" : "Switch to light mode";
  };
  view.querySelector("#resetAppearance").onclick = () => {
    applyAccent("indigo");
    applyTheme("dark");
    const t = document.getElementById("themeToggle");
    if (t) t.textContent = "Switch to light mode";
    paintAccents();
    toast("Appearance reset");
  };




  const reloadPreview = () => {
    const frame = view.querySelector("#kioskPreview");
    if (frame) frame.src = `/kiosk/${encodeURIComponent(slug)}?settings=${Date.now()}`;
  };

  const cssEditor = view.querySelector("#s_custom_css");
  const normalizeCss = (css) => String(css || "")
    .replace(/^\uFEFF/, "")
    .replace(/<\/?style(?:\s[^>]*)?>/gi, "")
    .trim();
  const applyPreviewCss = () => {
    const frame = view.querySelector("#kioskPreview");
    const style = frame?.contentDocument?.getElementById("kioskCustomCss");
    if (style) style.textContent = normalizeCss(cssEditor.value);
  };
  cssEditor.addEventListener("input", applyPreviewCss);
  view.querySelector("#kioskPreview").addEventListener("load", applyPreviewCss);

  view.querySelector("#save").onclick = async () => {
    const body = { result_seconds: Number(view.querySelector("#s_result_seconds").value) || 7 };
    for (const [k] of TEXT_FIELDS) body[k] = view.querySelector(`#s_${k}`).value;
    for (const [k] of TOGGLES) body[k] = view.querySelector(`#s_${k}`).checked;
    body.theme = view.querySelector("#s_theme").value;
    body.timezone = view.querySelector("#s_timezone").value;
    body.custom_css = cssEditor.value;
    try {
      await api("/api/settings/kiosk", { method: "PUT", body });
      setTimezone(body.timezone);
      toast("Kiosk settings saved");
      reloadPreview();
    } catch (e) {
      toast(e.message, true);
    }
  };

  const saveCss = async (css) => {
    try {
      const normalized = normalizeCss(css);
      cssEditor.value = normalized;
      await api("/api/settings/kiosk", { method: "PUT", body: { custom_css: normalized } });
      toast("Kiosk CSS saved");
      reloadPreview();
    } catch (e) {
      toast(e.message, true);
    }
  };

  view.querySelector("#saveCss").onclick = () => saveCss(cssEditor.value);
  view.querySelector("#clearCss").onclick = () => {
    cssEditor.value = "";
    applyPreviewCss();
    saveCss("");
  };



}
