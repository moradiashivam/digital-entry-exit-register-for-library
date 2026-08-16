/**
 * Shared bootstrap for the public marketing pages.
 * Applies the platform owner's branding and, when enabled, their fully
 * custom HTML/CSS for the home and contact pages.
 */
export async function loadSite(page) {
  let site = {};
  try {
    const res = await fetch("/api/public/site", { headers: { Accept: "application/json" } });
    if (res.ok) site = await res.json();
  } catch {
    /* offline / API down — the built-in design stays visible */
  }

  const brand = site.brand || "Library Entry & Exit Register";
  for (const el of document.querySelectorAll("[data-site-brand]")) el.textContent = brand;
  for (const el of document.querySelectorAll("[data-site-tagline]")) {
    if (site.tagline) el.textContent = site.tagline;
  }
  for (const el of document.querySelectorAll("[data-site-email]")) {
    el.textContent = site.contact_email || "sales@example.com";
    if (el.tagName === "A") el.href = `mailto:${site.contact_email || ""}`;
  }
  for (const el of document.querySelectorAll("[data-site-phone]")) {
    el.textContent = site.contact_phone || "—";
    if (el.tagName === "A") el.href = `tel:${site.contact_phone || ""}`;
  }
  for (const el of document.querySelectorAll("[data-site-address]")) {
    el.textContent = site.contact_address || "";
  }

  const css = page === "home" ? site.home_css : site.contact_css;
  const html = page === "home" ? site.home_html : site.contact_html;

  if (site.custom_enabled && (html || css)) {
    if (html) {
      const host = document.getElementById("customSlot") || document.getElementById("page");
      if (host) host.innerHTML = html;
    }
    if (css) {
      const style = document.createElement("style");
      style.id = "ownerCss";
      style.textContent = css;
      document.head.appendChild(style);
    }
  }
  document.body.dataset.siteReady = "1";
  return site;
}

/** Pointer-driven 3D tilt for the hero stack (skipped on touch/small screens). */
export function initTilt(selector = ".card3d") {
  const card = document.querySelector(selector);
  if (!card || window.matchMedia("(max-width: 620px)").matches) return;
  const stage = card.parentElement;
  stage.addEventListener("pointermove", (e) => {
    const r = stage.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    card.style.setProperty("--ry", `${x * 22 - 6}deg`);
    card.style.setProperty("--rx", `${-y * 18 + 6}deg`);
  });
  stage.addEventListener("pointerleave", () => {
    card.style.setProperty("--ry", "-14deg");
    card.style.setProperty("--rx", "8deg");
  });
}
