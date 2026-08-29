import { api, clearToken, getInstitute, setInstitute, toast, esc, fmtDate, downloadCsv, setTimezone, setServerTimezone } from "/app/api.js";
import { renderDashboard } from "/app/pages/dashboard.js";
import { renderMembers } from "/app/pages/members.js";
import { renderImport } from "/app/pages/import.js";
import { renderReports } from "/app/pages/reports.js";
import { renderSettings } from "/app/pages/settings.js";
import { renderMasters } from "/app/pages/masters.js";
import { renderInstitutes } from "/app/pages/institutes.js";
import { renderAudit } from "/app/pages/audit.js";
import { renderMasterSetting } from "/app/pages/master-setting.js";
import { renderOwnerOverview } from "/app/pages/owner-overview.js";
import { renderOwnerTenants } from "/app/pages/owner-tenants.js";
import { renderOwnerPlans } from "/app/pages/owner-plans.js";
import { renderOwnerBilling } from "/app/pages/owner-billing.js";
import { renderOwnerLeads } from "/app/pages/owner-leads.js";
import { renderOwnerSettings } from "/app/pages/owner-settings.js";
import { renderOwnerSite } from "/app/pages/owner-site.js";
import { renderOwnerSeo } from "/app/pages/owner-seo.js";
import { renderOwnerUpdate } from "/app/pages/owner-update.js";
import { renderOwnerDocs, renderAdminDocs } from "/app/pages/docs.js";
import { mountThemeToggle, mountTextSize, initAppearance } from "/app/theme.js";
import { navIcon } from "/app/icons.js";

export const state = { me: null, institutes: [], institute: null, access: null };

// Never let the browser restore an old scroll position when switching pages —
// otherwise returning to #settings can drop the view back onto the Appearance
// panel instead of the top (Kiosk branding).
if ("scrollRestoration" in history) history.scrollRestoration = "manual";

/** True when the signed-in account may use a module in the active university. */
export const can = (moduleKey) => {
  const a = state.access;
  if (!a) return true;
  return !a.modules || a.modules.includes(moduleKey);
};
export const canWrite = () => !state.access?.viewer_only;
export const canExport = () => state.access?.allow_export !== false;
export const canBulk = () => state.access?.allow_bulk_upload !== false;
export const isInstituteAdmin = () => state.access?.admin !== false;
export const ctx = { api, toast, esc, fmtDate, downloadCsv };

/** University-side pages (never available to the platform owner). */
const TENANT_PAGES = {
  dashboard: { title: "Dashboard", subtitle: "Live occupancy and today's footfall", render: renderDashboard },
  members: { title: "Members", subtitle: "Students and staff registered for library access", render: renderMembers },
  masters: { title: "Master data", subtitle: "Courses, departments and academic years", render: renderMasters },
  import: { title: "Bulk import", subtitle: "Upload members from an Excel or CSV file", render: renderImport },
  reports: { title: "Reports", subtitle: "Visit, student, course, footfall, absentee and location reports with export", render: renderReports },
  audit: { title: "Audit trail", subtitle: "Every administrative action, append-only", render: renderAudit },
  mastersetting: { title: "Master setting", subtitle: "Sublibraries, sublibrary users, module and kiosk-wise permissions", render: renderMasterSetting },
  settings: { title: "Kiosk settings", subtitle: "Branding and input methods for your kiosk", render: renderSettings },
  docs: { title: "Documentation", subtitle: "Complete guide for university administrators", render: renderAdminDocs },
};

/** Platform-owner pages (business data only — no university records). */
const OWNER_PAGES = {
  overview: { title: "Platform overview", subtitle: "Business health at a glance", render: renderOwnerOverview },
  institutes: { title: "Universities", subtitle: "Registrations, subscriptions and access control", render: renderOwnerTenants },
  plans: { title: "Plans", subtitle: "Subscription packages, limits and pricing", render: renderOwnerPlans },
  billing: { title: "Payments & accounting", subtitle: "Invoices, collections, dues and tax", render: renderOwnerBilling },
  leads: { title: "Leads (CRM)", subtitle: "Enquiries, follow-ups and conversions", render: renderOwnerLeads },
  provisioning: { title: "Provision access", subtitle: "Create universities and issue admin logins", render: renderInstitutes },
  website: { title: "Website", subtitle: "Public home & contact pages, branding and custom HTML/CSS", render: renderOwnerSite },
  seo: { title: "SEO", subtitle: "Rank the public site on Google, Bing and other search engines", render: renderOwnerSeo },
  application: { title: "Application management", subtitle: "Update the application, database upgrades, version and restart", render: renderOwnerUpdate },
  platform: { title: "System settings", subtitle: "Company, invoicing, email and audit trail", render: renderOwnerSettings },
  docs: { title: "Documentation", subtitle: "Complete guide for the platform owner", render: renderOwnerDocs },
};

/** Which permission module each university page belongs to. */
const PAGE_MODULE = {
  dashboard: "dashboard",
  members: "members",
  masters: "master_data",
  import: "members",
  reports: "reports",
  audit: "audit",
  settings: "kiosks",
  mastersetting: "master_setting",
};

/** Hide pages the account is not allowed to open. */
function visiblePages() {
  if (state.me?.is_platform_owner) return OWNER_PAGES;
  const out = {};
  for (const [key, page] of Object.entries(TENANT_PAGES)) {
    const mod = PAGE_MODULE[key];
    if (!mod) { out[key] = page; continue; }
    if (!can(mod)) continue;
    if (key === "mastersetting" && !isInstituteAdmin()) continue;
    if (key === "import" && (!canBulk() || !canWrite())) continue;
    out[key] = page;
  }
  return out;
}

let PAGES = TENANT_PAGES;

const view = document.getElementById("view");

function buildNav() {
  const nav = document.getElementById("nav");
  nav.innerHTML = "";
  for (const [key, page] of Object.entries(PAGES)) {
    const a = document.createElement("a");
    a.innerHTML = `${navIcon(key)}<span class="nav-label">${esc(page.title)}</span>`;
    a.title = page.title;
    a.dataset.page = key;
    a.onclick = () => navigate(key);
    nav.appendChild(a);
  }
}

/** Collapse the sidebar to an icon rail; the choice is remembered per browser. */
const COLLAPSE_KEY = "ler_nav_collapsed";
function mountSidebarToggle() {
  const btn = document.getElementById("navToggle");
  if (!btn) return;
  const paint = () => {
    const on = document.body.classList.contains("nav-collapsed");
    btn.textContent = on ? "»" : "«";
    btn.title = on ? "Expand menu" : "Collapse menu";
    btn.setAttribute("aria-label", btn.title);
  };
  document.body.classList.toggle("nav-collapsed", localStorage.getItem(COLLAPSE_KEY) === "1");
  paint();
  btn.onclick = () => {
    const on = document.body.classList.toggle("nav-collapsed");
    localStorage.setItem(COLLAPSE_KEY, on ? "1" : "0");
    paint();
  };
}



export function navigate(key) {
  const page = PAGES[key] ?? Object.values(PAGES)[0];
  key = PAGES[key] ? key : Object.keys(PAGES)[0];

  location.hash = key;
  document.getElementById("pageTitle").textContent = page.title;
  const sub = document.getElementById("pageSubtitle");
  if (sub) sub.textContent = page.subtitle;
  document.getElementById("pageActions").innerHTML = "";
  for (const a of document.querySelectorAll("#nav a")) a.classList.toggle("active", a.dataset.page === key);
  view.innerHTML = `<p class="muted">Loading…</p>`;
  // Always land at the top of the page so long lists don't keep the old scroll.
  const toTop = () => {
    window.scrollTo(0, 0);
    document.querySelector(".main")?.scrollTo(0, 0);
  };
  toTop();
  Promise.resolve(page.render(view, ctx)).then(() => {
    toTop();
    // Defer one frame so the new content's layout is final and any browser
    // scroll restoration has already been overridden — guarantees the view
    // starts at Kiosk branding, not partway down at Appearance.
    requestAnimationFrame(() => requestAnimationFrame(toTop));
  }).catch((e) => {
    view.innerHTML = `<div class="panel"><p style="color:var(--danger)">${esc(e.message)}</p></div>`;
  });
}

function buildInstitutePicker() {
  const select = document.getElementById("instituteSelect");
  select.innerHTML = state.institutes
    .map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`)
    .join("") || `<option value="">No university yet</option>`;
  if (state.institute) select.value = state.institute.id;
  select.onchange = async () => {
    setInstitute(select.value);
    state.institute = state.institutes.find((i) => i.id === select.value) ?? null;
    try {
      state.access = await api("/api/users/me/access");
    } catch {
      state.access = null;
    }
    PAGES = visiblePages();
    buildNav();
    navigate(location.hash.slice(1) || Object.keys(PAGES)[0] || "dashboard");
  };
}

const active = (inst) => {
  const day = new Date().toISOString().slice(0, 10);
  return inst && inst.subscription_start <= day && inst.subscription_end >= day;
};

async function boot() {
  let me;
  try {
    me = await api("/api/auth/me");
  } catch {
    location.href = "/login";
    return;
  }
  state.me = me.user;
  state.institutes = me.institutes;
  const saved = getInstitute();
  state.institute = me.institutes.find((i) => i.id === saved) ?? me.institutes[0] ?? null;
  if (state.institute) setInstitute(state.institute.id);

  document.getElementById("whoami").textContent =
    `${me.user.email}${me.user.is_platform_owner ? " · Platform owner" : ""}`;
  document.getElementById("signout").onclick = () => {
    clearToken();
    location.href = "/login";
  };

  initAppearance();
  mountSidebarToggle();
  mountThemeToggle(document.getElementById("themeToggle"));
  mountTextSize(document.getElementById("textSize"));

  const owner = !!state.me.is_platform_owner;
  PAGES = owner ? OWNER_PAGES : TENANT_PAGES;

  const picker = document.getElementById("instituteSelect");
  if (owner) {
    buildNav();
    // The owner never operates inside a university, so no tenant switcher.
    document.querySelector('label[for="instituteSelect"]')?.remove();
    picker.remove();
    navigate(location.hash.slice(1) || "overview");
    return;
  }

  buildInstitutePicker();
  buildNav();

  if (!state.institute) {
    view.innerHTML = `<div class="panel"><h3>No university assigned</h3>
      <p class="muted">Ask the platform owner to attach your login to a university.</p></div>`;
    return;
  }
  if (!active(state.institute)) {
    view.innerHTML = `<div class="panel"><h3>Subscription expired</h3>
      <p class="muted">${esc(state.institute.name)}'s subscription ended on ${esc(state.institute.subscription_end)}.
      Contact the platform owner to renew.</p></div>`;
    return;
  }
  // What this account may see and do inside the active university.
  try {
    state.access = await api("/api/users/me/access");
  } catch {
    state.access = null;
  }
  PAGES = visiblePages();
  buildNav();

  // Load the university's local time zone so every date on screen uses it.
  try {
    const ks = await api("/api/settings/kiosk");
    setServerTimezone(ks?.server_timezone);
    setTimezone(ks?.timezone);
  } catch {
    /* falls back to the stored/default zone */
  }

  navigate(location.hash.slice(1) || Object.keys(PAGES)[0] || "dashboard");
}


boot();
