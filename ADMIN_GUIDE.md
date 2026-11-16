# Admin guide
Sign in at `/sign-in` with an admin account (demo: `admin@demo.test`). The sidebar shows only sections your role permits; direct URLs you lack permission for redirect to the dashboard with an error.
- **Users:** search; suspend/restrict/reactivate with a mandatory reason (sessions revoked; written to audit and notes).
- **Opportunities:** approve/reject pending (rejection reason is shown to the business), pause, close, feature.
- **Verification:** business (and future) queue: verify / needs review / reject. Badges appear only after "verified".
- **Categories & skills:** add/edit/hide; mark "needs approval" for regulated/sensitive categories (postings there go to review). Education is seeded as needs-approval; tutoring involving minors should be reviewed.
- **Matching rules:** edit weights, thresholds, mandatory set → publishes a new immutable version.
- **Reports:** reported messages (the message plus up to 3 earlier ones) and reported reviews. Resolve with a note; hiding a review removes it from display and ratings. Viewing message content and opening reported attachments is audit-logged; access ends once the report is resolved.
- **Audit log:** newest 150 entries.
Moderation of all postings can be turned on by setting `platform_settings.moderation.all_postings` to `true` (no UI toggle yet).
