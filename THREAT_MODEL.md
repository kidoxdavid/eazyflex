# Threat model (working document)
Method: assets → actors → threats → mitigations in code → residual risk. "Mitigation" entries point at things that exist and are tested; residual risk is stated, not hidden. Not a substitute for an independent penetration test.

## Assets (what an attacker wants)
1. Personal data of workers/households (names, phone, email, availability, work history, messages). 2. Admin capability (suspend users, moderate, change matching rules, read reported messages). 3. Uploaded files. 4. Integrity of engagement/review records. 5. Availability of the service. 6. Later: money (not built).

## Actors
Anonymous internet user · registered worker/business (malicious or compromised) · a business team member with too much trust · a compromised admin account · malicious insider with DB access · automated abuse (spam, scraping, credential stuffing).

## Threats and mitigations
| # | Threat | Mitigations (implemented) | Residual risk |
|---|---|---|---|
| T1 | Account takeover (credential stuffing/phishing) | argon2id; failed-attempt throttles per account and IP; generic errors; password reset revokes sessions; `__Host-` HttpOnly cookie; admin TOTP + replay protection | Workers/businesses have no 2FA; no breach-password check; phishing of TOTP codes possible (no WebAuthn) |
| T2 | Broken access control (IDOR, cross-business, worker↔worker) | Service-layer ownership checks on every query path; outsiders get "not found"; business role matrix; admin `assertCan`; static guard test fails the build if an action/route lacks authentication | Logic flaws in new code; guard checks presence, not correctness |
| T3 | Privilege escalation to admin | Separate admin kind, MFA enforced on every admin request (not just login), 8 h sessions, super-admin-only admin changes, audit log | Compromised super admin; no step-up auth for sensitive actions |
| T4 | XSS | React escaping; CSP with per-request nonce, no inline/eval scripts; `dangerouslySetInnerHTML` only for escaped JSON-LD (test-enforced) | `style-src-attr 'unsafe-inline'` (inline style attributes) is allowed |
| T5 | CSRF | Server actions' Origin check, SameSite=Lax session cookie, POST-only state-changing routes, `form-action 'self'` | — |
| T6 | Injection (SQL) | Drizzle parameterisation; no `sql.raw` in app code (test-enforced); two correlated-subquery bugs found and fixed | Raw SQL fragments in services must keep being reviewed |
| T7 | Malicious uploads | Extension allow-list + magic-byte check, size/count limits, private random keys, authorised downloads as attachments with sandbox CSP, **clamd malware scan that fails closed**, admin access only to reported content (audited) | ClamAV signature coverage isn't perfect; no content-disarm for office macros beyond the scan; scanner must be operated and updated |
| T8 | Data leakage by design (PII to the wrong party) | Workers shown as "First L." to businesses; contact details blocked in messages until an engagement exists; export excludes others' data; logs and error reports scrubbed | Free-text fields (proposals, messages) can contain anything users type |
| T9 | Abuse: spam, scraping, harassment | Rate limits (login, MFA, register, invites, messages, uploads, exports); report flows with audited moderation; blind reviews | No CAPTCHA/bot management; limits are per-instance fixed windows in Postgres, no edge/WAF |
| T10 | Insider/DB tampering with history | Append-only audit log via triggers; deletion ledger; backups encrypted | Table owner can drop triggers — run the app as a non-owner role; DBAs are trusted |
| T11 | Data loss / ransomware | Encrypted off-host backups, monthly + CI restore drills, migrations in version control | Backup operations and object-storage versioning are the operator's job |
| T12 | Privacy-law exposure (erasure, access, retention) | Export, anonymise-in-place deletion, retention job, ledger-based re-erasure after restore | Backups retain erased data ≤ 35 days; legal text and breach procedures need counsel |
| T13 | Supply chain | Lockfile, `npm audit` (high+) in CI, Dependabot, no third-party browser scripts or origins | Transitive risk remains; no SBOM/signing yet |
| T14 | Denial of service | Rate limits; health/readiness; request-size limits (35 MB action body cap) | No CDN/WAF; expensive queries (search, matching) unbounded per user beyond limits |
| T15 | Misuse of matching/AI to discriminate | Matching inputs exclude protected characteristics; explainable scores; versioned, audited rules; no automatic hiring decisions | Proxies in free-text profile data aren't analysed; no AI features built yet |

## Out of scope / not yet applicable
Payments (not built), AI assistants (not built), third-party identity verification (not built), mobile apps.
