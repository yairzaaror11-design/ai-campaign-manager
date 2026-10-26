# Connected customer journey — release scope and verification

Source of truth: audit-security-hardening-20261025. This extends the existing backend; the older src/ tree is not the deployed runtime.

## Working path introduced in this release

1. A WhatsApp business-link entry point is enabled by BUSINESS_LINK_ONBOARDING_ENABLED. A user can submit a public HTTPS business page or describe the business.
2. The server fetches a bounded public page without browser scripts, cookies or credentials. DNS results are validated and pinned; every redirect is revalidated. Private, loopback, metadata and reserved addresses are rejected.
3. Metadata, structured business data, public asset candidates and a theme color become a PENDING_CONFIRMATION proposal. No inferred fact is silently committed. Login-walled or empty social pages fall back to a simple description.
4. The customer confirms or rejects the proposal. Confirmed facts use the existing scoped marketing profile; branding is user confirmed, not independently authenticated or licensed.
5. The accelerated path collects business/service, objective and daily budget before preparing a local draft. Audience/location/destination gaps remain explicit proposals or missing prerequisites; they never authorize delivery. The full existing diagnostic routes remain available.
6. PLAN_REVIEW offers a secure preview/registration link. WhatsApp sends a short-lived, single-use random ticket in the URL fragment. Only a hash is stored; the ticket is excluded from AI history. Redeeming it creates an HttpOnly Secure SameSite session with a separate CSRF secret and strict Origin checks.
7. The preview is available before account registration. Registering attaches account metadata to the SAME clients.id; no phone-based merge or arbitrary client-ID claim is accepted. Profile, history, media and draft are retained.
8. The customer dashboard shows current facts, an approximate ad preview, pending prerequisites, account connection state, CRM, subscription state and measured reports. It is responsive, Hebrew RTL and uses a self-hosted CSP-constrained UI without third-party scripts.
9. Meta connection/account verification and selection reuse the existing tenant OAuth and generation protections. No browser session or AI tool can select an account belonging to another client. The portal does not bypass the existing separate create-PAUSED / activation approvals.
10. After registration, an explicit click can publish a text landing page from the reviewed current draft. Its lead form requires consent, rate limits submissions, escapes content and deduplicates events into the same tenant CRM.
11. CRM supports manual/form leads, states, revision checks and reported transaction revenue. WhatsApp lists/selects leads and updates their state with bound choices. It does not invent ad-source attribution for manually entered deals.
12. marketingBrain evaluates actual Meta snapshots, preserves missing data, avoids double counting overlapping action types and uses business targets only when supplied. Recommendations do not execute actions or invent profitability.

## Payments

A Stripe adapter is implemented but DISABLED. It is a prepared option, not a claim that the owner selected Stripe or is eligible for its services. Price is server resolved and must match the explicit purchase review. Signed raw-body events are time bounded and deduplicated; client mapping comes from server-created checkouts. Subscription event timestamps prevent older status events undoing newer cancellations. Hosted payment/management pages handle card details; no card data enters this application. Actual provider choice, account, prices, legal conditions, tax handling and a sandbox purchase/cancellation test are required before BILLING_ENABLED can be set. A PILOT database row is not a charge or a paid entitlement.

## Public access

PUBLIC_ONBOARDING_ENABLED allows verified inbound WhatsApp senders to create their own tenant instead of relying solely on the old phone allowlist. It does not allow anonymous web access to customer data or Meta writes. A global new-client cap, per-client chat/import/graphics quotas, provider webhook signatures and deletion guards remain. Production requires configured privacy operator/contact/hosting/backup information. Public sales readiness is distinct from allowing first-contact planning.

## Migrations and retention

009: customer account metadata, one-time tickets, opaque sessions, CRM, subscription state and billing event dedupe.
010: reviewed published landing pages.
011: server-bound checkout sessions, invoice records and ordered subscription-event state.

All customer-scoped rows reference clients with cascading deletion. Expired portal tickets/sessions are cleaned by maintenance. Financial retention and cancellation on account deletion require policy decisions before enabling paid subscriptions. Existing Meta/WhatsApp migrations are unchanged.

## Verified vs unavailable

- Code/integration tests: website security/extraction, proposed vs confirmed facts, preview-before-registration, same-client continuity, token replay/expiry, CSRF, cross-tenant isolation, CRM/version/revenue, explicit landing publication, lead event dedupe, signed billing events and business-analysis constraints.
- Local HTTP tests: route authentication, cookies, consent, forged client IDs and logout revocation, with mocked providers.
- Visual check: local Hebrew dashboard with clearly labeled demonstration data; not production customer evidence.
- Real Meta: no valid production customer Meta connection existed at the start of this release. Customer OAuth completion, app permissions/eligibility and real PAUSED creation/activation remain external validation requirements. READ_ONLY and META_WRITES switches are preserved.
- Payments: not configured or charged. No real checkout, subscription or invoice was created by the agent.
- Google Ads, GA4/GTM/Pixel installation/CAPI, video generation/editing, social posting, calendar booking, multi-business/team RBAC and scheduled external notifications are NOT implemented by this release. They require separate adapters, credentials, policy and tests. The UI must not offer them as active.

## Release verification

Run npm run check, npm test, npm audit --omit=dev. CI additionally runs the external PostgreSQL tests. Deploy only the tested head, confirm migrations 009–011, /health readiness, private /app/api authentication and the feature flags. Real-device WhatsApp, site-specific extraction, customer OAuth and provider fidelity/latency remain live acceptance checks.
