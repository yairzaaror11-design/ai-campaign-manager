# Security review — 2026-10-25

## Implemented controls

Authentication is anchored in an explicit authorized phone list and Meta Login; tenant/client IDs supplied by AI or browsers are never accepted as proof of identity. This is a single-owner tenant pilot model, not a public self-service signup or multi-user business RBAC system.

Every active Meta read uses the current tenant token; selected account and campaign ownership are checked. Every write requires both operator effect switches, an unexpired consumed approval, the immutable plan hash, current selected account and connection generation, an exactly-once execution claim and ads_management. Object parents and Page access are checked; new objects start PAUSED and full activation is a separate plan. Unknown external effects stop for manual review rather than replay.

OAuth uses high-entropy hashed invites/state, atomic consumption, browser cookies, origin checks, exact HTTPS redirect configuration and client-secret code exchange. Token encryption uses AES-256-GCM with tenant-associated data and versioned keys. Old keys can be supplied privately during migration using META_TOKEN_PREVIOUS_KEYS; rotateStoredKeys re-encrypts transactionally. Stable approval/deletion HMAC keys are separate from token encryption keys. PKCE awaits confirmed support for this Meta configuration.

Webhooks validate the HMAC over raw request bytes and the configured receiver number. Inbound message IDs and outbound dedupe keys prevent repeat processing. PostgreSQL-backed limits cover OAuth and approval attempts/chat processing. A fixed supported schema, tool allowlists and budget conversion using account currency stand between model proposals and write execution. No AI tool directly writes to Meta. Untrusted transcripts, media captions and API text remain data. Prompt wording is defense in depth, not the authorization boundary.

Media/audio fetches restrict HTTPS hosts to Meta CDNs, disallow redirects/nonstandard ports and enforce sizes/MIME types. Provider credentials use headers for resource requests and are redacted from logs. HTTP responses sanitize errors; request logs omit query strings and bodies. Database TLS verifies certificates by default.

Deletion includes tenant relational rows, outbound items/receipts and matching queued WhatsApp/Telnyx payloads. A stable keyed digest prevents old events recreating a deleted user. There is no deletion of production records as part of development/testing.

## Residual risks and release gates

- No independent penetration test or production load/chaos test has run. Embedded and CI PostgreSQL tests cover listed invariants, not all possible behaviors.
- Live OAuth, long-lived exchange, every Meta object/creative capability, model availability and WhatsApp delivery must be tested using the authorized account before release. Official Meta reference requests were rate/access blocked during this review; current commercial requirements must be checked in the actual dashboard.
- Account listing is bounded to 20 pages. Performance reports reject a truncated first result instead of silently presenting incomplete totals. Currency conversion currently supports ILS/USD/EUR/GBP/CAD/AUD/JPY/KRW; other currencies fail closed until explicitly configured/tested.
- Full campaign creation currently supports image/link creatives, up to five ad sets and explicit supported delivery settings. Video creative upload, every specialized Meta objective and automated recommendations that change live accounts are not implied.
- Outbox/Meta uncertainty requires operator reconciliation. Provider idempotency is not assumed. Interrupted multi-step bundle creation may leave PAUSED partial objects; no automatic deletion/recreation occurs.
- Runtime logs, hosted backups and provider-held data are outside active database deletion. The operator must configure retention, restrict log access and test backup restoration. Raw proxy request query logs must be disabled/redacted for OAuth callbacks.
- The existing Render database is free, expires 2026-11-24, and publicly allows all IPs. Commercial operation needs an owner-approved durable database/backup/network configuration. Existing live settings were inspected but not modified.
- Public signup, multiple business members/roles, billing, subscription enforcement, and automatic daily/weekly proactive reporting are not implemented. The current supported pilot is explicitly allowlisted owners, on-demand reports and approved-template sending infrastructure; no scheduling promise is made.
