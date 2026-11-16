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

**Business roles** (`src/server/business-rbac.ts`, enforced in the service layer on every write; reads need only membership):

| Role | Can |
|---|---|
| owner | everything: team management, verification, profile, posting, hiring |
| manager | post/edit work, hiring decisions (applications, offers, shortlist/invite, assignments, coverage, sessions, renewals, reviews), edit profile, invite **members** |
| member | read-only; can message people the business already works with |

A person belongs to exactly one business. People join by emailed invitation (hashed single-use token, 7 days, must match the invited email): either by registering through the link (the account joins the existing business instead of creating one, and its email counts as verified because the link proved mailbox control) or, for an existing business account with no team, by accepting while signed in. Only an owner can invite managers or change roles; the owner cannot be removed or leave. Outsiders get "not found".

Ownership rules: a worker only reads/changes their own profile, availability and applications (others return "not found"); a business only touches opportunities of businesses it belongs to; cross-business access returns not-found rather than forbidden. Admins cannot suspend themselves; only super admins can change another admin. Admin user listings exclude password hashes; there is no admin access to messages/documents (neither exists yet). Suspension revokes sessions immediately.
