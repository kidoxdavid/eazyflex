# Environment variables
| Name | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (required) |
| `TEST_DATABASE_URL` | Test DB; **dropped and recreated by `npm test`** (helpers refuse names without "test") |
| `APP_URL` | Absolute base URL for links in emails, sitemap, metadata |
| `EMAIL_DRIVER` | `outbox` (default; queues only, delivers nothing) or `smtp` |
| `SMTP_URL`, `EMAIL_FROM` | Required with `EMAIL_DRIVER=smtp`, e.g. `smtps://user:pass@host:465` |
| `STORAGE_DIR` | Private upload directory (default `./.storage`, git-ignored) |
Planned (unused): Stripe keys, storage, mapping, AI provider keys. Never commit `.env*` (git-ignored).
