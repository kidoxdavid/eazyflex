# Changelog
## Unreleased — Remaining pre-launch gaps
- **Fixed a defect that broke every fresh clone and CI:** `.gitignore`'s bare `coverage` rule had silently excluded `src/server/coverage/`, `src/app/worker/coverage/` and `src/app/business/opportunities/[id]/coverage/` from git. Found by the first real GitHub CI run; the fixed commit passes all CI jobs.
- Error monitoring (structured logs, scrubbing, Sentry-compatible reporter, `onRequestError`, request ids), `/api/health` and `/api/ready`.
- Backup/restore: `backup.sh`, `restore-test.sh`, `restore-drill.sh`, deletion ledger + re-apply scripts, retention job; CI `restore-drill` job. Migration `0007_deletion_ledger`.
- Malware scanning via clamd (fail closed) and an S3-compatible storage driver.
- Static authorisation-coverage tests; moved the recovery-code cookie hand-off out of a `"use server"` file (anything exported from one is a public endpoint).
- RUNBOOK, THREAT_MODEL, LAUNCH_CHECKLIST.

## Pre-launch hardening
- Nonce-based CSP and extra security headers; `__Host-` session cookie; 8 h admin sessions; admin TOTP 2FA (recovery codes, replay protection, enforced on every admin request, super-admin reset); data export and account deletion; failed-attempt-only throttles; registration rate limit. Migration `0006_hardening`.
- Accessibility: axe audit tooling (0 violations on 98 page views), keyboard checks, contrast token fix, keyboard-reachable scroll regions, focus ring on time inputs, focusable `<main>`. See `ACCESSIBILITY.md`.
- CI workflow (`.github/workflows/ci.yml`) and `scripts/e2e.sh`; Dependabot config.
- Fixed: login throttle counted successful sign-ins (could lock out a shared network); home page ignored flash messages (no confirmation after account deletion).
- Demo-activity script and screenshot script; screenshots in `docs/screenshots/`.
- 204 Vitest tests + 27-step Playwright journey + keyboard checks + axe audit.

## Team members and recurring renewals
- Business team: invitations, owner/manager/member roles enforced on all write paths, role changes, removal. Recurring assignments: dated sessions, logging/confirmation/missed/cancel, term close-out, worker-accepted renewal offers, reminder/expiry job. Migration `0005_team_and_renewals`.
- Fixed a Phase 1 bug: the business overview always showed 0 applicants per opportunity (a correlated subquery bound to the wrong table); added regression tests.
- 178 Vitest tests + 24-step Playwright journey.

## Phase 4 (non-payment pieces)
- Work-sharing / coverage engine: suggestions, proposals, explicit worker confirmation, gap/overlap/clash detection, weekly chart, handover notes. Saved searches with alert digests. Migration `0004_phase4_coverage`.
- 134 Vitest tests + 22-step Playwright journey.

## Phase 2 leftovers
- Screening questions; file attachments (private storage, validated, authorised downloads); email notifications with per-category preferences and SMTP delivery; admin reports queue for messages and reviews with audited content access; review hiding. Migration `0003_phase2_leftovers`.
- 95 Vitest tests + 20-step Playwright journey.

## Phase 2 collaboration
- Worker shortlist, invitations, messaging (with contact-detail guard), assignments with work submissions/hours/approval, blind reviews with public worker ratings, notification centre. Migration `0002_phase2`.
- 79 Vitest tests + 19-step Playwright journey.

## Initial build
- Next.js 16 / Drizzle / PostgreSQL foundation, migrations, seed/reset.
- Public site, auth, worker/business/admin portals (see PRODUCT_REQUIREMENTS.md).
- Explainable matching engine with versioned admin-configurable rules and confidence-scaled scores.
- Test suites: 63 Vitest tests + 18-step Playwright journey (see TESTING_GUIDE.md).
