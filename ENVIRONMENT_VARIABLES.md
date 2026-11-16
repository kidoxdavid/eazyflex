# Environment variables
| Name | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (required) |
| `TEST_DATABASE_URL` | Test DB; **dropped and recreated by `npm test`** (helpers refuse names without "test") |
| `APP_URL` | Absolute base URL for links in emails, sitemap, metadata |
| `EMAIL_DRIVER` | `outbox` (default; queues only, delivers nothing) or `smtp` |
| `SMTP_URL`, `EMAIL_FROM` | Required with `EMAIL_DRIVER=smtp`, e.g. `smtps://user:pass@host:465` |
| `APP_SECRET` | **Required in production** (≥ 32 random chars): encrypts TOTP seeds at rest. Rotating it invalidates enrolled authenticators (admins must be reset by a super administrator) |
| `MFA_ENFORCEMENT` | `required` (default when `NODE_ENV=production`) or `optional`. Enrolled admins are always challenged |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `APP_RELEASE` / `GIT_SHA` | Error reporting to a Sentry-compatible ingest; release label |
| `LOG_LEVEL` | `debug|info|warn|error|silent` (default `info`) |
| `STORAGE_DRIVER` | `local` (default) or `s3`. In production `local` requires `STORAGE_DIR` |
| `S3_BUCKET` (required for s3), `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_PREFIX`, `S3_SSE` (`AES256`/`aws:kms`), `S3_KMS_KEY_ID` | S3-compatible private storage (server-side encryption on by default) |
| `SCAN_DRIVER` | `none` (default) or `clamav`; with `CLAMD_HOST`, `CLAMD_PORT` (3310), `CLAMD_TIMEOUT_MS` |
| `SCAN_REQUIRED` | Default `true` in production: uploads are refused unless they were scanned (fail closed) |
| `BACKUP_DIR`, `BACKUP_PASSPHRASE`, `BACKUP_RETENTION_DAYS`, `ADMIN_DATABASE_URL`, `LEDGER_FILE` | Used by `scripts/backup.sh`, `restore-test.sh`, `restore-drill.sh`, deletion-ledger scripts |
| `STORAGE_DIR` | Private upload directory (default `./.storage`, git-ignored) |
Planned (unused): Stripe keys, storage, mapping, AI provider keys. Never commit `.env*` (git-ignored).
