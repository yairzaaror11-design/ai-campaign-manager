# Decision log

- Use revised master and explicit autonomy; isolated development continues beyond S0 without repeated permission.
- Preserve current root runtime, recent WhatsApp fixes and all provider/approval controls. No production merge/deploy.
- Use modular monolith and existing PostgreSQL queues; avoid duplicate identity or CRM implementations.
- Reuse current tenant/owner identity; do not claim delegated team/brand/branch roles are complete.
- First mandate is non-spending, immutable, scoped, expiring, quota-bound, revocable and opt-in. Paid scope awaits bounded exposure/accounting design.
- Reuse approvals/action plans/Meta execution permit, not a second mutation path.
- Portal shares task core behind a default-off flag and never emits WhatsApp replies. Pending codes remain encrypted/redacted.
- Keep the question bank as read knowledge; no old interview fallback during model failure.
- Real eligibility/performance needs provider evidence; private source documents do not become runtime prompts.
- Deterministic row-lock testing reproduced the existing same-sender SKIP LOCKED race. Fix admission/claim ordering rather than weakening the test or rerunning until it passes.
- Local browser fixture verified owner UI proposal, exact approval, revoke and logout. It uses synthetic accounts, rewritten local test origin and disabled external transport; production CSRF is separately tested without rewriting.
