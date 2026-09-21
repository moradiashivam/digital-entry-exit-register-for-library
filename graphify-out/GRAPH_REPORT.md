# Graph Report - mysql-app  (2026-09-06)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 734 nodes · 1613 edges · 52 communities (40 shown, 7 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 47 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a298f8db`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 51

## God Nodes (most connected - your core abstractions)
1. `q()` - 84 edges
2. `one()` - 40 edges
3. `uuid()` - 25 edges
4. `localDateTime()` - 21 edges
5. `logAudit()` - 17 edges
6. `express` - 17 edges
7. `installPackage()` - 16 edges
8. `institutes` - 16 edges
9. `requireAuth()` - 15 edges
10. `patronInformation()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `nextCode()` --calls--> `q()`  [EXTRACTED]
  src/routes/masters.routes.js → src/db.js
- `allTables()` --calls--> `q()`  [EXTRACTED]
  src/routes/backup.routes.js → src/db.js
- `nextEstimateNo()` --calls--> `q()`  [EXTRACTED]
  src/routes/owner.routes.js → src/db.js
- `nextInvoiceNo()` --calls--> `q()`  [EXTRACTED]
  src/routes/owner.routes.js → src/db.js
- `secretFromColumn()` --calls--> `decrypt()`  [EXTRACTED]
  src/sip2.js → src/crypto.js

## Import Cycles
- None detected.

## Communities (52 total, 7 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (55): description, engines, node, main, name, private, scripts, dev (+47 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (44): buildVisits(), DAY_MILESTONES, dayKey(), DEFAULT_CATEGORIES, HOUR_MILESTONES, humanDuration(), INSIGHT_CATEGORIES, nextOf() (+36 more)

### Community 2 - "Community 2"
Cohesion: 0.12
Nodes (41): localDateTime(), downloadHeaders(), fetchLatestRelease(), getUpdateStatus(), GITHUB_REPO, GITHUB_TIMEOUT_MS, githubFetch(), installLatestRelease() (+33 more)

### Community 3 - "Community 3"
Cohesion: 0.13
Nodes (35): q(), runGithubCheckJob(), autoExitInstitute(), connectionProblem(), runAutoExitJob(), runExpiryJob(), setting(), startScheduler() (+27 more)

### Community 4 - "Community 4"
Cohesion: 0.10
Nodes (31): router, cleanTaxes(), DEFAULT_TAXES, estimateTotals(), getTaxRates(), nextEstimateNo(), nextInvoiceNo(), nullable() (+23 more)

### Community 5 - "Community 5"
Cohesion: 0.11
Nodes (32): library_special_days, pdf_branding, institutes, sublibraries, user_access, user_kiosks, user_locations, user_sublibraries (+24 more)

### Community 6 - "Community 6"
Cohesion: 0.09
Nodes (24): api(), clearToken(), downloadCsv(), esc(), fmtDate(), fmtTime(), getInstitute(), getToken() (+16 more)

### Community 7 - "Community 7"
Cohesion: 0.15
Nodes (31): /app/face-engine.js, /app/face-scan-fx.js, applyCustomCss(), applyTemplate(), askedDevice, boot(), camHint(), deviceState() (+23 more)

### Community 8 - "Community 8"
Cohesion: 0.14
Nodes (23): BOOLS, NUMS, router, TEXTS, checksum(), connect(), connectionError(), DEFAULT_FIELD_MAP (+15 more)

### Community 9 - "Community 9"
Cohesion: 0.15
Nodes (23): academic_years, audit_logs, bulk_import_logs, courses, departments, entry_exit_logs, failed_scan_logs, institute_secrets (+15 more)

### Community 10 - "Community 10"
Cohesion: 0.14
Nodes (18): express, canWrite(), hasModule(), kioskScope(), requireModule(), requireWrite(), logAudit(), requireAuth() (+10 more)

### Community 11 - "Community 11"
Cohesion: 0.19
Nodes (17): active(), boot(), buildInstitutePicker(), buildNav(), can(), canBulk(), canWrite(), ctx (+9 more)

### Community 12 - "Community 12"
Cohesion: 0.23
Nodes (17): one(), uuid(), COOKIE_NAME, isLive(), logSessionEvent(), newCode(), newToken(), readCookie() (+9 more)

### Community 13 - "Community 13"
Cohesion: 0.15
Nodes (16): ADMIN_ROLES, FULL, loadAccess(), MODULE_KEYS, MODULES, parseModules(), requireExport(), requireInstituteAdmin() (+8 more)

### Community 14 - "Community 14"
Cohesion: 0.16
Nodes (10): hashPassword(), requireOwner(), ensureSchemaExtras(), kioskKey(), localDate(), plusYear(), today(), router (+2 more)

### Community 15 - "Community 15"
Cohesion: 0.19
Nodes (14): deleteMedia(), __dirname, EXT, MEDIA_ROOT, saveMedia(), activePostsFor(), clean(), dateOrNull() (+6 more)

### Community 16 - "Community 16"
Cohesion: 0.22
Nodes (12): accessFor(), canViewReports(), HOURS, isInstituteAdmin(), isMember(), isStaff(), kioskEnabled(), rolesFor() (+4 more)

### Community 17 - "Community 17"
Cohesion: 0.19
Nodes (6): DAY_NAMES, hoursPanel(), kioskApprovalsPanel(), load(), specialDaysPanel(), ymdOf()

### Community 18 - "Community 18"
Cohesion: 0.17
Nodes (11): app_updates, lead_activities, leads, password_resets, payments, plans, platform_settings, schema_migrations (+3 more)

### Community 19 - "Community 19"
Cohesion: 0.32
Nodes (10): arr(), money(), mountEstimates(), openEstimatePdf(), day(), invoiceHtml(), lines(), money() (+2 more)

### Community 20 - "Community 20"
Cohesion: 0.32
Nodes (11): ACCENTS, applyAccent(), applyTextSize(), applyTheme(), getAccent(), getTextSize(), getTheme(), initAppearance() (+3 more)

### Community 21 - "Community 21"
Cohesion: 0.18
Nodes (11): dependencies, bcryptjs, cors, dotenv, express, jsonwebtoken, mysql2, nodemailer (+3 more)

### Community 22 - "Community 22"
Cohesion: 0.38
Nodes (10): arr(), barList(), columnChart(), dayKey(), HOUR_LABELS, hourLabel(), mins(), pie() (+2 more)

### Community 23 - "Community 23"
Cohesion: 0.31
Nodes (8): requireBulk(), deletePhoto(), __dirname, instituteFolder(), PHOTO_ROOT, safe(), savePhoto(), router

### Community 24 - "Community 24"
Cohesion: 0.33
Nodes (7): bestMatch(), DEFAULT_MODEL_URL, describeFace(), distance(), loadFaceApi(), loadModels(), options()

### Community 25 - "Community 25"
Cohesion: 0.47
Nodes (8): arr(), columns(), donut(), money(), monthShort(), pct(), renderOwnerOverview(), stat()

### Community 26 - "Community 26"
Cohesion: 0.36
Nodes (8): daysAgo(), iso(), loadColumnPrefs(), MONTHS, renderReports(), REPORTS, saveColumnPrefs(), /app/pages/sankey.js

### Community 27 - "Community 27"
Cohesion: 0.38
Nodes (5): blank(), CATEGORIES, fileToDataUrl(), renderKioskDisplay(), STATUS_ORDER

### Community 28 - "Community 28"
Cohesion: 0.33
Nodes (6): pool, allTables(), columnsOf(), insertRows(), router, TENANT_TABLES

### Community 29 - "Community 29"
Cohesion: 0.40
Nodes (5): RFC-4122, CSV_COLUMNS, parseCsv(), renderImport(), TEMPLATE

### Community 30 - "Community 30"
Cohesion: 0.47
Nodes (5): ADMIN_DOCS, OWNER_DOCS, renderAdminDocs(), renderDocs(), renderOwnerDocs()

### Community 31 - "Community 31"
Cohesion: 0.67
Nodes (5): renderFace(), find(), loadStats(), paint(), save()

### Community 32 - "Community 32"
Cohesion: 0.33
Nodes (4): DEFAULT_CATEGORIES, INSIGHT_CATEGORIES, TEXT_FIELDS, TOGGLES

### Community 33 - "Community 33"
Cohesion: 0.50
Nodes (4): attachFaceScan(), LANDMARKS, noop(), STATES

### Community 34 - "Community 34"
Cohesion: 0.70
Nodes (4): arr(), money(), renderOwnerBilling(), showUpiQr()

### Community 35 - "Community 35"
Cohesion: 0.50
Nodes (4): arr(), renderOwnerLeads(), SOURCES, STAGES

### Community 37 - "Community 37"
Cohesion: 0.67
Nodes (3): arr(), KINDS, renderMasters()

### Community 39 - "Community 39"
Cohesion: 0.83
Nodes (3): arr(), money(), renderOwnerPlans()

### Community 40 - "Community 40"
Cohesion: 0.83
Nodes (3): arr(), money(), renderOwnerTenants()

### Community 41 - "Community 41"
Cohesion: 0.83
Nodes (3): arr(), readBase64(), renderOwnerUpdate()

## Knowledge Gaps
- **133 isolated node(s):** `description`, `node`, `main`, `name`, `private` (+128 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 196 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `q()` connect `Community 3` to `Community 0`, `Community 1`, `Community 2`, `Community 4`, `Community 8`, `Community 10`, `Community 12`, `Community 13`, `Community 14`, `Community 15`, `Community 16`, `Community 23`, `Community 28`?**
  _High betweenness centrality (0.073) - this node is a cross-community bridge._
- **Why does `express` connect `Community 10` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 8`, `Community 12`, `Community 13`, `Community 14`, `Community 15`, `Community 23`, `Community 28`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `one()` connect `Community 12` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 8`, `Community 10`, `Community 13`, `Community 14`, `Community 15`, `Community 16`, `Community 23`, `Community 28`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **What connects `description`, `node`, `main` to the rest of the system?**
  _133 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05336951605608322 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06787330316742081 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.11563367252543941 - nodes in this community are weakly interconnected._