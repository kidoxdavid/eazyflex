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
| `STORAGE_DIR` | Private upload directory (default `./.storage`, git-ignored) |
Planned (unused): Stripe keys, storage, mapping, AI provider keys. Never commit `.env*` (git-ignored).
