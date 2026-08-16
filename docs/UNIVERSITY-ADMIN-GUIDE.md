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
