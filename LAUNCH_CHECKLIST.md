# Pre-launch checklist
Legend: ✅ done and verified here · 🟡 built, needs configuration/operation by you · 🧑 needs a person or an external party (I cannot do these) · ⛔ not built

## Engineering
- ✅ CI green on GitHub (typecheck, migration drift, 250+ tests, build, audit, browser journey, keyboard + axe audit); a fresh clone builds and tests
- ✅ Authorisation coverage guard in the test suite; admin 2FA; CSP; export/deletion; retention job; restore drill (local + CI)
- 🟡 Set production env: `APP_SECRET`, `DATABASE_URL`, `APP_URL=https://…`, `MFA_ENFORCEMENT` (default required), `SMTP_URL`/`EMAIL_FROM`, `STORAGE_DRIVER=s3` + `S3_*`, `SCAN_DRIVER=clamav` + `CLAMD_HOST`, `SENTRY_DSN`
- 🟡 Run clamd (with freshclam updates) reachable from the app; confirm an EICAR upload is blocked in staging
- 🟡 Run the app as a non-owner DB role; separate migration role
- 🟡 Schedule the jobs (emails, alerts, renewals, retention, backup, deletion-ledger export) and create the alerts in RUNBOOK.md
- 🟡 Off-host encrypted backups + object-storage versioning; run `scripts/restore-test.sh` against a real backup
- 🟡 SPF/DKIM/DMARC for the sending domain; consider bounce/complaint handling
- 🟡 Staging environment mirroring production; test migrations on a copy of production data
- ⛔ Payments (Phase 3) · WebAuthn/passkeys · 2FA for non-admin users · password-breach check · CAPTCHA/bot management · CDN/WAF · load/performance testing

## Legal, privacy and policy 🧑
- Terms of Service and Privacy Policy written by counsel (currently draft placeholders) — include backup-retention disclosure, cross-border processing, breach process
- Employment/contractor classification, Alberta employment standards, agency licensing, WCB/OHS, insurance, tax reporting, human-rights obligations, background-check and vulnerable-sector rules for regulated categories (Education is seeded as "needs approval")
- CASL compliance review of notification emails; consent wording; unsubscribe handling
- Appoint a privacy officer; define the access/erasure request procedure beyond self-service
- Content/community guidelines and a moderation policy for the Reports queue

## Quality and trust 🧑
- Independent penetration test; remediate findings
- Manual accessibility testing with screen readers/zoom/high-contrast (automated audit passes; conformance is NOT claimed)
- Licensed photography/brand assets; final brand name, domain and logo
- Real customer testimonials only (none are shown today)
- Support process: monitored inbox, response targets, escalation to admins

## Business decisions still open
- Payment provider/account, commission and fee schedule, tax presentation, refund/dispute policy (all of Phase 3)
- Verification providers for identity/qualifications and what badges mean
- Launch geography rules beyond Calgary service areas; pricing of subscriptions/featured listings
