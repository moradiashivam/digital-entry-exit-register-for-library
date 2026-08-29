/**
 * Search-engine optimisation for the public marketing pages.
 *
 * The platform owner edits everything from Owner → SEO; the values live in
 * `platform_settings` (keys prefixed `seo_`). Titles, descriptions, canonical
 * links, Open Graph/Twitter cards, verification tags and JSON-LD are injected
 * server-side into the static HTML so crawlers see them without running JS.
 */
import fs from "node:fs/promises";
import { q } from "./db.js";

/** Every setting the owner console may write. */
export const SEO_KEYS = [
  "seo_enabled", "seo_site_url", "seo_title_suffix", "seo_keywords", "seo_og_image",
  "seo_twitter_handle", "seo_organization_name", "seo_organization_logo", "seo_locale",
  "seo_google_verification", "seo_bing_verification", "seo_yandex_verification",
  "seo_baidu_verification", "seo_pinterest_verification", "seo_analytics_head",
  "seo_robots_extra", "seo_robots_custom", "seo_noindex",
  "seo_home_title", "seo_home_description",
  "seo_contact_title", "seo_contact_description",
  "seo_docs_title", "seo_docs_description",
  "seo_developer_title", "seo_developer_description",
];

/** Public pages that get SEO treatment: file, url path, change frequency, priority. */
export const SEO_PAGES = {
  home: { file: "index.html", path: "/", changefreq: "weekly", priority: "1.0", label: "Home" },
  contact: { file: "contact.html", path: "/contact.html", changefreq: "monthly", priority: "0.8", label: "Contact us" },
  docs: { file: "docs.html", path: "/docs.html", changefreq: "monthly", priority: "0.7", label: "Documentation" },
  developer: { file: "developer.html", path: "/developer.html", changefreq: "yearly", priority: "0.4", label: "Developer" },
};

const esc = (v) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Read the SEO settings (plus the brand name used as a fallback). */
export async function getSeoSettings() {
  const rows = await q(
    "SELECT setting_key, setting_value FROM platform_settings WHERE setting_key LIKE 'seo\\_%' OR setting_key IN ('site_brand','platform_name','site_tagline','site_contact_email')",
  );
  return Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value ?? ""]));
}

/** Absolute site URL — the configured one wins, otherwise the current request host. */
export function baseUrl(s, req) {
  const configured = String(s.seo_site_url || "").trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(configured)) return configured;
  const proto = (req?.headers?.["x-forwarded-proto"] || req?.protocol || "http").split(",")[0];
  const host = req?.headers?.["x-forwarded-host"] || req?.headers?.host || "localhost";
  return `${proto}://${host}`;
}

const abs = (base, url) => {
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url : `${base}${url.startsWith("/") ? "" : "/"}${url}`;
};

/** Effective title + description for one page, with sensible fallbacks. */
export function pageMeta(page, s, fallback = {}) {
  const brand = s.site_brand || s.platform_name || "Library Entry & Exit Register";
  const suffix = String(s.seo_title_suffix || "").trim();
  let title = String(s[`seo_${page}_title`] || "").trim() || fallback.title || brand;
  if (suffix && !title.toLowerCase().endsWith(suffix.toLowerCase())) title = `${title} | ${suffix}`;
  const description =
    String(s[`seo_${page}_description`] || "").trim() || fallback.description || s.site_tagline || "";
  return { title, description, brand };
}

/** Pull the existing <title>/description out of the shipped HTML as fallbacks. */
function readFallback(html) {
  const t = html.match(/<title>([\s\S]*?)<\/title>/i);
  const d = html.match(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']\s*\/?>/i);
  return {
    title: t ? t[1].trim() : "",
    description: d ? d[1].trim() : "",
  };
}

/** Build the head block and merge it into the page HTML. */
export function injectSeo(html, page, s, req) {
  if (s.seo_enabled === "0") return html;
  const cfg = SEO_PAGES[page];
  if (!cfg) return html;

  const base = baseUrl(s, req);
  const fb = readFallback(html);
  const { title, description, brand } = pageMeta(page, s, fb);
  const canonical = `${base}${cfg.path}`;
  const image = abs(base, s.seo_og_image || s.seo_organization_logo || "");
  const noindex = s.seo_noindex === "1";

  const tags = [
    `<link rel="canonical" href="${esc(canonical)}" />`,
    `<meta name="robots" content="${noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large, max-snippet:-1"}" />`,
    s.seo_keywords ? `<meta name="keywords" content="${esc(s.seo_keywords)}" />` : "",
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(brand)}" />`,
    `<meta property="og:locale" content="${esc(s.seo_locale || "en_US")}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    description ? `<meta property="og:description" content="${esc(description)}" />` : "",
    `<meta property="og:url" content="${esc(canonical)}" />`,
    image ? `<meta property="og:image" content="${esc(image)}" />` : "",
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    description ? `<meta name="twitter:description" content="${esc(description)}" />` : "",
    image ? `<meta name="twitter:image" content="${esc(image)}" />` : "",
    s.seo_twitter_handle ? `<meta name="twitter:site" content="${esc(s.seo_twitter_handle)}" />` : "",
    s.seo_google_verification ? `<meta name="google-site-verification" content="${esc(s.seo_google_verification)}" />` : "",
    s.seo_bing_verification ? `<meta name="msvalidate.01" content="${esc(s.seo_bing_verification)}" />` : "",
    s.seo_yandex_verification ? `<meta name="yandex-verification" content="${esc(s.seo_yandex_verification)}" />` : "",
    s.seo_baidu_verification ? `<meta name="baidu-site-verification" content="${esc(s.seo_baidu_verification)}" />` : "",
    s.seo_pinterest_verification ? `<meta name="p:domain_verify" content="${esc(s.seo_pinterest_verification)}" />` : "",
  ].filter(Boolean);

  const org = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: s.seo_organization_name || brand,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Windows, Linux, macOS",
    url: base,
    description,
    ...(image ? { image } : {}),
    ...(s.site_contact_email ? { email: s.site_contact_email } : {}),
    publisher: {
      "@type": "Organization",
      name: s.seo_organization_name || brand,
      url: base,
      ...(s.seo_organization_logo ? { logo: abs(base, s.seo_organization_logo) } : {}),
    },
  };
  tags.push(`<script type="application/ld+json">${JSON.stringify(org)}</script>`);
  if (s.seo_analytics_head) tags.push(String(s.seo_analytics_head));

  let out = html;
  out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`);
  if (/<meta\s+name=["']description["'][^>]*>/i.test(out)) {
    out = out.replace(/<meta\s+name=["']description["'][^>]*>/i, `<meta name="description" content="${esc(description)}" />`);
  } else if (description) {
    tags.unshift(`<meta name="description" content="${esc(description)}" />`);
  }
  return out.replace(/<\/head>/i, `  ${tags.join("\n  ")}\n</head>`);
}

/** Serve one marketing page with SEO injected (falls back to the raw file). */
export async function renderPublicPage(filePath, page, req) {
  const html = await fs.readFile(filePath, "utf8");
  try {
    const s = await getSeoSettings();
    return injectSeo(html, page, s, req);
  } catch {
    return html;
  }
}

/** robots.txt — owner override wins, otherwise a sane generated default. */
export function robotsTxt(s, base) {
  if (String(s.seo_robots_custom || "").trim()) return String(s.seo_robots_custom).trim() + "\n";
  if (s.seo_noindex === "1") return `User-agent: *\nDisallow: /\n`;
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /login",
    "Disallow: /kiosk/",
    "Disallow: /api/",
    String(s.seo_robots_extra || "").trim(),
    "",
    `Sitemap: ${base}/sitemap.xml`,
    "",
  ].filter((l) => l !== null).join("\n");
}

/** sitemap.xml covering the public pages only (never admin or kiosk URLs). */
export function sitemapXml(s, base) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = Object.values(SEO_PAGES)
    .map((p) => `  <url>\n    <loc>${esc(base + p.path)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** Simple readiness checks shown as a checklist in the owner console. */
export function seoAudit(s, base) {
  const list = [];
  const add = (ok, label, hint) => list.push({ ok, label, hint });
  add(/^https?:\/\//i.test(String(s.seo_site_url || "")), "Public site URL set",
    "Enter the address search engines should index, e.g. https://register.youruniversity.com");
  add(!!String(s.seo_home_title || "").trim(), "Home page title written", "40–60 characters including your main keyword");
  const d = String(s.seo_home_description || "");
  add(d.length >= 70 && d.length <= 160, "Home description is 70–160 characters", `Currently ${d.length} characters`);
  add(!!String(s.seo_og_image || "").trim(), "Social share image set", "1200×630 image URL used by Google, WhatsApp, LinkedIn");
  add(!!String(s.seo_google_verification || "").trim(), "Google Search Console verified", "Paste the meta verification code from Search Console");
  add(!!String(s.seo_bing_verification || "").trim(), "Bing Webmaster verified", "Paste the msvalidate.01 code from Bing Webmaster Tools");
  add(s.seo_noindex !== "1", "Site is open to crawlers", "Turn off 'Hide from search engines' when you go live");
  add(!!String(s.seo_organization_name || "").trim(), "Organisation name for rich results", "Used in the JSON-LD structured data block");
  const score = Math.round((list.filter((x) => x.ok).length / list.length) * 100);
  return { score, checks: list, base };
}
