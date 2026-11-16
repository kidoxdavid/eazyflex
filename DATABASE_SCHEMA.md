# Database schema (PostgreSQL, UUID keys, Drizzle; source of truth `src/server/db/schema.ts` + `drizzle/*.sql`)
**Identity:** `users` (kind worker|business|admin, `admin_role`, status, unique lower(email)), `sessions` (hashed token), `auth_tokens` (email_verification / password_reset, hashed, single-use), `user_consents` (document+version), `rate_limits`, `email_outbox`.
**Reference (admin-editable):** `categories` (requires_approval, allowed_engagement_types), `skills`, `service_areas` (lat/lng; replaces hard-coded cities).
**Workers:** `worker_profiles` (preferences, rates, hard-min flag, availability pause, onboarding state), `worker_skills`, `worker_experience`, `worker_education`, `worker_certifications` (self-declared until verified), `worker_availability` (weekday/minute windows), `worker_unavailability` (date ranges).
**Verification:** `verifications` (type × status × provider, decided_by/at, expiry).
**Businesses:** `businesses` (registered_business | household, verification_status), `business_members` (owner/manager/member).
**Marketplace:** `opportunities` (6 engagement types, 4 pay types, cents, generated `tsvector` + GIN index), `opportunity_skills` (mandatory flag), `opportunity_schedules`, `saved_opportunities`, `saved_searches` (no UI yet).
**Applications:** `applications` (unique per opportunity+worker, match snapshot, private business note), `application_status_history`.
**Other:** `notifications`, `matching_rules` (versioned; partial unique index = one active), `platform_settings`, `audit_logs`, `admin_notes`.

**Integrity (migration 0001):** pay range checks, schedule/availability range checks, `(kind='admin') = (admin_role is not null)`, single active matching rule, and **append-only `audit_logs`** (BEFORE UPDATE/DELETE and TRUNCATE triggers raise). Note: a superuser/table owner can drop triggers — for production, run the app as a non-owner role without DDL rights.

**Not yet modelled (brief lists them):** assignments, time entries, services/packages/orders, conversations/messages, payments/ledger/payouts/refunds/disputes, reviews, subscriptions/plans, pricing rules, feature flags, templates, analytics tables, documents.
