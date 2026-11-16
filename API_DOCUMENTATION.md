# API documentation
There is **no public REST/JSON API yet**. The app uses React Server Components and Next.js Server Actions; CSRF is mitigated by Next's Origin/Host check on actions plus SameSite=Lax cookies.

**Server actions** (`src/app/actions/*`): `auth` (register, login, logout, forgot/reset password, verify email), `worker` (profile sections, availability, unavailable dates, saved list, apply, withdraw/accept/decline), `business` (save/publish opportunity, status, application status/note, profile, verification submit), `admin` (user status, moderation, verification decision, publish matching rules, catalog).

**Service layer** (`src/server/services/*`) is the real contract — each function validates input (Zod), authorises, and throws `ServiceError(code)` (`validation|conflict|forbidden|not_found|rate_limited|auth`). It is the intended base for a future typed HTTP API (webhooks for payments will need route handlers).

**Public machine-readable endpoints:** `/sitemap.xml`, `/robots.txt`.
