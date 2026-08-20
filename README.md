# Library Entry & Exit Register — MySQL Edition

A **self-hosted, multi-tenant university library register** that runs entirely on
**MySQL + Node.js** — no cloud dependency, no recurring fees. Every university gets
its own isolated campus with members, kiosk, reports and audit trail, managed by a
single platform owner.

Built around palm-vein biometric capture, RFID cards and manual entry, with a public
marketing website, lead-generation contact form and a live occupancy dashboard.

---

## Table of contents

- [Features at a glance](#features-at-a-glance)
- [Public website](#public-website)
- [System requirements](#system-requirements)
- [Quick start (Windows)](#quick-start-windows)
- [Quick start (Linux / macOS)](#quick-start-linux-macos)
- [Configuration (.env)](#configuration-env)
- [First run workflow](#first-run-workflow)
- [Connecting the C++ palm bridge](#connecting-the-c-palm-bridge)
- [Roles & access control](#roles--access-control)
- [Backups & upgrades](#backups--upgrades)
- [Ports & network access](#ports--network-access)
- [Documentation](#documentation)
- [Developer information](#developer-information)
- [License](#license)
- [Acknowledgements](#acknowledgements)

---

## Features at a glance

**Platform owner console**

- Overview dashboard with key metrics across all universities
- Create universities, set subscription windows (active / suspended / expired)
- Issue each university its own admin login credentials
- Billing, subscription history, payment tracking
- CRM — leads captured from the public **Contact us** page
- System settings, SMTP configuration, website/branding customisation

**University admin panel**

- Members CRUD with photo, RFID UID, course / department / year
- Master data — courses, departments, academic years (dedicated page)
- Bulk CSV/Excel import of members
- Live occupancy dashboard — who is inside, visit duration, peak hour,
  gender / department / hourly footfall, 14-day trend (refreshes every 15s)
- Reports — date calendar, column chooser, print/PDF/CSV export
- Audit trail of every admin action
- Kiosk branding — logo, colour mode, custom CSS
- Appearance — light/dark mode toggle (light is the default)

**Kiosk screen (per university)**

- Palm, RFID or manual entry tabs
- Student photo displayed on successful entry/exit
- Live clock, institution name, welcome message
- Suspend-safe — kiosk stops scanning when the institute is suspended or expired;
  admin can still log in to view metrics
- Reachable at `http://<server>:4000/kiosk/<institute-slug>`

**Scan API (for the C++ bridge)**

- Single endpoint, secured with a per-institute kiosk key
- 1:N matching support via enrolled palm templates
- Returns member identity, action (Entry/Exit) and photo URL

---

## Public website

The app ships with a modern, responsive public-facing site:

| Page | URL | Purpose |
|---|---|---|
| Home | `/` (`index.html`) | 3D hero, features, how it works, CTA |
| Contact us | `/contact.html` | Form that posts directly to the owner CRM |
| Documentation | `/docs.html` | Full installation & operations guide |
| Developer | `/developer.html` | Project team credits |
| Sign in | `/login.html` | University admin / owner login |

Owners can fully customise the home and contact pages (custom HTML + CSS) from the
**Website** page in the owner console, with a live preview and starter template.

---

## System requirements

| Software | Notes |
|---|---|
| MySQL 8 (or MariaDB 10.5+) | XAMPP, WAMP, MySQL Installer, or a cloud VPS all work |
| Node.js 18 or newer | <https://nodejs.org> — the LTS installer |
| A campus PC or server | Reachable on port 4000 from the LAN / kiosk |

For the palm-vein kiosk, a Windows PC running the Deptrum palm SDK and the bundled
C++ bridge (see `kiosk-bridge/`).

> **Full installation walkthroughs, troubleshooting and screenshots live in the
> [Documentation & installation page](public/docs.html) — open it after the app is
> running, or read the source directly in [`public/docs.html`](public/docs.html),
> [`docs/OWNER-GUIDE.md`](docs/OWNER-GUIDE.md) and
> [`docs/UNIVERSITY-ADMIN-GUIDE.md`](docs/UNIVERSITY-ADMIN-GUIDE.md).**

---

## Quick start (Windows)

1. Copy the whole `mysql-app` folder to the machine that will run the register.
2. Start MySQL (in XAMPP: click **Start** next to MySQL).
3. Double-click **`setup.bat`**. The first run creates `.env` — open it and set:
   - `DB_PASSWORD` — your MySQL root password (empty for a default XAMPP install)
   - `OWNER_EMAIL` / `OWNER_PASSWORD` — the platform owner login you want
   - `JWT_SECRET` — any long random string
4. Run **`setup.bat`** again. It creates the database, all tables, and the owner account.
5. Double-click **`start.bat`**. The admin panel opens at <http://localhost:4000/admin>.

---

## Quick start (Linux / macOS)

```bash
cd mysql-app
cp .env.example .env    # then edit it (see below)
npm install
npm run setup           # creates database, tables and owner account
npm start               # serves on http://localhost:4000
```

For development with auto-reload on file changes:

```bash
npm run dev
```

---

## Configuration (.env)

Copy `.env.example` to `.env` and edit before the first `setup` run:

```ini
# --- MySQL connection ---
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=library_register

# --- Web server ---
PORT=4000

# --- Security ---
JWT_SECRET=change-me-to-a-long-random-string-at-least-32-chars
JWT_HOURS=12

# --- First platform owner (created by: npm run setup) ---
OWNER_EMAIL=owner@example.com
OWNER_PASSWORD=ChangeThisOwnerPassword1!
OWNER_NAME=Platform Owner
```

> **Change `JWT_SECRET` and `OWNER_PASSWORD` before going live.** SMTP settings
> (for the mailer / CRM notifications) are configured from the owner **System
> settings** page after first login, not in `.env`.

---

## First run workflow

1. Sign in at <http://localhost:4000/> with the owner email and password from `.env`.
2. Go to **Universities** → create one (name + kiosk slug, e.g. `vidya`).
3. Click **Admin logins** on that row and issue the university's own admin credentials.
4. Sign out and let the university admin sign in — they see only their own campus.
5. The kiosk screen for that campus is `http://<server>:4000/kiosk/vidya`.

See the [owner guide](docs/OWNER-GUIDE.md) and [university admin guide](docs/UNIVERSITY-ADMIN-GUIDE.md)
for the complete day-to-day workflow.

---

## Connecting the C++ palm bridge

The bridge posts to the same endpoint as before, now served by this app:

```
POST http://<server>:4000/api/public/scan-event
Content-Type: application/json
x-kiosk-key: <kiosk key shown on the Universities page>

{ "institute": "vidya", "method": "Palm", "member_code": "STU001",
  "device_id": "kiosk-1", "confidence": 96.4 }
```

Response:

```json
{ "status": "ok", "action": "Entry",
  "member": { "member_code": "STU001", "full_name": "Asha Patel", "photo_url": null } }
```

Set the bridge's host to this server, e.g. `set REGISTER_HOST=http://192.168.1.20:4000`,
and `set KIOSK_KEY=<key>`. Requests coming from the kiosk web page on this same server do
not need the key; anything external does.

Enrolled palm templates are stored per member:

```
POST /api/members/<member-id>/palm
{ "template_hash": "...", "quality_score": 92 }
```

(needs an admin bearer token). The bridge can then send `template_id` instead of
`member_code` for 1:N matching. Full bridge build and run instructions are in the
[Documentation page](public/docs.html#kiosk) under **Kiosk & palm bridge**.

---

## Roles & access control

| Role | Can do |
|---|---|
| Platform owner | Everything, all universities, create universities and their logins, billing, CRM |
| University admin (`super_admin`) | Full control of their own university |
| Librarian | Members, kiosk settings, reports for their university |
| Report viewer | Read-only members and reports |

Every request checks the signed-in user against the requested university, so campuses
can never see each other's data. **Suspended or expired subscriptions block kiosk
scans** (with a clear reason shown on the kiosk screen) while still letting the
university admin log in to view metrics. The platform owner can reactivate or extend
a subscription at any time.

---

## Backups & upgrades

Backup:

```bash
mysqldump -u root -p library_register > backup-YYYYMMDD.sql
```

Restore:

```bash
mysql -u root -p library_register < backup-YYYYMMDD.sql
```

The server auto-applies schema additions (new columns like `kiosk_settings.theme`,
`kiosk_settings.custom_css`, etc.) on startup, so existing databases upgrade with no
manual migration — just restart `start.bat` / `npm start` after updating the code.

---

## Ports & network access

Other machines on the LAN reach the app at `http://<server-ip>:4000`. On Windows,
allow Node.js through the firewall the first time it asks. For a cloud VPS, put the
app behind Nginx/Caddy with HTTPS and keep MySQL bound to `127.0.0.1`.

---

## Documentation

The full, always-current documentation is built into the running app:

- **In-app:** open the **Documentation** page in the sidebar (owner and admin guides).
- **Public site:** <http://localhost:4000/docs.html> — installation, configuration,
  kiosk/palm bridge setup, troubleshooting, technology stack.
- **Source markdown:**
  - [`docs/OWNER-GUIDE.md`](docs/OWNER-GUIDE.md) — provisioning, billing, CRM,
    system settings, website customisation.
  - [`docs/UNIVERSITY-ADMIN-GUIDE.md`](docs/UNIVERSITY-ADMIN-GUIDE.md) — members,
    master data, import, reports, kiosk branding, day-to-day operations.

If anything here disagrees with the in-app documentation, the in-app version is the
source of truth (it is rendered from the latest code).

---

## Developer information

**Developer**

**Shivam Moradia**
Technical Assistant Library,
Knowledge Resource Centre (Central Library),
Saurashtra University, Rajkot

&

Research Student,
PG Department of Library and Information Science,
Sardar Patel University, Vallabhvidhyanagar

**Guidance given by**

**Prof. Dr. Meghna Vyas**
PG Department of Library and Information Science,
Sardar Patel University, Vallabhvidhyanagar

> See the public [Developer page](public/developer.html) for the full credit layout.

---

## License

Copyright © 2026 Shivam Moradia, Saurashtra University & Sardar Patel University.

This software is provided **as-is, for academic and institutional use**, under the
following terms:

- You may **use, copy, modify and distribute** this software freely within your
  institution for non-commercial educational and library purposes.
- You may **not** sell, sublicense for a fee, or offer this software as a hosted
  commercial product without written permission from the author.
- The palm-vein SDK, device drivers and any third-party libraries included or
  referenced remain under their respective original licenses.
- This software is provided without warranty of any kind. The author and the
  affiliated institutions are not liable for any damages arising from its use.

A human-readable summary: free to use and adapt for libraries and universities;
not for resale as a commercial hosted product. Contact the developer for any
commercial licensing questions via the public [Contact us](public/contact.html) page.

---

## Acknowledgements

- **Saurashtra University, Rajkot** — Knowledge Resource Centre (Central Library)
- **Sardar Patel University, Vallabhvidhyanagar** — PG Department of Library and
  Information Science
- Built with Node.js, Express, MySQL, and plain web standards — no proprietary
  runtime required.

---

*For installation help, see the [Documentation & installation page](public/docs.html).*
