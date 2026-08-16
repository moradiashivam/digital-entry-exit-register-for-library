# Library Register — Palm Scan Attendance Platform

A multi-tenant (multi-university) library attendance and management platform with palm-biometric
kiosk scanning, a business/owner console for provisioning and billing, and per-campus admin
consoles for members, reports, and settings.

## Overview

- **Owner console** — platform-level business operations: universities, plans, payments,
  invoicing, leads (CRM), and system settings. The owner has no access to any university's
  members, scan logs, or reports — that data is isolated per campus.
- **University admin console** — per-campus member management, scan reports, and settings.
- **Kiosk** — a browser page paired with a C++ bridge on the kiosk PC that talks to the palm
  scanner SDK. Biometric templates never leave the kiosk PC; only a matched member code is sent
  to the server.

## Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ (ES modules) |
| API | Express 4 + CORS |
| Database | MySQL 8 / MariaDB 10.5+ via `mysql2` pool |
| Auth | JWT bearer tokens, bcrypt password hashes |
| Email | Nodemailer over your own SMTP |
| Encryption | AES-256-GCM for SMTP credentials (key derived from `JWT_SECRET`) |
| Frontend | Plain HTML/CSS/ES-module JS — no build step |
| Palm hardware | C++ bridge on the kiosk PC using the vendor SDK |

```text
Kiosk PC (palm SDK, C++ bridge) ─┐
Browser kiosk page ──────────────┼─> Node/Express API ──> MySQL
Admin console (browser) ─────────┘
```

## Installation

Full installation and setup instructions (Windows and Linux/macOS, environment variables,
database setup, production deployment, and upgrading) are documented separately here:

**📄 [`/docs/OWNER-GUIDE.md`](./docs/OWNER-GUIDE.md)**

Please follow that guide step by step for a working installation — it covers requirements,
`.env` configuration, first-run setup, starting the server, and production hardening.

## Documentation

The same documentation is also available inside the running app, under **Documentation** in the
owner sidebar.

## Usage Terms

- **Personal / non-commercial use:** You are free to install and use this software for personal,
  educational, or internal non-commercial purposes.
- **Commercial use:** If you intend to use this software commercially (including but not limited
  to selling access, offering it as a paid service, deploying it for a paying client, or any
  revenue-generating use), you **must first obtain written permission from the developer**.
  Please reach out before commercial deployment:

  📧 **moradiashivam@gmail.com**

- **No code modification:** Modification of the source code is **not permitted**. The software
  must be used as distributed. If you need a change, feature, or customization, please contact
  the developer at the email above rather than modifying the code yourself.

By downloading, installing, or using this software, you agree to the terms above.

## Support

For questions, permissions, or customization requests, contact:

📧 **moradiashivam@gmail.com**
