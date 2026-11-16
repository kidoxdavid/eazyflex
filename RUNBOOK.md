# Operations runbook
Audience: whoever is on call. Everything here corresponds to something implemented and (where noted) tested; gaps are called out rather than hidden.

## 1. Health, logs and alerting
- **Liveness** `GET /api/health` → 200 `{status:"ok"}` (no dependencies; use for restart decisions). **Readiness** `GET /api/ready` → 200 when the database answers and migrations are applied, else 503 with a coarse reason (`database` | `migrations`) and nothing sensitive (use for load-balancer rotation). Neither is indexed (`/api` is disallowed in robots.txt).
- **Logs**: one JSON object per line (`ts, level, msg, service, env, requestId, …`) on stdout/stderr; personal data and secret-named fields are scrubbed before logging. `LOG_LEVEL=debug|info|warn|error|silent` (default `info`). Every response carries `x-request-id`; quote it when investigating.
- **Error reporting**: set `SENTRY_DSN` (any Sentry-compatible ingest) and optionally `SENTRY_ENVIRONMENT`, `APP_RELEASE`/`GIT_SHA`. Unhandled render/route/server-action errors are captured through Next's `onRequestError`; identical errors are de-duplicated (5/min each, 50/min overall); only an opaque user id is attached. Reporting failures never affect requests. *This is a minimal reporter (no tracing/source maps/session replay); replace with `@sentry/nextjs` if you need those.*
- **Alerts to create** (the platform doesn't create them for you): readiness failing ≥ 2 min; error rate or new-issue alerts from the reporter; 5xx rate at the proxy; `email_outbox` rows stuck in `queued` > 1 h (when SMTP is on); `mfa.failed` or `account.deleted` spikes in `audit_logs`; backup job failure; disk/storage growth.
- **Scheduled jobs** (nothing runs these automatically): `npm run emails:send` (every minute), `npm run alerts:send` (daily/hourly), `npm run renewals:run` (daily), `npm run retention:run` (daily), `npm run backup` (at least daily), `npm run deletions:export` (after each day's backup; see §3).

## 2. Deploy / rollback
`npm ci && npm run build`, then `npm run db:migrate` **before** starting the new version, then `next start`. Migrations are forward-only SQL in `drizzle/`; to roll back code, redeploy the previous build (migrations are additive so the old build keeps working) and restore data only via §3. Required env: see ENVIRONMENT_VARIABLES.md (`APP_SECRET`, `DATABASE_URL`, `APP_URL=https://…`, storage + scanner + SMTP). CI refuses a schema change without a migration.

## 3. Backups, restore drills and erasure survival
- **What**: `npm run backup` (`scripts/backup.sh`): `pg_dump` custom format → AES-256 encryption (`BACKUP_PASSPHRASE`) → SHA-256 manifest → prune older than `BACKUP_RETENTION_DAYS` (35). **Uploaded files** live in object storage, not the database: enable bucket versioning + replication there; they are *not* part of `pg_dump`.
- **Targets (proposed — confirm with the business)**: RPO ≤ 24 h (daily backup; use managed Postgres point-in-time recovery for ≤ 5 min), RTO ≤ 4 h.
- **Keep off-host**: ship `BACKUP_DIR` to separate-account object storage with versioning and delete protection. A backup stored beside the database is not a backup. Store the passphrase in the secrets manager, separately.
- **Drill (monthly, and in CI on every change)**: `scripts/restore-test.sh <file>` restores into a scratch database, checks table/migration counts, the audit-log immutability trigger and row counts against the source. `npm run drill:restore` runs the whole story on a seeded disposable database: backup → erase a user *after* the backup → export the deletion ledger → restore the old backup → re-apply erasures → assert the user is anonymised. It passes locally and runs in CI.
- **Erasure vs. backups (PIPEDA/PIPA)**: erased people persist in backups until those age out (≤ 35 days with the default). That is disclosed in the privacy policy (legal text still to be written). To ensure a restore never resurrects them: run `LEDGER_FILE=<path outside the backups> npm run deletions:export` after each backup, keep that file with long retention, and after **any** restore run `LEDGER_FILE=<same file> npm run deletions:reapply` against the restored database *before* putting it into service. The ledger holds only opaque user ids.
- **Disaster procedure**: provision DB → `restore-test.sh` style restore into the new DB → `deletions:reapply` → `db:migrate` (to catch up newer migrations) → point the app at it → verify `/api/ready`, sign in, and spot-check recent data → restore object storage if needed → record the incident.

## 4. Data retention (`npm run retention:run`)
Purges: expired sessions; used/expired auth tokens 7 days after; rate-limit rows after 1 day; sent/failed emails after 90 days; stuck queued emails after 30 days; read notifications after 180 days, unread after 365 days. **Never purged**: audit logs (append-only, opaque ids), engagement records, consent records. Periods live in `src/server/services/retention.ts` (`RETENTION`) and are tested.

## 5. Security incidents
1. **Contain**: suspend affected accounts (Admin → Users; revokes sessions), reset an admin's 2FA only after identity is re-verified out-of-band, rotate `APP_SECRET` (invalidates all enrolled authenticators — plan re-enrolment) and SMTP/storage/scanner credentials as relevant.
2. **Investigate**: `audit_logs` (append-only; `mfa.*`, `account.*`, `report.*`, `file.accessed_by_admin`, `upload.blocked`), request ids in logs, `file` access records.
3. **Notify**: a breach of security safeguards involving personal information that creates a *real risk of significant harm* must be reported to the Privacy Commissioner (PIPEDA) / Alberta OIPC (PIPA) and affected individuals, and a breach record kept (24 months under PIPEDA). Get counsel involved immediately; this runbook is not legal advice.
4. **Malware found**: infected uploads are blocked and audited (`upload.blocked` with the signature name); nothing is stored. If the scanner is down in production, uploads are refused (fail closed) — restore clamd, don't relax `SCAN_REQUIRED`.

## 6. Secret rotation
| Secret | Effect of rotating |
|---|---|
| `APP_SECRET` | Existing TOTP seeds can't be decrypted → every admin must be reset by a super administrator and re-enrol. Do it deliberately. |
| `BACKUP_PASSPHRASE` | Old backups still need the old passphrase — keep it until they age out. |
| `SMTP_URL`, `S3_*`, `SENTRY_DSN` | Update env, restart; no data impact. |
| Database credentials | Update `DATABASE_URL`; run the app as a **non-owner** role without DDL rights (so audit-log triggers can't be dropped), and a separate role for migrations. |
