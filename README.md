# Openhour — flexible talent marketplace (working name)

A marketplace connecting businesses/households with people seeking flexible work. Launch market: Calgary, Alberta; nothing in the logic is hard-coded to Calgary (service areas are database rows). The brand name lives in `src/lib/brand.ts` and design tokens in `src/app/globals.css`.

> **Status: Phase 1 (foundation) complete + the explainable matching engine and admin basics from Phase 2. Not production-ready.** Payments, messaging, assignments, reviews, disputes, packaged services, work-sharing, AI features, push/email delivery and third-party verification are **not built**. See `DEVELOPMENT_ROADMAP.md` for an honest feature-by-feature status.

## Quick start

Requires Node 22+, PostgreSQL 16.

```bash
npm install
cp .env.example .env.local            # set DATABASE_URL (and TEST_DATABASE_URL)
createdb eazyflex && createdb eazyflex_test
npm run db:migrate                    # apply SQL migrations in ./drizzle
npm run db:seed                       # reference data + clearly-labelled DEMO data
npm run dev                           # http://localhost:3000
```

Reset to a clean database: `npm run db:reset && npm run db:seed` (refuses to run when `NODE_ENV=production`).

Demo admin accounts also require a code from an authenticator: add the **public demo key** `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` to any authenticator app (or compute it — the e2e tests do). To fill the app with realistic in-flight activity for demos/screenshots: `npm run db:demo-activity` after seeding.

Demo accounts (password `DemoPass2026!`, all flagged `is_demo`, fictional): `priya@demo.test` (worker), `owner@maple.demo.test` (business), `admin@demo.test` (super admin), plus `moderator@`, `verifier@`, `finance@`, `analyst@demo.test` for per-role permission checks.

In development emails are written to the `email_outbox` table (no delivery) and visible at `/dev/outbox` (disabled in production).

## Commands
| | |
|---|---|
| `npm run dev / build / start` | Next.js |
| `npm test` | Vitest: unit + integration tests against the **test** database (it is dropped and recreated) |
| `npm run typecheck` | `tsc --noEmit` |
| `node tests/e2e/journey.mjs` | Browser journey (Playwright) against a running app (`BASE_URL`) |
| `npm run test:e2e` | Build, seed, start in production mode, then journey + keyboard checks + axe audit (what CI runs; needs a disposable `DATABASE_URL`) |
| `npm run drill:restore` | Backup → erase → restore → re-apply-erasure drill on a seeded disposable DB (`DATABASE_URL`, `ADMIN_DATABASE_URL`) |
| `node scripts/screenshots.mjs` | Regenerates `docs/screenshots/` from a running, seeded app |
| `npm run db:generate` | New migration from schema changes (drizzle-kit) |

## Documentation
See the `*.md` files at the repo root (plus `ACCESSIBILITY.md`, `RUNBOOK.md`, `THREAT_MODEL.md`, `LAUNCH_CHECKLIST.md`): PRODUCT_OVERVIEW, PRODUCT_REQUIREMENTS, SYSTEM_ARCHITECTURE, DATABASE_SCHEMA, API_DOCUMENTATION, USER_ROLES_AND_PERMISSIONS, MARKETPLACE_WORKFLOWS, PAYMENT_ARCHITECTURE, SECURITY_AND_PRIVACY, DEPLOYMENT_GUIDE, ENVIRONMENT_VARIABLES, TESTING_GUIDE, ADMIN_GUIDE, DEVELOPMENT_ROADMAP, CHANGELOG.

*This software does not provide legal, tax or employment advice. Terms and Privacy pages are draft placeholders that require legal review.*
