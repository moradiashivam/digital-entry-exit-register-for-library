/**
 * Documentation page. The same module serves both roles — the content is
 * chosen from the signed-in user's role so the owner never sees university
 * operating instructions and vice versa.
 */

const OWNER_DOCS = [
  {
    id: "owner-start",
    title: "Getting started as platform owner",
    body: `
      <p>The platform owner account is created by <code>setup.bat</code> (or <code>npm run setup</code>)
      from <code>OWNER_EMAIL</code> and <code>OWNER_PASSWORD</code> in the <code>.env</code> file.
      Sign in at <code>http://&lt;server&gt;:4000/</code>.</p>
      <p>The owner console is a <strong>business</strong> console: universities, plans, invoices, leads and
      system settings. By design it cannot open any university's members, scan logs or reports — that data
      belongs to the campus. If you need to see a campus screen, ask that university's admin.</p>
      <ul>
        <li><strong>Platform overview</strong> — revenue, active/expiring subscriptions, tenant growth.</li>
        <li><strong>Universities</strong> — subscription window, plan, status (Active / Suspended).</li>
        <li><strong>Plans</strong> — packages, member limits and pricing.</li>
        <li><strong>Payments &amp; accounting</strong> — invoices, collections, dues, tax.</li>
        <li><strong>Leads (CRM)</strong> — enquiries, follow-ups, conversion to a university.</li>
        <li><strong>Provision access</strong> — create a university and issue its admin login.</li>
        <li><strong>System settings</strong> — company details, invoice numbering, SMTP, audit.</li>
      </ul>`,
  },
  {
    id: "owner-install",
    title: "Installing the app (Windows, Linux, macOS)",
    body: `
      <p><strong>Requirements:</strong> MySQL 8 or MariaDB 10.5+ (XAMPP/WAMP/MySQL Installer all work) and
      Node.js 18 or newer.</p>
      <h4>Windows (fastest path)</h4>
      <ol>
        <li>Copy the whole <code>mysql-app</code> folder to the server machine.</li>
        <li>Start MySQL (in XAMPP click <strong>Start</strong> next to MySQL).</li>
        <li>Double-click <code>setup.bat</code>. The first run creates <code>.env</code>.</li>
        <li>Open <code>.env</code> and set:
          <ul>
            <li><code>DB_HOST</code>, <code>DB_USER</code>, <code>DB_PASSWORD</code>, <code>DB_NAME</code>
              (leave the password empty for a default XAMPP install)</li>
            <li><code>OWNER_EMAIL</code> / <code>OWNER_PASSWORD</code> — your platform owner login</li>
            <li><code>JWT_SECRET</code> — a long random string (also encrypts stored SMTP credentials)</li>
            <li><code>PORT</code> — defaults to 4000</li>
          </ul>
        </li>
        <li>Run <code>setup.bat</code> again — it creates the database, all tables and the owner account.</li>
        <li>Double-click <code>start.bat</code> and open <code>http://localhost:4000/</code>.</li>
      </ol>
      <h4>Linux / macOS</h4>
      <pre><code>cd mysql-app
cp .env.example .env     # then edit it
npm install
npm run setup            # creates database + owner account
npm start                # http://localhost:4000</code></pre>
      <h4>Fresh database in one file</h4>
      <p>If you prefer to load the schema yourself (e.g. in phpMyAdmin), use the consolidated file
      <code>mysql-app/db/database.sql</code> — it contains every table with no follow-up migrations.
      Re-running it is safe.</p>
      <h4>Running as a service / on a VPS</h4>
      <ul>
        <li>Keep MySQL bound to <code>127.0.0.1</code> and put the app behind Nginx or Caddy with HTTPS.</li>
        <li>On Windows allow Node.js through the firewall so other PCs can reach
          <code>http://&lt;server-ip&gt;:4000</code>.</li>
        <li>Use <code>pm2</code>, <code>systemd</code> or NSSM to keep <code>npm start</code> running after reboot.</li>
      </ul>
      <h4>Upgrading</h4>
      <p>Back up first, copy the new files over, run <code>npm install</code>, then start the server —
      new columns and tables are applied automatically on boot.</p>`,
  },
  {
    id: "owner-stack",
    title: "Technology stack and architecture",
    body: `
      <table class="doc-table">
        <tr><th>Layer</th><th>Technology</th></tr>
        <tr><td>Runtime</td><td>Node.js 18+ (ES modules)</td></tr>
        <tr><td>Web server / API</td><td>Express 4 with CORS</td></tr>
        <tr><td>Database</td><td>MySQL 8 / MariaDB 10.5+ via <code>mysql2</code> connection pool</td></tr>
        <tr><td>Authentication</td><td>JWT bearer tokens (<code>jsonwebtoken</code>), passwords hashed with bcrypt</td></tr>
        <tr><td>Email</td><td>Nodemailer over your own SMTP server</td></tr>
        <tr><td>Encryption</td><td>AES-256-GCM for stored SMTP credentials, key derived from <code>JWT_SECRET</code></td></tr>
        <tr><td>Frontend</td><td>Plain HTML + CSS + ES-module JavaScript — no build step, no bundler</td></tr>
        <tr><td>Palm hardware</td><td>Separate C++ bridge on the kiosk PC using the vendor SDK</td></tr>
      </table>
      <h4>How the pieces fit</h4>
      <pre><code>Kiosk PC ──(palm SDK, C++ bridge)──┐
Browser kiosk page ────────────────┼──&gt; Node/Express API ──&gt; MySQL
Admin console (browser) ───────────┘</code></pre>
      <p>Biometric templates never leave the kiosk PC; the bridge matches locally and posts only the member
      code to <code>POST /api/public/scan-event</code> with the university's kiosk key.</p>
      <h4>Folder map</h4>
      <ul>
        <li><code>src/server.js</code> — app bootstrap and static hosting</li>
        <li><code>src/routes/</code> — auth, members, masters, reports, settings, owner, public scan API</li>
        <li><code>src/db.js</code> — pool plus automatic schema upgrades on start</li>
        <li><code>db/</code> — <code>schema.sql</code>, <code>platform.sql</code>, consolidated <code>database.sql</code></li>
        <li><code>public/</code> — admin console, kiosk page, login/reset pages</li>
        <li><code>docs/</code> — these guides in markdown</li>
      </ul>
      <h4>Security model</h4>
      <ul>
        <li>Every API call is checked against the signed-in user's university — campuses cannot see each other.</li>
        <li>The platform owner is a business role: no access to members, scans or reports.</li>
        <li>External scan requests must present the university's kiosk key; browser kiosk pages are same-origin.</li>
        <li>Expired or suspended subscriptions block both admin access and kiosk scans.</li>
      </ul>`,
  },
  {
    id: "owner-provision",
    title: "Creating a university and its admin login",
    body: `
      <ol>
        <li>Open <strong>Provision access</strong>.</li>
        <li>Fill the university name and a kiosk link slug (lower-case, no spaces — e.g. <code>vidya</code>).
          The kiosk URL becomes <code>http://&lt;server&gt;:4000/kiosk/vidya</code>.</li>
        <li>Set the subscription start and end dates, then <strong>Create university</strong>.</li>
        <li>On the new row click <strong>Admin logins</strong> and issue the university's first
          <em>super admin</em> email and password. Share it with the librarian in charge.</li>
        <li>Give them the kiosk URL and, if a hardware palm bridge is used, the <strong>kiosk key</strong>
          from the same row.</li>
      </ol>
      <p><strong>Rotate</strong> replaces the kiosk key immediately — every external bridge must be updated
      with the new key. <strong>Reset</strong> sends/sets a new password for that university admin.</p>`,
  },
  {
    id: "owner-subs",
    title: "Subscriptions, suspension and expiry",
    body: `
      <p>Every university has a start and end date. When today's date falls outside that window:</p>
      <ul>
        <li>The university admin sees a "Subscription expired" screen instead of the dashboard.</li>
        <li>The kiosk stops accepting scans for that campus.</li>
      </ul>
      <p>Extend the window from <strong>Universities</strong> → edit the subscription dates, or record a
      payment in <strong>Payments &amp; accounting</strong> which also renews the period. Setting status to
      <em>Suspended</em> blocks access immediately regardless of dates. A nightly job flags subscriptions
      expiring soon and emails the contact when SMTP is configured.</p>`,
  },
  {
    id: "owner-billing",
    title: "Plans, payments and invoices",
    body: `
      <p>Create packages in <strong>Plans</strong> (name, price, billing period, member limit). Assign a plan
      to a university from <strong>Universities</strong>.</p>
      <p>In <strong>Payments &amp; accounting</strong> record each payment against a university: amount, tax,
      mode, reference and the period it covers. The page totals collections and outstanding dues and produces
      a printable invoice using the company details and invoice prefix from <strong>System settings</strong>.</p>`,
  },
  {
    id: "owner-crm",
    title: "Leads and conversion",
    body: `
      <p><strong>Leads (CRM)</strong> keeps enquiries with contact details, stage and follow-up notes. When a
      lead signs, use <strong>Convert</strong> — it creates the university, carries the contact details over
      and opens the provisioning step so you can issue the admin login in one flow.</p>`,
  },
  {
    id: "owner-system",
    title: "System settings, email and backups",
    body: `
      <p><strong>System settings</strong> holds the company profile printed on invoices, the invoice number
      prefix, and the SMTP server used for password resets and expiry notices. SMTP credentials are stored
      encrypted (AES-256-GCM) with the key derived from <code>JWT_SECRET</code> — changing that secret
      invalidates stored credentials and existing sessions.</p>
      <p>Back up regularly:</p>
      <pre><code>mysqldump -u root -p library_register &gt; backup-YYYYMMDD.sql
mysql -u root -p library_register &lt; backup-YYYYMMDD.sql</code></pre>`,
  },
  {
    id: "owner-trouble",
    title: "Troubleshooting",
    body: `
      <ul>
        <li><strong>Admin cannot sign in</strong> — check the account status is Active and the subscription
          window covers today; then use <strong>Reset</strong> on that login.</li>
        <li><strong>Kiosk says "not allowed"</strong> — subscription expired or status Suspended.</li>
        <li><strong>External palm bridge gets 401</strong> — the kiosk key was rotated; update the bridge's
          <code>KIOSK_KEY</code>.</li>
        <li><strong>No emails</strong> — SMTP host/port/credentials in System settings; use the test button.</li>
        <li><strong>Server won't start</strong> — MySQL is not running, or <code>DB_PASSWORD</code> in
          <code>.env</code> is wrong.</li>
      </ul>`,
  },
];

const ADMIN_DOCS = [
  {
    id: "admin-start",
    title: "Getting started as university admin",
    body: `
      <p>Sign in with the email and password issued by the platform owner. The sidebar is your whole workflow:</p>
      <ul>
        <li><strong>Dashboard</strong> — who is inside right now and today's footfall.</li>
        <li><strong>Members</strong> — add, edit, block, and enroll palm/RFID identities.</li>
        <li><strong>Master data</strong> — courses, departments, academic years.</li>
        <li><strong>Bulk import</strong> — load members from Excel/CSV.</li>
        <li><strong>Reports</strong> — the entry/exit register, calendar, export and print.</li>
        <li><strong>Audit trail</strong> — every administrative action, append-only.</li>
        <li><strong>Kiosk settings</strong> — branding, input methods, theme and custom CSS.</li>
      </ul>
      <p>Roles: <em>super admin</em> (everything), <em>librarian</em> (members, kiosk, reports),
      <em>report viewer</em> (read-only). Use the theme button at the bottom of the sidebar to switch
      between light and dark; the choice is saved in your browser.</p>`,
  },
  {
    id: "admin-setup",
    title: "First-time setup order",
    body: `
      <ol>
        <li><strong>Master data</strong> first — add your courses, departments and academic years. Imports and
          report filters match against these lists.</li>
        <li><strong>Kiosk settings</strong> — university name, logo URL, welcome text, which input methods are
          enabled (Palm / RFID / Manual), theme and any custom CSS.</li>
        <li><strong>Members</strong> — bulk import the roll list, then fix up individual records.</li>
        <li>Open the kiosk URL on the entrance PC and leave it full-screen.</li>
      </ol>`,
  },
  {
    id: "admin-members",
    title: "Managing members",
    body: `
      <p>Each member needs a unique <strong>member code</strong> (roll number or staff ID) — this is what the
      kiosk and the palm bridge use to identify them. Other fields: full name, gender, course, department,
      academic year, photo URL, RFID card UID, membership valid-from/valid-to and status.</p>
      <ul>
        <li><strong>Blocked</strong> or <strong>expired</strong> members are refused at the kiosk and no entry
          is written to the register — the attempt is kept only in the failed-scan log.</li>
        <li>The photo URL is shown on the kiosk when the scan succeeds, so staff can visually confirm.</li>
        <li>Palm enrollment binds a captured template to the member code; the biometric template itself never
          leaves the kiosk PC — only a reference hash is stored.</li>
      </ul>`,
  },
  {
    id: "admin-import",
    title: "Bulk import from Excel or CSV",
    body: `
      <p>Download the sample file from <strong>Bulk import</strong> and keep the column headers. Typical
      columns: <code>member_code, full_name, gender, course, department, academic_year, email, phone,
      rfid_uid, valid_from, valid_to</code>.</p>
      <ul>
        <li>Dates use <code>YYYY-MM-DD</code>.</li>
        <li>Course / department / year values must exist in Master data (add them first).</li>
        <li>Rows with an existing member code update that member instead of duplicating it.</li>
        <li>The import result lists every rejected row with the reason — fix and re-upload just those rows.</li>
      </ul>`,
  },
  {
    id: "admin-kiosk",
    title: "The kiosk screen",
    body: `
      <p>Your kiosk lives at <code>http://&lt;server&gt;:4000/kiosk/&lt;your-slug&gt;</code>. It shows the
      university name, logo, live clock and a result panel after each scan.</p>
      <ul>
        <li><strong>Palm</strong> — the on-site bridge program matches locally and posts the member code.</li>
        <li><strong>RFID</strong> — the card reader types the UID into the field and submits.</li>
        <li><strong>Manual</strong> — staff type the member code (useful when a card is forgotten).</li>
      </ul>
      <p>Entry and Exit toggle automatically: if the member's last event was an Entry, the next scan is an
      Exit. Expired memberships show a "Membership expired — renew" panel and are not registered.</p>`,
  },
  {
    id: "admin-branding",
    title: "Branding and custom CSS",
    body: `
      <p>In <strong>Kiosk settings</strong> pick a colour mode (light/dark), set the logo and welcome message,
      and optionally paste custom CSS. Save, then refresh the kiosk with <kbd>Ctrl</kbd>+<kbd>F5</kbd>.
      The live preview on the settings page reloads automatically after each save.</p>
      <p>Stable class hooks you can target:</p>
      <pre><code>.kiosk, .kiosk-card, .kiosk-logo, .kiosk-institution, .kiosk-title,
.kiosk-clock, .kiosk-welcome, .kiosk-tabs button, .kiosk-form, .kiosk-input,
.kiosk-result, .result.entry, .result.exit, .result.expired, .result.bad, .kiosk-footer</code></pre>
      <p>Example:</p>
      <pre><code>.kiosk-card { background: #0b3d2e; border-radius: 24px; }
.kiosk-institution { letter-spacing: .08em; text-transform: uppercase; }</code></pre>
      <p>The <strong>Appearance</strong> box in settings changes the admin console accent colour and dark mode
      for your browser only — it does not affect the kiosk.</p>`,
  },
  {
    id: "admin-reports",
    title: "Reports, calendar and printing",
    body: `
      <p><strong>Reports</strong> lists the entry/exit register with filters for date range, course,
      department, year, gender and member. The month calendar shows how many records each day holds — click a
      date to load just that day.</p>
      <ul>
        <li><strong>Choose columns</strong> — untick anything you do not want (for example Device); the choice
          applies to the table, the CSV export and the printout, and is remembered.</li>
        <li><strong>Export CSV</strong> — opens in Excel.</li>
        <li><strong>Print / PDF</strong> — opens a clean A4 landscape register in a new window; use the
          browser's "Save as PDF". Allow pop-ups for the site if nothing opens.</li>
      </ul>`,
  },
  {
    id: "admin-dashboard",
    title: "Reading the dashboard",
    body: `
      <p>The dashboard refreshes every 15 seconds and shows currently-inside members with visit duration,
      entries and exits today, average visit length, peak hour, gender / department / course footfall, the
      hourly chart and a 14-day trend.</p>
      <p>Occupancy uses a 48-hour pairing window, so a member who entered before midnight and left after it is
      still matched correctly instead of appearing as stuck inside.</p>`,
  },
  {
    id: "admin-trouble",
    title: "Troubleshooting",
    body: `
      <ul>
        <li><strong>"Subscription expired"</strong> — contact the platform owner to renew.</li>
        <li><strong>Kiosk rejects a valid member</strong> — check status is Active and valid-to is in the
          future; the Audit trail and failed-scan log record the reason.</li>
        <li><strong>Custom CSS not visible</strong> — save again, then hard-refresh the kiosk with
          <kbd>Ctrl</kbd>+<kbd>F5</kbd>.</li>
        <li><strong>Import rejected rows</strong> — nearly always a missing course/department/year in Master
          data or a wrong date format.</li>
        <li><strong>Empty charts</strong> — no scans recorded yet for the selected day.</li>
      </ul>`,
  },
];

function renderDocs(view, esc, sections, intro) {
  view.innerHTML = `
    <div class="panel-head">
      <h3 style="margin:0">Documentation</h3>
      <p class="muted">${esc(intro)}</p>
    </div>
    <div class="docs-layout">
      <nav class="panel docs-toc">
        ${sections.map((s) => `<a href="#/doc/${s.id}" data-doc="${s.id}">${esc(s.title)}</a>`).join("")}
      </nav>
      <div class="docs-body">
        ${sections.map((s) => `
          <section class="panel doc-section" id="${s.id}">
            <h3>${esc(s.title)}</h3>
            ${s.body}
          </section>`).join("")}
      </div>
    </div>`;

  for (const link of view.querySelectorAll("[data-doc]")) {
    link.onclick = (e) => {
      e.preventDefault();
      view.querySelector(`#${link.dataset.doc}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      for (const l of view.querySelectorAll("[data-doc]")) l.classList.toggle("active", l === link);
    };
  }
}

export function renderOwnerDocs(view, { esc }) {
  renderDocs(view, esc, OWNER_DOCS, "How to run the platform: universities, subscriptions, billing and support.");
}

export function renderAdminDocs(view, { esc }) {
  renderDocs(view, esc, ADMIN_DOCS, "How to run your library register: members, kiosk, reports and branding.");
}
