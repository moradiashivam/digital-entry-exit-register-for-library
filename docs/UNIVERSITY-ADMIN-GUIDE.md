# University Admin Guide

The same content is available inside the app under **Documentation** in the sidebar.

## 1. Your pages

| Page | Purpose |
|---|---|
| Dashboard | Who is inside right now, today's footfall, trends |
| Members | Add, edit, block, enroll palm / RFID |
| Master data | Courses, departments, academic years |
| Bulk import | Load members from Excel / CSV |
| Reports | Entry/exit register, calendar, export, print |
| Audit trail | Every administrative action, append-only |
| Kiosk settings | Branding, input methods, theme, custom CSS |

Roles: **super admin** (everything), **librarian** (members, kiosk, reports),
**report viewer** (read-only). The theme button at the bottom of the sidebar switches
light/dark for your browser.

## 2. First-time setup order

1. **Master data** — add courses, departments and academic years first; imports and report
   filters match against these lists.
2. **Kiosk settings** — university name, logo URL, welcome text, enabled input methods
   (Palm / RFID / Manual), theme, custom CSS.
3. **Members** — bulk import the roll list, then correct individual records.
4. Open the kiosk URL on the entrance PC and leave it full-screen.

## 3. Members

Each member needs a unique **member code** (roll/staff ID) — the kiosk and palm bridge identify
people by it. Other fields: name, gender, course, department, academic year, photo URL, RFID UID,
valid-from / valid-to, status.

- Blocked or expired members are refused at the kiosk and **no entry is written** to the
  register; the attempt is kept only in the failed-scan log.
- The photo is shown on a successful scan so staff can confirm visually.
- Palm enrollment binds a captured template to the member code. The biometric template stays on
  the kiosk PC — only a reference hash is stored.

## 4. Bulk import

Download the sample from **Bulk import** and keep the headers, typically:
`member_code, full_name, gender, course, department, academic_year, email, phone, rfid_uid,
valid_from, valid_to`.

- Dates are `YYYY-MM-DD`.
- Course / department / year values must already exist in Master data.
- An existing member code updates that member instead of duplicating it.
- The result lists every rejected row with a reason — fix and re-upload just those rows.

## 5. The kiosk

URL: `http://<server>:4000/kiosk/<your-slug>`.

- **Palm** — the on-site bridge matches locally and posts the member code.
- **RFID** — the reader types the UID into the field and submits.
- **Manual** — staff type the member code.

Entry and Exit toggle automatically. Expired memberships show a "Membership expired — renew"
panel and are not registered.

## 6. Branding and custom CSS

Set colour mode, logo and welcome message in **Kiosk settings**, optionally paste custom CSS,
save, then refresh the kiosk with `Ctrl+F5`. The live preview reloads after each save.

Stable hooks:

```
.kiosk, .kiosk-card, .kiosk-logo, .kiosk-institution, .kiosk-title,
.kiosk-clock, .kiosk-welcome, .kiosk-tabs button, .kiosk-form, .kiosk-input,
.kiosk-result, .result.entry, .result.exit, .result.expired, .result.bad, .kiosk-footer
```

```css
.kiosk-card { background: #0b3d2e; border-radius: 24px; }
.kiosk-institution { letter-spacing: .08em; text-transform: uppercase; }
```

The **Appearance** box changes the admin console accent/dark mode for your browser only — the
kiosk is unaffected.

## 7. Reports

Filters for date range, course, department, year, gender and member. The month calendar shows
each day's record count — click a date to load that day.

- **Choose columns** — untick anything (e.g. Device); applies to the table, CSV and printout and
  is remembered.
- **Export CSV** — opens in Excel.
- **Print / PDF** — clean A4 landscape register in a new window; allow pop-ups.

## 8. Dashboard

Refreshes every 15 seconds: currently inside with visit duration, entries/exits today, average
visit length, peak hour, gender / department / course footfall, hourly chart, 14-day trend.
Occupancy pairs entries and exits over a 48-hour window so overnight visits are handled correctly.

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| "Subscription expired" | Ask the platform owner to renew |
| Valid member rejected | Check status Active and valid-to in the future; see Audit trail |
| Custom CSS not visible | Save again, then `Ctrl+F5` on the kiosk |
| Import rows rejected | Missing master data value or wrong date format |
| Empty charts | No scans recorded yet for that day |

## Master Setting — sublibrary users, permissions and multi-kiosk rules

**Where:** sidebar → **Master setting** (visible only to the University Administrator).

### Libraries (sublibraries)
Create one entry per library building/branch, then map each kiosk to a library in
the *Kiosk → library mapping* table. Dashboards, reports and user access can then
be filtered library-wise.

### Sublibrary users
Add a user with name, email and password, then choose:

- **Role** — University administrator, Library manager, Sublibrary administrator,
  Kiosk operator, Report viewer or Viewer only. Picking a role pre-fills the
  recommended permissions; you can change any of them afterwards.
- **Module-wise permission** — dashboard, members, entry/exit register, reports,
  kiosk settings, master data, master setting, audit trail. Hidden modules
  disappear from the menu and are refused by the server.
- **Rights** — *Viewer only* (no add/edit/delete anywhere), *Allow bulk upload*
  and *Allow download / export*.
- **Library, location and kiosk access** — tick the kiosks (or libraries /
  locations) the user may work with. Their dashboard, register, reports and kiosk
  list then show those terminals only. Leave the kiosk list empty to allow all.

Users can be edited, deactivated (cannot sign in), have their password reset, or be
removed from the university. The University Administrator always keeps full access
and cannot be edited or removed from this screen.

### Dashboard filters
The dashboard has a **Library / Location / Kiosk** filter bar. Occupancy, today's
counts, hourly footfall, the 14-day trend and latest scans all follow the filter,
within whatever the account is allowed to see.

### Multi-kiosk entry, exit and transfer
A member may only have one open visit at a time (complete-transaction principle).

- Scanning at the **same** kiosk toggles Entry → Exit as usual.
- Scanning at a **different** kiosk while a visit is still open:
  - **Automatic transfer ON** (Settings → Kiosk branding → *Automatic transfer
    between kiosks*): the previous visit is closed at the old kiosk with method
    `Transfer` and a new Entry is written at the new kiosk — one scan, no manual
    exit needed.
  - **Automatic transfer OFF**: the scan is refused with
    "Please scan out at *<kiosk>* before entering here", and the attempt is logged.

### Transaction history
Reports → **Transaction history (multi-kiosk)** lists every scan of a member with
its kiosk, library, location and method, so transfers are fully traceable.
