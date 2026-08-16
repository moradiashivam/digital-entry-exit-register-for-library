/**
 * Owner → Website: brand the public home and contact pages, or take full
 * control with custom HTML + CSS. Everything is stored in platform_settings.
 */
export async function renderOwnerSite(view, { api, esc, toast }) {
  const data = (await api("/api/owner/settings")) || {};
  const s = data.settings || {};
  const on = s.site_custom_enabled === "1";

  view.innerHTML = `
    <div class="panel">
      <h3 style="margin-top:0">Public site branding</h3>
      <p class="muted">Shown on <a href="/" target="_blank" rel="noopener">the home page</a> and
        <a href="/contact.html" target="_blank" rel="noopener">the contact page</a>. Enquiries land in Leads (CRM).</p>
      <div class="row">
        <div style="min-width:220px"><label for="s_brand">Brand name</label>
          <input id="s_brand" style="width:100%" value="${esc(s.site_brand || s.platform_name || "")}" placeholder="Library Entry &amp; Exit Register" /></div>
        <div><label for="s_email">Contact email</label><input id="s_email" type="email" value="${esc(s.site_contact_email || "")}" /></div>
        <div><label for="s_phone">Contact phone</label><input id="s_phone" value="${esc(s.site_contact_phone || "")}" /></div>
      </div>
      <div class="row">
        <div style="flex:1;min-width:260px"><label for="s_tag">Hero tagline</label>
          <textarea id="s_tag" rows="2" style="width:100%">${esc(s.site_tagline || "")}</textarea></div>
        <div style="flex:1;min-width:260px"><label for="s_addr">Office address</label>
          <textarea id="s_addr" rows="2" style="width:100%">${esc(s.site_contact_address || "")}</textarea></div>
      </div>
    </div>

    <div class="panel" style="margin-top:1rem">
      <div class="row" style="justify-content:space-between;align-items:center">
        <h3 style="margin:0">Custom HTML &amp; CSS</h3>
        <label style="display:flex;gap:.5rem;align-items:center;margin:0">
          <input type="checkbox" id="s_on" ${on ? "checked" : ""} style="width:auto" /> Use my custom design
        </label>
      </div>
      <p class="muted">When enabled, your HTML replaces the page body and your CSS is injected last, so it overrides
        the built-in styles. Leave a field empty to keep the built-in design for that page.
        Write responsive CSS (use <code>@media</code>) — the default stylesheet <code>/site.css</code> stays loaded.</p>

      <div class="row" style="margin-top:.4rem">
        <div style="flex:1;min-width:280px">
          <label for="h_html">Home page HTML</label>
          <textarea id="h_html" rows="12" style="width:100%;font-family:ui-monospace,Consolas,monospace">${esc(s.site_home_html || "")}</textarea>
        </div>
        <div style="flex:1;min-width:280px">
          <label for="h_css">Home page CSS</label>
          <textarea id="h_css" rows="12" style="width:100%;font-family:ui-monospace,Consolas,monospace">${esc(s.site_home_css || "")}</textarea>
        </div>
      </div>
      <div class="row">
        <div style="flex:1;min-width:280px">
          <label for="k_html">Contact page HTML</label>
          <textarea id="k_html" rows="10" style="width:100%;font-family:ui-monospace,Consolas,monospace">${esc(s.site_contact_html || "")}</textarea>
          <p class="muted">Keep a form with <code>id="contactForm"</code> and fields named
            <code>name, contact_person, email, phone, city, message</code> so enquiries still reach the CRM.</p>
        </div>
        <div style="flex:1;min-width:280px">
          <label for="k_css">Contact page CSS</label>
          <textarea id="k_css" rows="10" style="width:100%;font-family:ui-monospace,Consolas,monospace">${esc(s.site_contact_css || "")}</textarea>
        </div>
      </div>

      <div class="row" style="margin-top:.6rem">
        <button id="save">Save website</button>
        <button class="ghost" id="preview">Preview home page</button>
        <button class="ghost" id="starter">Insert starter template</button>
      </div>
    </div>

    <div class="panel" style="margin-top:1rem">
      <h3 style="margin-top:0">Live preview</h3>
      <iframe id="frame" title="Public site preview" src="/"
        style="width:100%;height:560px;border:1px solid var(--line);border-radius:12px;background:#fff"></iframe>
    </div>`;

  const val = (id) => view.querySelector(id).value;

  view.querySelector("#save").onclick = async () => {
    try {
      await api("/api/owner/settings", {
        method: "PUT",
        body: {
          site_brand: val("#s_brand"),
          site_tagline: val("#s_tag"),
          site_contact_email: val("#s_email"),
          site_contact_phone: val("#s_phone"),
          site_contact_address: val("#s_addr"),
          site_custom_enabled: view.querySelector("#s_on").checked ? "1" : "0",
          site_home_html: val("#h_html"),
          site_home_css: val("#h_css"),
          site_contact_html: val("#k_html"),
          site_contact_css: val("#k_css"),
        },
      });
      toast("Website updated");
      view.querySelector("#frame").src = `/?t=${Date.now()}`;
    } catch (e) {
      toast(e.message, true);
    }
  };

  view.querySelector("#preview").onclick = () => window.open("/", "_blank", "noopener");

  view.querySelector("#starter").onclick = () => {
    view.querySelector("#h_html").value = `<section class="own-hero">
  <h1>Your university library, measured in real time</h1>
  <p>Palm vein, RFID and manual check-in with live occupancy and instant reports.</p>
  <a class="own-btn" href="/contact.html">Talk to us</a>
</section>`;
    view.querySelector("#h_css").value = `.own-hero { max-width: 900px; margin: 0 auto; padding: 6rem 1.2rem; text-align: center; }
.own-hero h1 { font-size: clamp(2rem, 6vw, 3.4rem); line-height: 1.1; }
.own-hero p { color: #9fb0d8; }
.own-btn { display: inline-block; margin-top: 1.4rem; padding: .8rem 1.4rem; border-radius: 12px;
  background: linear-gradient(140deg, #4f8cff, #22d3a7); color: #04122a; font-weight: 700; }
@media (max-width: 600px) { .own-hero { padding: 3rem 1rem; } }`;
    toast("Starter template inserted — review, then save");
  };
}
