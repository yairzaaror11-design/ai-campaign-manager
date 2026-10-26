# SCORPIO business modules

This extension adds a separately mounted Hebrew RTL workspace to the existing Express application. It reuses `clients.id`, dashboard sessions/roles, the existing CRM tables, Meta and social OAuth, WhatsApp infrastructure, audit log, tasks and campaign lifecycle. It does not replace the first agent's dashboard, navigation, chat, design system, or backend.

## Run and validate

Use Node >=22 and the repository's frozen `npm ci`. Use an isolated PostgreSQL database, never production data:

```sh
DATABASE_URL=postgresql://postgres@127.0.0.1:54329/scorpio_dev \
DB_SSL=false NODE_ENV=development READ_ONLY=true \
META_WRITES_ENABLED=false WHATSAPP_SEND_ENABLED=false \
WHATSAPP_WORKER_IN_WEB=false GRAPHICS_ENABLED=false \
PORT=3002 node scorpio/server.js
```

The workspace is `/app/modules/`. It uses the existing login at `/app/api/login` and its HttpOnly, SameSite cookie scoped to `/app`; no second authentication mechanism is introduced. Provision an existing verified client through `DASHBOARD_ACCOUNTS`, exactly as described in `docs/DASHBOARD.md`. Do not expose development databases or invent production accounts.

`scorpio/server.js` starts the existing application with the module router attached. `npm start` continues to start the original app and does **not** mount these modules. Integrating the new entrypoint with hosting is an explicit release task. Existing source files, manifests, lockfiles, and first-agent UI files are unchanged.

The additional schema uses an advisory lock, transactional installation and a stored SHA-256 checksum in `scorpio_versions`. Changing an applied version fails closed. It only adds module tables, CRM columns and a revision trigger. The trigger increments revisions for updates from either the original dashboard or these modules, preventing stale forms from overwriting concurrent dashboard changes. No production migration was performed. Review the schema and validate an isolated restore before release.

```sh
npm run check
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/scorpio_test DB_SSL=false npm test
# Optional: Playwright must be available; uses system Chromium and disposable PGlite.
LOG_LEVEL=error node scorpio/scripts/browser-check.js
```

The browser check creates temporary test-only credentials internally, never prints them and deletes its PGlite fixture on exit. Screenshots contain only synthetic test data. It verifies login, a persisted CRM lead, Kanban, the campaign wizard, RTL and all twelve module pages at 390/768/1440 pixels. Horizontal scrolling inside Kanban/table containers is intentional.

## Implemented workflows

- CRM create/read/full edit/delete; search and pagination; Kanban for the loaded page; lead contact validation, assignee labels, estimated/actual values, currency and explicit campaign/ad attribution; notes; duplicate detection and version-checked merging. Existing dashboard lead/task tables remain authoritative. Assignee labels do not grant team permissions.
- CSV import is transactional, bounded to 500 rows, validates all rows before writes and skips matching existing phone/email contacts. Supported input columns: `name,phone,email,notes,source`. Export is bounded to 5,000 records, quoted and spreadsheet-formula safe. Export includes status/date columns and is a reporting export, not a roundtrip import template.
- Local campaign wizard, draft edit/duplicate/delete and a pending review in the existing Meta lifecycle. Requesting review stores **no execution approval or workflow job**. No activation, budget write or campaign creation endpoint is exposed by this extension. Draft references must belong to the current tenant. Provider publishing assets and complete delivery settings still need resolution in the existing approval journey.
- Private image/video library: tenant-scoped bytes, folder placement, search, rename, previews and deletion protection for referenced assets. Images are decoded, bounded and re-encoded by Sharp; only supported image/video types are accepted. 20 MiB/file and 200 MiB/tenant. Video validation checks container signatures; malware scanning and transcoding are not implemented. Store only trusted uploads in this initial release.
- Post drafts with planned times, appointments, business/brand settings, support records and existing task/activity views. Planned posts are **not automatically published**. Support records do not automatically notify an external support team.
- Connection cards reuse existing Meta/social OAuth and add isolated Google Ads/GA4/Business Profile, Pinterest and Shopify OAuth adapters plus explicitly allowlisted WordPress/WooCommerce credentials. All mutations require owner/same-origin protection; state is one-time, browser-bound, tenant-bound, generation-bound and owner-revocation checked. Tokens are encrypted with the existing key envelope. Selection is limited to server-returned account candidates. Disconnect clears local credentials; external provider consent must be revoked separately.
- Manual read-only provider synchronization. Responses explicitly identify limited/partial data; there is no claim of complete account pagination. Google Ads and GA4 use the last 30 days; other adapters expose bounded first-page data. Current provider permissions and API compatibility require live validation. Automatic token refresh and social publishing are not implemented; expired connections must reconnect.
- Dynamic billing catalog, Stripe **test-key-only** subscription checkout, signed test webhooks, immutable plan snapshots, duplicate-invoice protection, credit ledger, subscription cancellation request and history. An invoice credits the tenant only after its signed event, subscription mapping, amount and currency match. No hardcoded prices and no acceptance of live Stripe keys. Hosted invoice documents, plan upgrades, proration and a full billing administrator UI remain incomplete.
- AI provider interface with existing Gemini image generation and a tool-free Gemini text adapter. It reserves one app credit transactionally, requires explicit cost confirmation and a caller idempotency key, and stores job results. Concurrent requests cannot overspend the credit balance. Uncertain provider results retain the reservation and require operator reconciliation; never automatically retry. Video has an extension point but no implemented provider. There is no production cost reconciliation or automatic refund UI.

## Configuration: names only, never commit values

Existing dashboard provisioning, HTTPS public origin and encryption requirements remain in `docs/SETTINGS.md` and `.env.example`.

| Capability            | Additional configuration                                                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google OAuth          | `SCORPIO_GOOGLE_CLIENT_ID`, `SCORPIO_GOOGLE_CLIENT_SECRET`                                                                                                                                           |
| Google Ads            | `SCORPIO_GOOGLE_ADS_DEVELOPER_TOKEN`, `SCORPIO_GOOGLE_ADS_VERSION` (supported `vNN`), optional `SCORPIO_GOOGLE_ADS_MANAGER_ID`                                                                       |
| Pinterest             | `SCORPIO_PINTEREST_CLIENT_ID`, `SCORPIO_PINTEREST_CLIENT_SECRET`                                                                                                                                     |
| Shopify               | `SCORPIO_SHOPIFY_CLIENT_ID`, `SCORPIO_SHOPIFY_CLIENT_SECRET`, supported `SCORPIO_SHOPIFY_VERSION` (`YYYY-01/04/07/10`)                                                                               |
| WordPress/WooCommerce | Administrator-controlled exact hostname list `SCORPIO_SITE_HOSTS`; HTTPS only, no redirects or arbitrary URLs. Site credentials are entered through the authenticated form and encrypted server-side |
| Test billing          | `SCORPIO_STRIPE_SECRET_KEY` beginning `sk_test_`, `SCORPIO_STRIPE_WEBHOOK_SECRET`; `SCORPIO_BILLING_ADMINS` lists configured dashboard credential **hashes** permitted to create plans               |
| AI                    | Explicit operator switch `SCORPIO_AI_ENABLED=true`, existing `GEMINI_API_KEY`, `GEMINI_MODEL` / `GEMINI_IMAGE_MODEL`, and a funded app credit balance                                                |

Register exact new OAuth callbacks at the provider: `https://<approved-origin>/app/modules/oauth/callback/<provider>`. Providers are `google_ads`, `analytics`, `business_profile`, `pinterest`, `shopify`. Existing six social providers keep their existing `/auth/social/callback/...` routes. Stripe's signed webhook endpoint is `/app/modules/billing/webhook`; it does not use browser sessions.

No credentials were supplied or requested in chat. Proxy-bound secrets must use supported HTTPS destinations; local encryption/signing secrets must be genuine server-side secret bindings, not network-only placeholders. Do not copy proxy-held credentials into files.

## Status against the supplied specification

| Area                                                                                                                                        | Status                                                              | Evidence / remaining work                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| New CRM workflows, isolation, revisions, notes, merge and CSV                                                                               | Implemented and locally tested                                      | PGlite/API plus original suite with PostgreSQL; advanced assignment permissions and custom sales-stage UI remain                   |
| Modular Hebrew RTL UI                                                                                                                       | Implemented and locally tested                                      | Browser workflow and three viewport sizes; not a comprehensive accessibility certification                                         |
| Drafts / campaign review                                                                                                                    | Implemented and locally tested                                      | Pending existing lifecycle only; no campaigns activated                                                                            |
| Media uploads / folders / post planning                                                                                                     | Implemented and locally tested for images and data isolation        | Virus scanning, robust video inspection, publishing scheduler and full calendar UI incomplete                                      |
| OAuth/read adapters                                                                                                                         | Implemented; awaiting live verification                             | Google OAuth state flow mocked; other newly added adapters need more provider-specific tests and official API compatibility review |
| Provider approval / credentials                                                                                                             | Awaiting external configuration/approval                            | No live accounts connected, no provider approvals assumed                                                                          |
| Billing / AI                                                                                                                                | Implemented foundation; awaiting real sandbox/provider verification | Signed billing fixtures and mocked AI verified; no Stripe sandbox transaction or paid generation executed                          |
| Video AI, full tenant/user/team lifecycle, notifications, support operations, knowledge CMS, advanced reports and complete original roadmap | Not complete                                                        | Do not represent this change as completion of the full product                                                                     |
| Production release                                                                                                                          | Not performed                                                       | Latest specification forbids production changes; exact release target, migrations and live gates remain outstanding                |

Official Google, Shopify, Stripe and Pinterest documentation requests were attempted but the current egress proxy returned 403. Browser-download egress was also blocked; the installed system Chromium was used instead. Provider endpoint and permission compatibility must be checked against current official documentation and approved test apps before enabling integrations.

## Verification of this change

- Full current suite with isolated PostgreSQL 16: **170 passed, 0 failed, 0 skipped**.
- `npm run check` passed.
- Browser check passed with installed Chromium: login, persisted lead, Kanban, campaign wizard, all twelve module pages at 390/768/1440 pixels, RTL, no page-wide overflow or JavaScript exceptions. Screenshots: `screenshots/crm-desktop.png`, `screenshots/crm-mobile.png`.
- New adapter fixtures exercise Google Ads, Google Business Profile, Pinterest, Shopify HMAC/token flow, WordPress authentication, Google Analytics OAuth, wrong account/tenant rejection, encrypted credentials and bounded snapshots. They are mocks, not live provider approvals or integration tests against the providers.
- A separate additive CI workflow targets PRs into `feature/dashboard-rtl` and runs the existing checks plus all tests against PostgreSQL. It has read-only repository permissions and no deployment step. Its hosted run has not yet been observed.
