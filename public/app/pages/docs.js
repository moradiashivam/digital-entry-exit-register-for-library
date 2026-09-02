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
    id: "owner-update",
    title: "Application updates and version",
    body: `
      <p><strong>Application update</strong> keeps the software current without touching the command line:</p>
      <ul>
        <li><strong>GitHub updates</strong> — set the repository (owner/repo) once; the app checks daily for a
          newer release tag (e.g. v3.9.0 &lt; v3.10.0) and shows it on the update page. <em>Update now</em>
          downloads the release ZIP, applies it, runs new database migrations automatically and restarts —
          with a live log of every step.</li>
        <li><strong>Upload ZIP</strong> — install an update package manually from your computer.</li>
        <li><strong>Installed version</strong> — shown on the Application page and updated automatically after
          each upgrade; you can also set or refresh it manually.</li>
      </ul>
      <p>The server restarts itself after an update; <code>start.bat</code> brings it back up automatically.
      If your server is offline it retries with timeouts instead of crashing on boot.</p>`,
  },
  {
    id: "owner-seo",
    title: "SEO for the public website",
    body: `
      <p><strong>Owner → SEO</strong> controls how the public pages (home, contact, docs, developer) appear in
      search engines:</p>
      <ul>
        <li>Site title, meta description and keywords per page.</li>
        <li>Open Graph / Twitter cards (title, description, share image URL).</li>
        <li>Canonical URL and JSON-LD structured data (Organization).</li>
        <li>Google / Bing / Pinterest verification tags.</li>
        <li>Analytics snippet (Google Analytics or any script) injected on every public page.</li>
        <li>Custom <code>robots.txt</code> rules and a one-click "hide from search engines" switch.</li>
      </ul>
      <p>A readiness audit flags missing titles, descriptions and images. <code>/robots.txt</code> and
      <code>/sitemap.xml</code> are generated automatically from these settings.</p>
      <p>The public site also includes the 3D home page, the <strong>Contact us</strong> page (enquiries land
      directly in Owner → Leads), the public <strong>Documentation</strong> page and the
      <strong>Developer</strong> credits page — all restyleable from Owner → Website with your own HTML/CSS.</p>`,
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
      <p>Sign in with the email and password issued by the platform owner. Every menu item has an icon and the
      sidebar is <strong>collapsible</strong> — click the collapse button to shrink it to icons only; the choice
      is remembered. The sidebar is your whole workflow:</p>
      <ul>
        <li><strong>Dashboard</strong> — who is inside right now, today's footfall and a members-by-type chart.</li>
        <li><strong>Members</strong> — add, edit, block, bulk-delete and enroll palm/RFID/face identities.</li>
        <li><strong>Face ID</strong> — enroll a member's face from a photo or live camera.</li>
        <li><strong>Master data</strong> — courses, departments, academic years.</li>
        <li><strong>Master setting</strong> — sublibrary users, kiosks/terminals, library hours &amp; holidays,
          auto-exit and SIP2/LMS connection.</li>
        <li><strong>Bulk import</strong> — load members from Excel/CSV with live progress.</li>
        <li><strong>Reports</strong> — 8 report types, calendar, column chooser, CSV/print/PDF.</li>
        <li><strong>Audit trail</strong> — every administrative action, append-only.</li>
        <li><strong>Kiosk settings</strong> — branding, 6 templates, input methods, theme and custom CSS.</li>
        <li><strong>Settings</strong> — profile, backup/restore, timezone, font size and appearance.</li>
      </ul>
      <p>Roles: <em>super admin</em> (everything), <em>librarian</em> (members, kiosk, reports),
      <em>report viewer</em> (read-only) — plus per-sublibrary users with module-wise permissions (see Master
      setting). Use the theme button to switch between light and dark, and the font-size control
      (A to A+++) to scale the whole console; both are saved in your browser.</p>`,
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
      academic year, photo, RFID card UID, membership valid-from/valid-to and status.</p>
      <ul>
        <li><strong>Blocked</strong> or <strong>expired</strong> members are refused at the kiosk and no entry
          is written to the register — the attempt is kept only in the failed-scan log.</li>
        <li>The member photo is shown on the kiosk when the scan succeeds, so staff can visually confirm.
          Photos are stored locally on the server under the member code.</li>
        <li>Palm enrollment binds a captured template to the member code; the biometric template itself never
          leaves the kiosk PC — only a reference hash is stored.</li>
        <li><strong>Bulk delete</strong> — select members with the checkboxes and delete them in one action;
          a confirmation shows the exact count first.</li>
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
        <li><strong>Duplicate handling</strong> — choose <em>Skip</em> to leave existing members untouched, or
          <em>Overwrite</em> to update them from the file.</li>
        <li><strong>Live progress bar</strong> — the file uploads in chunks of 1,000 rows with server-side
          batch inserts, so even 36,000 records import quickly; added / updated / skipped / failed counts
          update live without refreshing the page.</li>
        <li><strong>Delete recent import</strong> — undo the last import in one click if it went in wrong.</li>
        <li>The import result lists every rejected row with the reason — fix and re-upload just those rows.</li>
      </ul>`,
  },
  {
    id: "admin-kiosk",
    title: "The kiosk screen",
    body: `
      <p>Your kiosk lives at <code>http://&lt;server&gt;:4000/kiosk/&lt;your-slug&gt;</code>. It shows the
      university name, logo, live clock and a result panel after each scan — with the member's photo, name,
      course and Entry/Exit status.</p>
      <ul>
        <li><strong>Palm</strong> — the on-site bridge program matches locally and posts the member code.</li>
        <li><strong>RFID</strong> — the card reader types the UID into the field and submits.</li>
        <li><strong>Barcode (camera)</strong> — the kiosk asks for camera permission and reads the barcode on
          the member's ID card; each detection submits automatically.</li>
        <li><strong>Barcode (USB scanner)</strong> — a keyboard-wedge scanner just works: fast keystrokes
          ending in Enter are captured and auto-submitted after every scan.</li>
        <li><strong>Face</strong> — matches the live camera image against enrolled faces locally in the
          browser (no photo leaves the PC); a match records the Entry/Exit automatically. Enroll faces from
          the <strong>Face ID</strong> admin page and tune the match threshold in Kiosk settings.</li>
        <li><strong>Manual</strong> — staff type the member code (useful when a card is forgotten).</li>
      </ul>
      <p>Entry and Exit toggle automatically: if the member's last event was an Entry, the next scan is an
      Exit. Expired memberships show a "Membership expired — renew" panel and are not registered. If the
      owner suspends the university or the subscription lapses, the kiosk stops accepting scans until the
      subscription is extended or reactivated — admins can still sign in and view reports.</p>
      <h4>Multiple kiosks and locations</h4>
      <p>Register each terminal under <strong>Master setting → Kiosks / terminals</strong> with a name and
      location (Main library or a sublibrary). An inactive terminal cannot scan. With several locations,
      the multi-kiosk transfer logic handles members moving between libraries, and the location-wise report
      breaks footfall down per terminal.</p>`,
  },
  {
    id: "admin-insights",
    title: "“Did You Know?” student insights",
    body: `
      <p>After each kiosk scan the student can see 1–3 personal library facts generated from their own
      entry/exit history: total <em>time spent in the library</em>, average and longest session, total visits,
      different days visited, current and longest visit streak, milestone celebrations (50th visit, 100 hours,
      21-day streak…), month-on-month progress, favourite library day and the next goal to reach.</p>
      <p>Configure everything under <strong>Settings → “Did You Know?” student insights</strong>: switch it on
      or off, choose entry and/or exit scans, the heading, how many cards appear per scan, an optional monthly
      visit goal, and which insight types are used. Use the <em>Preview</em> box with a membership number to see
      exactly what a student will get.</p>
      <p>For full customisation supply your own card markup with the placeholders
      <code>{{icon}}</code>, <code>{{text}}</code> and <code>{{category}}</code>, and style it in the kiosk CSS
      editor with <code>.kiosk-insights</code>, <code>.insights-title</code>, <code>.insight</code>,
      <code>.insight-icon</code> and <code>.insight-text</code>.</p>
    `,
  },
  {

    id: "admin-branding",
    title: "Branding and custom CSS",
    body: `
      <p>In <strong>Kiosk settings</strong> pick one of the <strong>6 kiosk templates</strong> (Classic,
      Minimal, Split, Card, Photo-first and the landscape <em>Wide console</em> with institute header, large
      photo, centered student details and circular clock). A live preview reloads after each save. For full
      control, use <em>Copy template CSS</em> and edit the styles — your custom CSS overrides the template.
      Also set the colour mode (light/dark), logo, welcome message and enabled input methods. Refresh the
      kiosk with <kbd>Ctrl</kbd>+<kbd>F5</kbd> after saving.</p>
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
      <p><strong>Reports</strong> offers eight report types, all with date-range and master-data filters:</p>
      <ol>
        <li><strong>Visit-wise register</strong> — every entry/exit pair with visit duration.</li>
        <li><strong>Student-wise total time</strong> — total hours spent in the library per member.</li>
        <li><strong>Course-wise summary</strong> — footfall and time grouped by course.</li>
        <li><strong>Daily footfall</strong> — entries/exits per day.</li>
        <li><strong>Currently inside</strong> — live occupancy list.</li>
        <li><strong>Absentee</strong> — members with no visit in the period.</li>
        <li><strong>Designation-wise</strong> — students vs staff breakdown.</li>
        <li><strong>Location-wise</strong> — footfall per kiosk/terminal (main library vs sublibraries).</li>
      </ol>
      <p>The month calendar shows how many records each day holds — click a date to load just that day.</p>
      <ul>
        <li><strong>Choose columns</strong> — untick anything you do not want (for example Device); the choice
          applies to the table, the CSV export and the printout, and is remembered.</li>
        <li><strong>Export CSV</strong> — opens in Excel.</li>
        <li><strong>Print / PDF</strong> — A4 output with your configurable header/footer (university name,
          logo, address, footer text, and optional header image/HTML — set under Report branding). The header
          repeats on every page and the footer stays fixed; use the browser's "Save as PDF". Allow pop-ups
          for the site if nothing opens.</li>
      </ul>
      <p><strong>Student visit analysis (Sankey)</strong> sits at the bottom of the Reports page. It draws the
      flow <em>Course → Department → Time period</em> for any date range you choose, with its own From/To,
      Course and Department filters. Time is split into 3-hour bands (08:00–11:00, 11:00–14:00, 14:00–17:00,
      17:00–20:00, 20:00–23:00). Flow thickness = number of visits; hover a flow to see the exact count and
      share. Use it to see the busiest courses, departments and peak library hours.</p>`,
  },
  {
    id: "admin-display",
    title: "Library activities & kiosk display",
    body: `
      <p>Under <strong>Library activities</strong> you decide what a kiosk shows while nobody is using it —
      services, activities, events, workshops, announcements, new books, digital resources, photographs and
      videos. Scanning is never blocked: any touch, key press or card scan brings the normal kiosk straight back.</p>
      <ul>
        <li><strong>Idle screen</strong> — switch it on, set how many seconds of no activity start the display
          (for example 30) and how long each slide stays on screen.</li>
        <li><strong>Regular daily post</strong> — stays on until you deactivate or delete it.</li>
        <li><strong>Occasion-wise post</strong> — start/end date plus start/end time, e.g. 15/08/2026 08:00–23:00
          or a week-long campaign. It starts and expires automatically.</li>
        <li><strong>Kiosk assignment</strong> — tick “All kiosks”, or pick only the terminals that should show
          the post, so each kiosk can carry its own content.</li>
        <li><strong>Priority</strong> — content assigned to that kiosk only; a running occasion post wins over
          regular posts; when it expires the regular posts return automatically.</li>
        <li>Each post shows its live status: Active, Scheduled, Expired or Inactive.</li>
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
    id: "admin-face",
    title: "Face ID enrollment",
    body: `
      <p>The <strong>Face ID</strong> page enrolls members for facial recognition at the kiosk. Matching runs
      entirely in the browser on the kiosk PC — only a numeric descriptor (128 numbers) is stored, never a
      face photo.</p>
      <ol>
        <li>Type the <strong>membership number</strong> in the box and press <kbd>Enter</kbd> — the member's
          name and photo load automatically.</li>
        <li>Choose <strong>Enroll from photo</strong> (uses the stored member photo) or
          <strong>Enroll from camera</strong> to capture a live face on the spot.</li>
        <li>Re-enroll any time to replace a poor sample; use <strong>Remove face</strong> on a member to
          delete their descriptor.</li>
      </ol>
      <p>Enable the Face tab on the kiosk and tune the match threshold in <strong>Kiosk settings</strong>
      (lower = stricter). The first camera use on each kiosk PC asks for camera permission.</p>`,
  },
  {
    id: "admin-master-setting",
    title: "Master setting: sublibraries, kiosks, hours and auto-exit",
    body: `
      <p><strong>Master setting</strong> centralises operational controls:</p>
      <ul>
        <li><strong>Sublibrary users</strong> — create logins for sublibrary staff with kiosk- and
          location-wise access and module-wise permissions (members, reports, import, settings, etc.).
          A sublibrary user only sees their own location.</li>
        <li><strong>Kiosks / terminals</strong> — register each terminal with its location. Unticking
          <em>Active</em> disables that terminal immediately; ticking it enables scanning.</li>
        <li><strong>Library working hours</strong> — opening/closing time per day, plus a
          <strong>holiday calendar</strong> where you can mark holidays, closed days or custom timings for
          any specific date.</li>
        <li><strong>Auto-exit</strong> — a scheduled job closes forgotten "inside" sessions at closing time.
          <em>Run auto-exit now</em> opens a library picker — tick <strong>All libraries</strong>,
          <strong>Main library</strong> or individual sublibraries, confirm, and everyone still inside those
          libraries is exited immediately. Every run is recorded in the Audit trail.</li>
      </ul>`,
  },
  {
    id: "admin-sip2",
    title: "SIP2 / LMS integration",
    body: `
      <p>If your library management system speaks <strong>SIP2</strong> (Koha, etc.), configure the connection
      in <strong>Master setting → SIP2 / LMS connection</strong>: host, port, SIP user and password.
      Credentials are stored encrypted.</p>
      <p>When an unknown member code is scanned at the kiosk, the app verifies it live against the LMS over
      SIP2; valid patrons are synchronised into the members table automatically and their entry is recorded.
      Invalid or blocked patrons are refused with the LMS reason.</p>`,
  },
  {
    id: "admin-settings-page",
    title: "Settings: backup, timezone, font size",
    body: `
      <ul>
        <li><strong>Backup / restore</strong> — download your whole institute's data (members, logs, masters)
          as one JSON file, and restore it later on this or another server.</li>
        <li><strong>Timezone</strong> — pick your zone once; all reports, dashboards and the register follow
          it. Entry/exit timestamps use the server's system clock.</li>
        <li><strong>Font size</strong> — scale the console from A to A+++; the choice is remembered in your
          browser.</li>
        <li><strong>Appearance</strong> — accent colour and dark mode for the admin console (does not affect
          the kiosk).</li>
      </ul>`,
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
