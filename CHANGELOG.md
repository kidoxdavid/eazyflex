# Changelog
## Unreleased — Phase 4 (non-payment pieces)
- Work-sharing / coverage engine: suggestions, proposals, explicit worker confirmation, gap/overlap/clash detection, weekly chart, handover notes. Saved searches with alert digests. Migration `0004_phase4_coverage`.
- 134 Vitest tests + 22-step Playwright journey.

## Phase 2 leftovers
- Screening questions; file attachments (private storage, validated, authorised downloads); email notifications with per-category preferences and SMTP delivery; admin reports queue for messages and reviews with audited content access; review hiding. Migration `0003_phase2_leftovers`.
- 95 Vitest tests + 20-step Playwright journey.

## Phase 2 collaboration
- Worker shortlist, invitations, messaging (with contact-detail guard), assignments with work submissions/hours/approval, blind reviews with public worker ratings, notification centre. Migration `0002_phase2`.
- 79 Vitest tests + 19-step Playwright journey.

## Initial build
- Next.js 16 / Drizzle / PostgreSQL foundation, migrations, seed/reset.
- Public site, auth, worker/business/admin portals (see PRODUCT_REQUIREMENTS.md).
- Explainable matching engine with versioned admin-configurable rules and confidence-scaled scores.
- Test suites: 63 Vitest tests + 18-step Playwright journey (see TESTING_GUIDE.md).
