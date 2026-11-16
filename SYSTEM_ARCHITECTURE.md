# System architecture
**Modular monolith**, Next.js 16 (App Router, server components, server actions) + TypeScript + Tailwind 4, PostgreSQL 16 via Drizzle ORM (`pg` Pool). No microservices.

```
src/app/            routes: (public), (auth), worker/, business/, admin/, actions/ (server actions)
src/components/     UI primitives + shells + forms (no business logic)
src/lib/brand.ts    centralised brand config
src/server/
  db/               schema.ts, client.ts, seed-data.ts
  auth/             password (argon2id), sessions (hashed tokens), guards
  services/         domain logic: identity, worker, business, opportunities, applications, matching, admin, catalog
  matching/score.ts pure, framework-free scoring engine
  rbac.ts audit.ts rate-limit.ts email.ts
drizzle/            SQL migrations (0000 schema, 0001 integrity+audit triggers)
```
**Rules:** React components contain no business rules. Mutations go page → server action (`src/app/actions`) → service. Services validate with Zod, authorise (ownership/role), run transactions, write audit rows. Actions redirect with `?ok=`/`?error=` so the app works without client JS.

**Auth:** own implementation (not Supabase) to avoid an external dependency while the product is pre-launch: argon2id, random 256-bit session tokens stored as SHA-256 hashes, httpOnly/SameSite=Lax cookie (Secure in production), 30-day expiry, sessions revoked on password reset and suspension. Swapping to a managed provider only touches `auth/` and `identity.ts`.

**Matching:** `matching/score.ts` is pure. `services/matching.ts` loads rules (active `matching_rules` row) + data and calls it. See MARKETPLACE_WORKFLOWS.md.

**Provider abstractions:** email (`email.ts`, only an `outbox` driver exists). Geocoding/maps, AI, search, storage, payments are **not yet abstracted or implemented**.
