# Platform Owner Guide

The same content is available inside the app under **Documentation** in the owner sidebar.

## 1. Signing in

The owner account is created by `setup.bat` / `npm run setup` from `OWNER_EMAIL` and
`OWNER_PASSWORD` in `.env`. Sign in at `http://<server>:4000/`.

The owner console is a business console. By design it cannot open any university's members,
scan logs or reports — that data belongs to the campus.

| Page | Purpose |
|---|---|
| Platform overview | Revenue, active/expiring subscriptions, tenant growth |
| Universities | Subscription window, plan, status (Active / Suspended) |
| Plans | Packages, member limits, pricing |
| Payments & accounting | Invoices, collections, dues, tax |
| Leads (CRM) | Enquiries, follow-ups, conversion |
| Provision access | Create universities and issue admin logins |
| System settings | Company details, invoice numbering, SMTP, audit |

## 2. Creating a university

1. **Provision access** → enter the university name and a kiosk slug (lower-case, no spaces).
   The kiosk URL becomes `http://<server>:4000/kiosk/<slug>`.
2. Set subscription start and end dates → **Create university**.
3. **Admin logins** on that row → issue the first super-admin email and password.
4. Share the kiosk URL, and the **kiosk key** if an external palm bridge is used.

**Rotate** replaces the kiosk key immediately (update every bridge). **Reset** sets a new
password for a university admin.

## 3. Subscriptions

Outside the start/end window the university admin sees a "Subscription expired" screen and the
kiosk stops accepting scans. Extend the dates in **Universities**, or record a payment which
renews the period. Status *Suspended* blocks access regardless of dates. A nightly job flags
soon-to-expire subscriptions and emails the contact when SMTP is configured.

## 4. Plans, payments, invoices

Create packages in **Plans** (name, price, billing period, member limit) and assign them per
university. Record payments in **Payments & accounting** (amount, tax, mode, reference, period);
the page totals collections and dues and prints an invoice using the company profile and invoice
prefix from **System settings**.

## 5. Leads

**Leads (CRM)** stores enquiries with stage and follow-up notes. **Convert** creates the
university, carries the contact details over and opens provisioning in one flow.

## 6. System settings, email, backups

SMTP credentials are stored encrypted (AES-256-GCM) with a key derived from `JWT_SECRET`;
changing that secret invalidates stored credentials and all sessions.

```bash
mysqldump -u root -p library_register > backup-YYYYMMDD.sql
mysql -u root -p library_register < backup-YYYYMMDD.sql
```

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| Admin cannot sign in | Account Active? Subscription current? Use **Reset** |
| Kiosk "not allowed" | Subscription expired or status Suspended |
| Bridge gets 401 | Kiosk key rotated — update `KIOSK_KEY` on the kiosk PC |
| No emails | Check SMTP host/port/credentials in System settings |
| Server won't start | MySQL not running, or wrong `DB_PASSWORD` in `.env` |

## 8. Installation

**Requirements:** MySQL 8 / MariaDB 10.5+ and Node.js 18+.

### Windows

1. Copy the `mysql-app` folder to the server machine and start MySQL.
2. Run `setup.bat` once — it creates `.env`.
3. Edit `.env`: `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `OWNER_EMAIL`, `OWNER_PASSWORD`,
   `JWT_SECRET` (long random string; also encrypts SMTP credentials), `PORT` (default 4000).
4. Run `setup.bat` again — creates the database, tables and owner account.
5. Run `start.bat` and open `http://localhost:4000/`.

### Linux / macOS

```bash
cd mysql-app
cp .env.example .env    # then edit it
npm install
npm run setup
npm start
```

### Fresh schema in one file

`mysql-app/db/database.sql` contains every table with no follow-up migrations; safe to re-run.

### Production

Keep MySQL on `127.0.0.1`, put the app behind Nginx/Caddy with HTTPS, and keep `npm start`
alive with pm2, systemd or NSSM. On Windows allow Node.js through the firewall so LAN clients
can reach `http://<server-ip>:4000`.

### Upgrading

Back up, copy new files, `npm install`, restart — new tables and columns apply automatically on boot.

## 9. Technology stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ (ES modules) |
| API | Express 4 + CORS |
| Database | MySQL 8 / MariaDB 10.5+ via `mysql2` pool |
| Auth | JWT bearer tokens, bcrypt password hashes |
| Email | Nodemailer over your own SMTP |
| Encryption | AES-256-GCM for SMTP credentials (key from `JWT_SECRET`) |
| Frontend | Plain HTML/CSS/ES-module JS — no build step |
| Palm hardware | C++ bridge on the kiosk PC using the vendor SDK |

```text
Kiosk PC (palm SDK, C++ bridge) ─┐
Browser kiosk page ──────────────┼─> Node/Express API ──> MySQL
Admin console (browser) ─────────┘
```

Biometric templates never leave the kiosk PC; the bridge matches locally and posts the member
code to `POST /api/public/scan-event` with the university's kiosk key.

### Folder map

- `src/server.js` — bootstrap and static hosting
- `src/routes/` — auth, members, masters, reports, settings, owner, public scan API
- `src/db.js` — pool plus automatic schema upgrades on start
- `db/` — `schema.sql`, `platform.sql`, consolidated `database.sql`
- `public/` — admin console, kiosk, login/reset pages
- `docs/` — these guides

### Security model

- Every request is scoped to the signed-in user's university; campuses are isolated.
- The owner is a business role with no access to members, scans or reports.
- External scan calls need the kiosk key; browser kiosk pages are same-origin.
- Expired or suspended subscriptions block admin access and kiosk scans.

## Application management (Update Application)

**Owner menu → Application management**

1. **Application version** – installed version, Node.js version, uptime and how many database migrations have run.
2. **Update application** – choose the new version's ZIP file, optionally **Validate package**, then **Upload & upgrade**. The package must contain `package.json` and `src/server.js`; SQL upgrade scripts go in a `db` folder inside the ZIP.
   * A copy of the current application is saved to `backups/app-<timestamp>/` and the whole database to `backups/db-<timestamp>.json` **before** anything is replaced.
   * `.env`, `node_modules/`, `backups/`, `uploads/`, `logs/` and `public/photos/` are never overwritten.
   * Every step (validation, backup, extraction, migration) is shown on screen.
   * If any step fails, the application files are rolled back automatically and the failure is reported.
3. **Database upgrade status** – each `db/*.sql` script runs once, in filename order, and is recorded in `schema_migrations`, so re-uploading the same package never re-runs it. Failures are listed with the error text.
4. **Restart application** – stops the process and starts the new version, then waits for the app to answer and reloads the console. Start the app with `start.bat` (Windows) or `start-loop.sh` (Linux/macOS) — or a supervisor such as pm2 — so the restart brings it back automatically.
5. **Recovery** – restore any earlier application backup from the list, then restart.
6. **Update history** – date, package name, from/to version, migrations applied, status and who ran it. Update actions are also written to the platform audit trail.

Only the platform owner can open these endpoints; every request is checked server-side.
