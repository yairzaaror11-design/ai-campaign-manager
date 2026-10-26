# Dashboard implementation inventory — 26 October 2026

## Verified baseline

The implementation branches from `audit-security-hardening-20261025` at `b79a70f` on local branch `feature/dashboard-rtl`. PR #1 targets `render-safe-deploy`; neither that branch nor main is changed. The initial remote inspection observed the earlier PR head b9283a3; the clone included subsequent planning fixes, which are preserved. The subsequent WhatsApp decision-key and conversation-repair changes through 97a9c27 were merged before final verification. Their migration 008 is preserved; dashboard tables use migration 009.

The active runtime is root index.js, Node >=22, Express, PostgreSQL, versioned transactional migrations, Node test runner and PGlite for isolated database tests. `src/` is legacy. No frontend build system or web login existed. Existing phone authorization is not browser authentication.

Inspected: root entry/config/DB/migration runner, client/history/profile stores, Meta connection/read/report services, lifecycle and approval schema, migration files 001–007, existing test helper and integration tests, GitHub Actions and render.yaml. The supplied 01–18 specifications are copied into docs/spec without changing their source content.

Render was checked through the connector in the owner-confirmed workspace `tea-dbe7qu2vcj2c73c1e92g`: service `srv-dbe9q03rjlhs73evfii0` uses this repository, autoDeploy=no, autoDeployTrigger=off, PR previews disabled. No configuration or deployment was changed. Backups and production DB schema/data were not inspected.

## Existing → implementation → remaining

| Area | Existing | Added | Remaining |
|---|---|---|---|
| Tenant identity | clients.id, WhatsApp phone allowlist | browser access tokens mapped by administrator to existing client; persisted hashed sessions; owner/viewer | self-service OIDC, team membership, multi-business selector, MFA |
| Interface | no active dashboard | dependency-free RTL responsive shell, loading/error/empty states, dialogs, keyboard drawer, eight screens | full visual/a11y audit and component gallery |
| Metrics | tenant-scoped performance_snapshots and reportService | matching-account/period snapshot overview; explicit timestamps; manual throttled read-only Meta sync | daily series, custom dates, comparisons; 90-day provider sync |
| Campaigns | existing approvals, drafts and lifecycle | snapshot table/detail, search, lifecycle status, pending approval summaries | browser campaign editor and browser approvals; all writes stay with existing WhatsApp flow |
| CRM | no equivalent lead/task tables | additive lead/task tables, validation, create/list/status updates, filters/pagination, detail, audit | assignment, contact relationships, full-field editing, import/export, consent workflow and lifecycle history |
| WhatsApp | conversation_messages, marketing_profiles | same-client history and business memory viewer | browser message composer and memory editing; new message updates require refresh |
| Activity | tenant_audit | latest 50 sanitized existing events | historical paging and advanced filters |
| Integrations | encrypted Meta connection and OAuth | stored connection expiry/account status | provider live-health checks and browser onboarding |
| Billing | no verified billing ledger/provider | explicitly labeled example plans only in demo | backend catalog, credits ledger, checkout, usage and commercial terms |
| Creative | existing graphic/media services | no new paid generation paths | studio and asset UI |

## Decisions and risks

Reuse clients.id as the tenant key. Do not introduce a parallel business hierarchy or duplicate conversation engine. Additive migration 009 contains only dashboard sessions, leads and tasks, all with client foreign keys and indexes. Existing deletion cascades remove new data. Do not infer a CRM lead automatically from a conversation with the business owner.

Use server-configured SHA-256 access token hashes instead of accepting a phone number/client ID from the browser as identity. Tokens must contain at least 32 random bytes before hashing; configuration is an initial administrator-provisioned login, not a complete SaaS account system. Production uses Secure, HttpOnly, SameSite=Strict cookies, bounded sessions, database-backed login throttling, exact Origin and a custom request header for mutations. Revoking a configured token invalidates its sessions on the next request. Role changes apply immediately.

Dashboard CRM writes update only local business data with transactionally paired audit entries. The dashboard has no campaign write/approval/send/payment API. The manual report endpoint calls the existing tenant context and report service; it is tested with mocks, not live credentials. Cached Meta totals and CRM counts have distinct source labels. CPL and active campaign counts remain null because the available snapshot does not establish them. No fake trend/daily chart or zero replaces missing data.

## Validation and release boundary

See DASHBOARD.md for setup, API, verification and known limits. Migration dry run is exercised by the existing PGlite migration helper and repeat-initialization tests. External PostgreSQL tests require TEST_DATABASE_URL and are reported separately; no production migration, backup rehearsal, message, model request, Meta mutation or payment is performed.

This is a reviewable dashboard implementation, not completion of every requirement in the 18-document product roadmap. Live access requires administrator provisioning against an existing client and a separately approved release. No production readiness claim is made.
