import { api, clearToken, getInstitute, setInstitute, toast, esc, fmtDate, downloadCsv, setTimezone, setServerTimezone } from "/app/api.js";
import { renderDashboard } from "/app/pages/dashboard.js";
import { renderMembers } from "/app/pages/members.js";
import { renderImport } from "/app/pages/import.js";
import { renderReports } from "/app/pages/reports.js";
import { renderSettings } from "/app/pages/settings.js";
import { renderMasters } from "/app/pages/masters.js";
import { renderInstitutes } from "/app/pages/institutes.js";
import { renderAudit } from "/app/pages/audit.js";
import { renderOwnerOverview } from "/app/pages/owner-overview.js";
import { renderOwnerTenants } from "/app/pages/owner-tenants.js";
import { renderOwnerPlans } from "/app/pages/owner-plans.js";
import { renderOwnerBilling } from "/app/pages/owner-billing.js";
import { renderOwnerLeads } from "/app/pages/owner-leads.js";
import { renderOwnerSettings } from "/app/pages/owner-settings.js";
import { renderOwnerSite } from "/app/pages/owner-site.js";
import { renderOwnerDocs, renderAdminDocs } from "/app/pages/docs.js";
import { mountThemeToggle, initAppearance } from "/app/theme.js";

export const state = { me: null, institutes: [], institute: null };
export const ctx = { api, toast, esc, fmtDate, downloadCsv };

/** University-side pages (never available to the platform owner). */
const TENANT_PAGES = {
  dashboard: { title: "Dashboard", subtitle: "Live occupancy and today's footfall", render: renderDashboard },
  members: { title: "Members", subtitle: "Students and staff registered for library access", render: renderMembers },
  masters: { title: "Master data", subtitle: "Courses, departments and academic years", render: renderMasters },
  import: { title: "Bulk import", subtitle: "Upload members from an Excel or CSV file", render: renderImport },
  reports: { title: "Reports", subtitle: "Entry / exit register with filters and export", render: renderReports },
  audit: { title: "Audit trail", subtitle: "Every administrative action, append-only", render: renderAudit },
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
  platform: { title: "System settings", subtitle: "Company, invoicing, email and audit trail", render: renderOwnerSettings },
  docs: { title: "Documentation", subtitle: "Complete guide for the platform owner", render: renderOwnerDocs },
};

let PAGES = TENANT_PAGES;

const view = document.getElementById("view");

function buildNav() {
  const nav = document.getElementById("nav");
  nav.innerHTML = "";
  for (const [key, page] of Object.entries(PAGES)) {
    const a = document.createElement("a");
    a.textContent = page.title;
    a.dataset.page = key;
    a.onclick = () => navigate(key);
    nav.appendChild(a);
  }
}


export function navigate(key) {
  const page = PAGES[key] ?? Object.values(PAGES)[0];
  key = PAGES[key] ? key : Object.keys(PAGES)[0];

  location.hash = key;
  document.getElementById("pageTitle").textContent = page.title;
  document.getElementById("pageSubtitle").textContent = page.subtitle;
  document.getElementById("pageActions").innerHTML = "";
  for (const a of document.querySelectorAll("#nav a")) a.classList.toggle("active", a.dataset.page === key);
  view.innerHTML = `<p class="muted">Loading…</p>`;
  Promise.resolve(page.render(view, ctx)).catch((e) => {
    view.innerHTML = `<div class="panel"><p style="color:var(--danger)">${esc(e.message)}</p></div>`;
  });
}

function buildInstitutePicker() {
  const select = document.getElementById("instituteSelect");
  select.innerHTML = state.institutes
    .map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`)
    .join("") || `<option value="">No university yet</option>`;
  if (state.institute) select.value = state.institute.id;
  select.onchange = () => {
    setInstitute(select.value);
    state.institute = state.institutes.find((i) => i.id === select.value) ?? null;
    navigate(location.hash.slice(1) || "dashboard");
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
  mountThemeToggle(document.getElementById("themeToggle"));

  const owner = !!state.me.is_platform_owner;
  PAGES = owner ? OWNER_PAGES : TENANT_PAGES;
  buildNav();

  const picker = document.getElementById("instituteSelect");
  if (owner) {
    // The owner never operates inside a university, so no tenant switcher.
    document.querySelector('label[for="instituteSelect"]')?.remove();
    picker.remove();
    navigate(location.hash.slice(1) || "overview");
    return;
  }

  buildInstitutePicker();

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
  // Load the university's local time zone so every date on screen uses it.
  try {
    const ks = await api("/api/settings/kiosk");
    setServerTimezone(ks?.server_timezone);
    setTimezone(ks?.timezone);
  } catch {
    /* falls back to the stored/default zone */
  }

  navigate(location.hash.slice(1) || "dashboard");
}


boot();
