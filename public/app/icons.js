/** Inline stroke icons for the admin sidebar (no external icon font needed). */
const svg = (paths) =>
  `<svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const NAV_ICONS = {
  // university admin
  dashboard: svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  members: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 4.5a3.2 3.2 0 0 1 0 7"/><path d="M17.5 14.5A6 6 0 0 1 21 20"/>'),
  display: svg('<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="m10 8 5 2.5-5 2.5z"/>'),
  masters: svg('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M8 7h8M8 11h6"/>'),
  face: svg('<circle cx="12" cy="12" r="9"/><circle cx="9.2" cy="10.2" r=".6" fill="currentColor"/><circle cx="14.8" cy="10.2" r=".6" fill="currentColor"/><path d="M8.6 14.5a4.5 4.5 0 0 0 6.8 0"/>'),
  import: svg('<path d="M12 15V3"/><path d="m8 7 4-4 4 4"/><path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/>'),
  reports: svg('<path d="M3 20h18"/><rect x="5" y="10" width="3.5" height="7" rx="1"/><rect x="10.5" y="6" width="3.5" height="11" rx="1"/><rect x="16" y="13" width="3.5" height="4" rx="1"/>'),
  audit: svg('<path d="M12 3 4 6v5c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V6z"/><path d="m9 12 2 2 4-4"/>'),
  mastersetting: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 14a2 2 0 1 1 0-4 1.6 1.6 0 0 0 1.7-2.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3a2 2 0 1 1 4 0 1.6 1.6 0 0 0 2.6 1.7l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 21 10a2 2 0 1 1 0 4 1.6 1.6 0 0 0-1.6 1z"/>'),
  settings: svg('<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  docs: svg('<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>'),
  // platform owner
  overview: svg('<path d="M4 19V5"/><path d="M4 19h16"/><path d="m7 15 4-5 3 3 5-6"/>'),
  institutes: svg('<path d="M3 21h18"/><path d="M5 21V8l7-4 7 4v13"/><path d="M10 21v-5h4v5"/>'),
  plans: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/>'),
  billing: svg('<path d="M4 4h16v16l-3-2-2 2-3-2-3 2-2-2-3 2z"/><path d="M8 9h8M8 13h5"/>'),
  leads: svg('<path d="M4 5h16v12H8l-4 4z"/><path d="M8 10h8M8 13h5"/>'),
  provisioning: svg('<circle cx="10" cy="8" r="3.2"/><path d="M3.5 20a6.5 6.5 0 0 1 11 -4.7"/><path d="M18 14v6M15 17h6"/>'),
  website: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>'),
  seo: svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/><path d="M8 12.5 10.3 10l2 2L15 8.6"/>'),
  application: svg('<path d="M12 3v10"/><path d="m8 7 4-4 4 4"/><path d="M4 14v4a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-4"/><path d="M8 17h8"/>'),
  platform: svg('<path d="M12 3 4 6v5c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V6z"/><circle cx="12" cy="11" r="2.2"/>'),
};

export const navIcon = (key) => NAV_ICONS[key] ?? NAV_ICONS.docs;
