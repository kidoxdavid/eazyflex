# Roles and permissions
**Account kinds:** worker, business (members: owner/manager/member — only the creator/owner exists today), admin.
**Admin roles → permissions** (`src/server/rbac.ts`, enforced in route guards *and* every admin service function via `assertCan`):

| Role | Permissions |
|---|---|
| super_admin | all (incl. `reports.review`), `admins.manage`, changing other admins' status |
| platform_admin | dashboard, users view/suspend, verification, moderation, catalog, matching, reports review, audit |
| verification_officer | dashboard, users view, verification decisions |
| support_agent | dashboard, users view, reports review |
| finance_admin | dashboard, finance.configure, audit view |
| content_moderator | dashboard, moderation, catalog, reports review |
| read_only_analyst | dashboard, audit view |

Ownership rules: a worker only reads/changes their own profile, availability and applications (others return "not found"); a business only touches opportunities of businesses it belongs to; cross-business access returns not-found rather than forbidden. Admins cannot suspend themselves; only super admins can change another admin. Admin user listings exclude password hashes; there is no admin access to messages/documents (neither exists yet). Suspension revokes sessions immediately.
