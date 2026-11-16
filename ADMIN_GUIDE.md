# Admin guide
Sign in at `/sign-in` with an admin account (demo: `admin@demo.test`, password `DemoPass2026!`). After the password you must enter a 6-digit code from an authenticator app (or a recovery code). **Demo admins share a public demo authenticator key `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP`** — add it to any authenticator app to sign in. A new admin is walked through enrolment (QR code, then 8 recovery codes shown once). Lost device: a super administrator opens **Users** and chooses "Reset two-factor authentication"; the admin enrols again at next sign-in. The sidebar shows only sections your role permits; direct URLs you lack permission for redirect to the dashboard with an error.
- **Users:** search; suspend/restrict/reactivate with a mandatory reason (sessions revoked; written to audit and notes).
- **Opportunities:** approve/reject pending (rejection reason is shown to the business), pause, close, feature.
- **Verification:** business (and future) queue: verify / needs review / reject. Badges appear only after "verified".
- **Categories & skills:** add/edit/hide; mark "needs approval" for regulated/sensitive categories (postings there go to review). Education is seeded as needs-approval; tutoring involving minors should be reviewed.
- **Matching rules:** edit weights, thresholds, mandatory set → publishes a new immutable version.
- **Reports:** reported messages (the message plus up to 3 earlier ones) and reported reviews. Resolve with a note; hiding a review removes it from display and ratings. Viewing message content and opening reported attachments is audit-logged; access ends once the report is resolved.
- **Audit log:** newest 150 entries.
Moderation of all postings can be turned on by setting `platform_settings.moderation.all_postings` to `true` (no UI toggle yet).
