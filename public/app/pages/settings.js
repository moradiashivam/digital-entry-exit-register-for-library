import { state } from "/app/admin.js";
import { TIMEZONES, setTimezone } from "/app/api.js";
import { ACCENTS, getAccent, applyAccent, getTheme, applyTheme } from "/app/theme.js";
import { KIOSK_TEMPLATES, templateCss } from "/app/kiosk-templates.js";

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
  ["allow_face", "Allow face recognition (enrol faces on the Face ID page)"],
  ["show_photo", "Show student photo"],
  ["show_clock", "Show clock"],
  ["multi_kiosk_transfer", "Automatic transfer between kiosks (a visit opened at one kiosk closes there and re-opens here)"],
];

// Insight types offered on the kiosk (must match src/insights.service.js).
const INSIGHT_CATEGORIES = [
  ["time", "Library time facts (total / average / longest session)"],
  ["visits", "Visit counts (total visits, different days, this month)"],
  ["streak", "Visit streaks (current and longest run of days)"],
  ["milestone", "Milestone celebrations (50th visit, 100 hours…)"],
  ["progress", "Personal progress (this month vs last month)"],
  ["stats", "Interesting personal statistics (favourite day, averages)"],
  ["next", "Next achievement / goal"],
];
const DEFAULT_CATEGORIES = INSIGHT_CATEGORIES.map(([id]) => id).join(",");



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

        <div class="panel">
          <h3>Kiosk template</h3>
          <p class="muted">Pick one of the ready-made kiosk designs. Your custom CSS below is applied on top,
            so any part of the template can still be overridden.</p>
          <div class="template-grid">
            ${KIOSK_TEMPLATES.map((t) => `
              <button type="button" class="template-option${(s.kiosk_template || "classic") === t.id ? " active" : ""}" data-template="${t.id}">
                <span class="template-name">${esc(t.label)}</span>
                <span class="muted template-desc">${esc(t.description)}</span>
              </button>`).join("")}
          </div>
          <div class="row" style="margin-top:.7rem">
            <button id="saveTemplate">Save template</button>
            <button class="ghost" id="copyTemplateCss">Copy this template's CSS into the editor</button>
          </div>
        </div>

        <div class="panel">
          <h3>“Did You Know?” student insights</h3>
          <p class="muted">After every scan the kiosk can show personal library facts for that student —
            time spent in the library, visits, streaks, milestones and the next goal.
            Everything below is customisable, including your own card markup and CSS.</p>
          <div class="toggle-grid">
            <label class="toggle-item"><input type="checkbox" id="s_insights_enabled" ${s.insights_enabled ? "checked" : ""} />
              <span>Show insights on the kiosk</span></label>
            <label class="toggle-item"><input type="checkbox" id="s_insights_on_entry" ${s.insights_on_entry ? "checked" : ""} />
              <span>Show on entry scans</span></label>
            <label class="toggle-item"><input type="checkbox" id="s_insights_on_exit" ${s.insights_on_exit ? "checked" : ""} />
              <span>Show on exit scans</span></label>
          </div>
          <div class="field-grid" style="margin-top:.6rem">
            <div class="field"><label for="s_insights_title">Section heading</label>
              <input id="s_insights_title" value="${esc(s.insights_title ?? "Did You Know?")}" /></div>
            <div class="field"><label for="s_insights_count">Insights shown per scan (1–3)</label>
              <input id="s_insights_count" type="number" min="1" max="3" value="${esc(s.insights_count ?? 2)}" /></div>
            <div class="field"><label for="s_insights_goal">Monthly visit goal per student (0 = off)</label>
              <input id="s_insights_goal" type="number" min="0" max="200" value="${esc(s.insights_goal ?? 0)}" /></div>
          </div>
          <p class="muted" style="margin-top:.7rem">Insight types to use</p>
          <div class="toggle-grid">
            ${INSIGHT_CATEGORIES.map(([id, label]) => `
              <label class="toggle-item"><input type="checkbox" data-cat="${id}"
                ${(s.insights_categories ?? DEFAULT_CATEGORIES).split(",").includes(id) ? "checked" : ""} />
                <span>${esc(label)}</span></label>`).join("")}
          </div>
          <p class="muted" style="margin-top:.8rem">Custom card markup (optional) — placeholders
            <code>{{icon}}</code>, <code>{{text}}</code>, <code>{{category}}</code>. Leave empty for the default card.
            Style with <code>.kiosk-insights</code>, <code>.insights-title</code>, <code>.insight</code>,
            <code>.insight-icon</code>, <code>.insight-text</code> in the custom CSS editor.</p>
          <textarea id="s_insights_item_html" rows="4" spellcheck="false"
            style="width:100%;font-family:ui-monospace,Consolas,monospace;font-size:.82rem"
            placeholder="&lt;div class=&quot;insight&quot;&gt;{{icon}} {{text}}&lt;/div&gt;">${esc(s.insights_item_html ?? "")}</textarea>
          <div class="row" style="margin-top:.7rem">
            <button id="saveInsights">Save insights settings</button>
          </div>
          <p class="muted" style="margin-top:.9rem">Preview for a student</p>
          <div class="row">
            <input id="insightCode" placeholder="Membership number" style="max-width:220px" />
            <button class="ghost" id="previewInsights">Preview</button>
          </div>
          <div id="insightPreview" class="muted" style="margin-top:.6rem"></div>
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


  let template = s.kiosk_template || "classic";
  const paintTemplates = () => {
    for (const b of view.querySelectorAll(".template-option"))
      b.classList.toggle("active", b.dataset.template === template);
  };
  const applyPreviewTemplate = () => {
    const frame = view.querySelector("#kioskPreview");
    const doc = frame?.contentDocument;
    if (!doc) return;
    const style = doc.getElementById("kioskTemplateCss");
    if (style) style.textContent = templateCss(template);
    doc.body.dataset.template = template;
  };
  for (const b of view.querySelectorAll(".template-option")) {
    b.onclick = () => { template = b.dataset.template; paintTemplates(); applyPreviewTemplate(); };
  }
  view.querySelector("#saveTemplate").onclick = async () => {
    try {
      await api("/api/settings/kiosk", { method: "PUT", body: { kiosk_template: template } });
      toast("Kiosk template saved");
      reloadPreview();
    } catch (e) { toast(e.message, true); }
  };
  view.querySelector("#copyTemplateCss").onclick = () => {
    const css = templateCss(template);
    if (!css) return toast("The Classic template uses the default styles — nothing to copy", true);
    cssEditor.value = `${cssEditor.value.trim()}\n\n${css}`.trim();
    applyPreviewCss();
    toast("Template CSS copied — edit it, then press Save custom CSS");
  };

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
  view.querySelector("#kioskPreview").addEventListener("load", () => { applyPreviewTemplate(); applyPreviewCss(); });
  paintTemplates();

  view.querySelector("#save").onclick = async () => {
    const body = { result_seconds: Number(view.querySelector("#s_result_seconds").value) || 7 };
    for (const [k] of TEXT_FIELDS) body[k] = view.querySelector(`#s_${k}`).value;
    for (const [k] of TOGGLES) body[k] = view.querySelector(`#s_${k}`).checked;
    body.theme = view.querySelector("#s_theme").value;
    body.kiosk_template = template;
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

  /* ---------- “Did You Know?” student insights ---------- */
  const insightCats = () =>
    [...view.querySelectorAll("[data-cat]")].filter((c) => c.checked).map((c) => c.dataset.cat).join(",");

  view.querySelector("#saveInsights").onclick = async () => {
    const body = {
      insights_enabled: view.querySelector("#s_insights_enabled").checked,
      insights_on_entry: view.querySelector("#s_insights_on_entry").checked,
      insights_on_exit: view.querySelector("#s_insights_on_exit").checked,
      insights_title: view.querySelector("#s_insights_title").value.trim() || "Did You Know?",
      insights_count: Math.min(3, Math.max(1, Number(view.querySelector("#s_insights_count").value) || 2)),
      insights_goal: Math.max(0, Number(view.querySelector("#s_insights_goal").value) || 0),
      insights_categories: insightCats(),
      insights_item_html: view.querySelector("#s_insights_item_html").value.trim(),
    };
    try {
      await api("/api/settings/kiosk", { method: "PUT", body });
      toast("Insights settings saved");
      reloadPreview();
    } catch (e) { toast(e.message, true); }
  };

  view.querySelector("#previewInsights").onclick = async () => {
    const code = view.querySelector("#insightCode").value.trim();
    const box = view.querySelector("#insightPreview");
    if (!code) return toast("Enter a membership number", true);
    box.textContent = "Loading…";
    try {
      const out = await api(`/api/settings/insights/preview?code=${encodeURIComponent(code)}`);
      box.innerHTML = out.all.length
        ? `<strong>${esc(out.member.full_name)}</strong>
           <div class="kiosk-insights"><p class="insights-title">${esc(out.title)}</p>
           ${out.shown.map((i) => `<div class="insight"><span class="insight-icon">${esc(i.icon)}</span>
             <span class="insight-text">${esc(i.text)}</span></div>`).join("")}</div>
           <p class="muted" style="margin-top:.5rem">${out.all.length} insights available for this student — the kiosk rotates between them.</p>`
        : `<span class="muted">No library activity yet for ${esc(out.member.full_name)}.</span>`;
    } catch (e) { box.textContent = e.message; }
  };



}
