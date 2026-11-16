# Environment variables
| Name | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (required) |
| `TEST_DATABASE_URL` | Test DB; **dropped and recreated by `npm test`** (helpers refuse names without "test") |
| `APP_URL` | Absolute base URL for links in emails, sitemap, metadata |
| `EMAIL_DRIVER` | `outbox` (default, records only). Other values throw until a driver is implemented |
Planned (unused): Stripe keys, storage, mapping, AI provider keys. Never commit `.env*` (git-ignored).
