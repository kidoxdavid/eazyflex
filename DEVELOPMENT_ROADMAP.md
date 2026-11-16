# Roadmap (honest status)
**Phase 1 Foundation — done** (see PRODUCT_REQUIREMENTS.md for gaps: uploads, references, one-off availability dates, saved-search alerts).
**Phase 2 — done** apart from: web push notifications (needs service worker/VAPID and a browser-permission UX), malware scanning of uploads, an S3-compatible storage driver, and in-process/queued email dispatch (today a scheduled `npm run emails:send`).
**Phase 3 Payments:** not started (Stripe Connect, commission rules, ledger, payouts, refunds, subscriptions, finance reporting).
**Phase 4 Advanced — done apart from items that need external services or payments:** work-sharing/coverage engine, handovers, saved searches with alerts, team members, recurring sessions and renewals. Remaining: map-based local discovery (needs a geocoding provider), packaged services (listings can be built, but orders need payments), time-zone-aware scheduling, date-specific (non-weekly) coverage and sessions, multiple memberships per person.
**Phase 5 Intelligence:** not started (AI assistants behind a provider abstraction, analytics, fraud monitoring, multi-region).
**Cross-cutting before launch:** CI/CD, monitoring, CSP, MFA for admins, accessibility audit, legal/privacy review, real email provider, licensed imagery, data export/deletion.
