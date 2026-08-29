/**
 * Owner → SEO: everything needed to rank the public site on Google, Bing,
 * Yandex and friends — titles, descriptions, social cards, verification
 * codes, robots.txt and sitemap.xml. Saved to platform_settings and applied
 * server-side to the public pages.
 */
export async function renderOwnerSeo(view, { api, esc, toast }) {
  const data = (await api("/api/owner/seo")) || {};
  const s = data.settings || {};
  const pages = data.pages || [];
  const audit = data.audit || { score: 0, checks: [] };

  const field = (id, label, value, hint = "", type = "text") => `
    <div style="flex:1;min-width:240px">
      <label for="${id}">${esc(label)}</label>
      <input id="${id}" type="${type}" style="width:100%" value="${esc(value || "")}" />
      ${hint ? `<p class="muted" style="margin:.25rem 0 0">${hint}</p>` : ""}
    </div>`;

  const pageBlock = (p) => `
    <div class="panel" style="padding:.9rem;margin-top:.7rem">
      <div class="row" style="justify-content:space-between;align-items:center">
        <strong>${esc(p.label)}</strong>
        <a class="muted" href="${esc(p.path)}" target="_blank" rel="noopener">${esc(p.url)}</a>
      </div>
      <div class="row">
        <div style="flex:1;min-width:260px">
          <label for="t_${p.key}">Page title</label>
          <input id="t_${p.key}" style="width:100%" maxlength="120"
                 value="${esc(s[`seo_${p.key}_title`] || "")}" placeholder="${esc(p.title)}" />
        </div>
        <div style="flex:2;min-width:280px">
          <label for="d_${p.key}">Meta description</label>
          <textarea id="d_${p.key}" rows="2" maxlength="320" style="width:100%"
                    placeholder="${esc(p.description)}">${esc(s[`seo_${p.key}_description`] || "")}</textarea>
        </div>
      </div>
      <p class="muted" id="c_${p.key}"></p>
    </div>`;

  view.innerHTML = `
    <div class="panel">
      <div class="row" style="justify-content:space-between;align-items:center">
        <h3 style="margin:0">Search engine readiness</h3>
        <strong style="font-size:1.4rem">${audit.score}%</strong>
      </div>
      <p class="muted">These settings are written into every public page (home, contact, documentation, developer)
        so Google, Bing, Yandex and Baidu can index them. Admin, kiosk and API URLs are never exposed.</p>
      <ul style="margin:.4rem 0 0;padding-left:1.1rem">
        ${(audit.checks || []).map((c) => `<li style="margin:.2rem 0">
            <span style="color:${c.ok ? "var(--ok, #22c55e)" : "var(--danger, #ef4444)"}">${c.ok ? "✔" : "✖"}</span>
            ${esc(c.label)} ${c.ok ? "" : `<span class="muted">— ${esc(c.hint)}</span>`}
          </li>`).join("")}
      </ul>
    </div>

    <div class="panel" style="margin-top:1rem">
      <h3 style="margin-top:0">Site identity</h3>
      <div class="row">
        ${field("seo_site_url", "Public site URL", s.seo_site_url, "e.g. https://register.youruniversity.com — used for canonical links and the sitemap")}
        ${field("seo_title_suffix", "Title suffix", s.seo_title_suffix, "Appended after a | on every page title")}
      </div>
      <div class="row">
        ${field("seo_organization_name", "Organisation name", s.seo_organization_name, "Shown in structured data (rich results)")}
        ${field("seo_organization_logo", "Logo URL", s.seo_organization_logo, "Square logo, absolute URL or /path")}
        ${field("seo_locale", "Locale", s.seo_locale || "en_US", "e.g. en_US, en_IN")}
      </div>
      <div class="row">
        ${field("seo_og_image", "Social share image", s.seo_og_image, "1200×630 image used by Google, WhatsApp, LinkedIn, X")}
        ${field("seo_twitter_handle", "X / Twitter handle", s.seo_twitter_handle, "Including the @")}
      </div>
      <div class="row">
        <div style="flex:1;min-width:280px">
          <label for="seo_keywords">Keywords</label>
          <textarea id="seo_keywords" rows="2" style="width:100%">${esc(s.seo_keywords || "")}</textarea>
          <p class="muted">Comma separated, e.g. library entry exit register, palm vein attendance, university library software</p>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:1rem">
      <h3 style="margin-top:0">Page titles &amp; descriptions</h3>
      <p class="muted">Leave blank to keep the built-in wording (shown as the placeholder).
        Aim for 50–60 character titles and 70–160 character descriptions.</p>
      ${pages.map(pageBlock).join("")}
    </div>

    <div class="panel" style="margin-top:1rem">
      <h3 style="margin-top:0">Search engine verification</h3>
      <p class="muted">Register the site with each service, choose the “HTML tag” method and paste only the content code here.
        Then submit <code>${esc(data.base || "")}/sitemap.xml</code> in each console.</p>
      <div class="row">
        ${field("seo_google_verification", "Google Search Console", s.seo_google_verification)}
        ${field("seo_bing_verification", "Bing Webmaster Tools", s.seo_bing_verification)}
      </div>
      <div class="row">
        ${field("seo_yandex_verification", "Yandex Webmaster", s.seo_yandex_verification)}
        ${field("seo_baidu_verification", "Baidu Ziyuan", s.seo_baidu_verification)}
        ${field("seo_pinterest_verification", "Pinterest", s.seo_pinterest_verification)}
      </div>
      <div class="row">
        <div style="flex:1;min-width:280px">
          <label for="seo_analytics_head">Extra head code (analytics, tag manager)</label>
          <textarea id="seo_analytics_head" rows="4" style="width:100%;font-family:ui-monospace,Consolas,monospace">${esc(s.seo_analytics_head || "")}</textarea>
          <p class="muted">Injected into &lt;head&gt; on public pages only. Paste your Google Analytics or Tag Manager snippet.</p>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:1rem">
      <h3 style="margin-top:0">Crawling: robots.txt &amp; sitemap</h3>
      <div class="row" style="align-items:center">
        <label style="display:flex;gap:.5rem;align-items:center;margin:0">
          <input type="checkbox" id="seo_noindex" style="width:auto" ${s.seo_noindex === "1" ? "checked" : ""} />
          Hide the whole site from search engines
        </label>
        <a class="ghost" href="/robots.txt" target="_blank" rel="noopener">View robots.txt</a>
        <a class="ghost" href="/sitemap.xml" target="_blank" rel="noopener">View sitemap.xml</a>
      </div>
      <div class="row">
        <div style="flex:1;min-width:280px">
          <label for="seo_robots_extra">Extra robots.txt rules</label>
          <textarea id="seo_robots_extra" rows="4" style="width:100%;font-family:ui-monospace,Consolas,monospace">${esc(s.seo_robots_extra || "")}</textarea>
          <p class="muted">Added to the generated file, e.g. <code>Disallow: /private</code></p>
        </div>
        <div style="flex:1;min-width:280px">
          <label for="seo_robots_custom">Replace robots.txt completely</label>
          <textarea id="seo_robots_custom" rows="4" style="width:100%;font-family:ui-monospace,Consolas,monospace">${esc(s.seo_robots_custom || "")}</textarea>
          <p class="muted">Leave empty to use the generated file (recommended).</p>
        </div>
      </div>
      <div class="row" style="margin-top:.6rem">
        <button id="save">Save SEO settings</button>
        <button class="ghost" id="ping">Ping search engines</button>
        <button class="ghost" id="reload">Refresh score</button>
      </div>
    </div>`;

  const val = (id) => view.querySelector(`#${id}`)?.value ?? "";

  // Live character counters keep titles and descriptions inside search limits.
  for (const p of pages) {
    const t = view.querySelector(`#t_${p.key}`);
    const d = view.querySelector(`#d_${p.key}`);
    const out = view.querySelector(`#c_${p.key}`);
    const paint = () => {
      const tl = (t.value || p.title).length;
      const dl = (d.value || p.description).length;
      out.textContent = `Title ${tl}/60 · Description ${dl}/160`;
      out.style.color = tl > 60 || dl > 160 ? "var(--danger, #ef4444)" : "";
    };
    t.oninput = paint; d.oninput = paint; paint();
  }

  view.querySelector("#save").onclick = async () => {
    const body = {
      seo_enabled: "1",
      seo_site_url: val("seo_site_url"),
      seo_title_suffix: val("seo_title_suffix"),
      seo_organization_name: val("seo_organization_name"),
      seo_organization_logo: val("seo_organization_logo"),
      seo_locale: val("seo_locale"),
      seo_og_image: val("seo_og_image"),
      seo_twitter_handle: val("seo_twitter_handle"),
      seo_keywords: val("seo_keywords"),
      seo_google_verification: val("seo_google_verification"),
      seo_bing_verification: val("seo_bing_verification"),
      seo_yandex_verification: val("seo_yandex_verification"),
      seo_baidu_verification: val("seo_baidu_verification"),
      seo_pinterest_verification: val("seo_pinterest_verification"),
      seo_analytics_head: val("seo_analytics_head"),
      seo_robots_extra: val("seo_robots_extra"),
      seo_robots_custom: val("seo_robots_custom"),
      seo_noindex: view.querySelector("#seo_noindex").checked ? "1" : "0",
    };
    for (const p of pages) {
      body[`seo_${p.key}_title`] = val(`t_${p.key}`);
      body[`seo_${p.key}_description`] = val(`d_${p.key}`);
    }
    try {
      await api("/api/owner/settings", { method: "PUT", body });
      toast("SEO settings saved");
      renderOwnerSeo(view, { api, esc, toast });
    } catch (e) {
      toast(e.message, true);
    }
  };

  view.querySelector("#reload").onclick = () => renderOwnerSeo(view, { api, esc, toast });

  view.querySelector("#ping").onclick = () => {
    const sitemap = encodeURIComponent(`${data.base || location.origin}/sitemap.xml`);
    window.open("https://search.google.com/search-console/sitemaps", "_blank", "noopener");
    window.open(`https://www.bing.com/webmasters/sitemaps?siteUrl=${encodeURIComponent(data.base || location.origin)}`, "_blank", "noopener");
    toast(`Submit this sitemap in each console: ${decodeURIComponent(sitemap)}`);
  };
}
