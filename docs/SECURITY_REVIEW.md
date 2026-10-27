# Security review — Task 2 (2026-10-27)

Scope: GitHub source inspection and read-only Render PostgreSQL metadata. No penetration test or live Meta writes.

## Verified source controls
- webhook.js validates x-hub-signature-256 with HMAC SHA256 over raw body, using timingSafeEqual, and returns 401 on invalid signature.
- approvalEngine.js uses 6-digit code, digest, tenant-scoped DB lookup, transaction row locks, 1–30 minute TTL (default 10), consumed state, plan hash, Meta account/generation checks and audit entries.
- approvalPolicy.js validates structured intent, allowed fields and account target. metaWrite.js blocks writes unless META_WRITES_ENABLED=true and READ_ONLY=false, and requires execution permit.
- aiService.js validates input/output shapes and blocks action plans in planning-only mode; not a complete cost budget control.
- auth.js supports AUTHORIZED_PHONE_NUMBERS and PUBLIC_ONBOARDING_ENABLED. Public onboarding broadens who can enter and requires review of downstream authorization.

## Verified database risks
- All 44 public tables have rowsecurity=false; DB-level tenant isolation is NOT enforced by RLS. Many tenant tables have client_id FKs to clients; application filters must be exhaustively audited.
- DB login role campaign_bachat_user has rolcreatedb=true and rolcreaterole=true, and broad table privileges; not least-privilege.
- Render DB network allowlist 0.0.0.0/0; current pg_stat_ssl snapshot showed 4 SSL sessions, but this does not prove all clients require TLS.
- Meta/social connection tables include token_ciphertext columns; encryption at rest algorithm and key rotation were not verified.

## Findings and severity
| ID | Finding | Severity | Mitigation (not applied to production) |
|---|---|---|---|
| S1 | No RLS across 44 tables | High | Audit every tenant query; plan RLS in separate migrations and test role boundaries |
| S2 | Broad DB role privileges (CREATEDB/CREATEROLE) | High | Separate migration role from runtime least-privilege role |
| S3 | Public DB IP allowlist | High | Restrict after validating Render connectivity; no change in this task |
| S4 | Expiring free DB | Critical availability | Confirm upgrade/export before 2026-11-24 |
| S5 | Tenant and approval integration tests not independently rerun here | Unverified | Run isolated Node 22 test suite and adversarial cross-tenant tests |
| S6 | Secret encryption/key lifecycle not verified | Unverified | Inspect token crypto implementation, rotation and log redaction |

No code fix was made without a reproducible failing test. No production config or data was changed.
