# Task 2.1 — Tenant isolation matrix (partial, verified source review)

**Scope warning:** This matrix contains the routes and worker code inspected in this pass; it is **not** a complete repository-wide inventory. No unreviewed surface is marked secure. Tenant A/B HTTP coverage exists for the portal in `tests/customerPortalHttp.test.js`; the newly added job test uses a database fixture.

| Entry point / source | Data | Tenant identity source | Enforcement observed | Evidence | Gap / action |
|---|---|---|---|---|---|
| `portalRoutes.js GET /app/api/dashboard` | profile, subscription, CRM | `req.portal.clientId` | portal session middleware and scoped queries | existing portal HTTP test | wider response and billing verification outstanding |
| `GET,POST,PATCH /app/api/leads[/:id]` | CRM | authenticated portal session | `crmService` receives session client ID | `customerPortalHttp.test.js` | delete route and full CRUD review outstanding |
| `POST /app/api/register` | account | portal session | client ID from session, not request body | portal HTTP test | registration semantics review outstanding |
| `GET /app/api/creative-image` | media | portal session | `mediaStore.loadMedia(clientId,id)` | code review only | external WhatsApp media fetch not integration tested |
| `GET /app/api/brand-image` | brand media | portal session | `marketingStore.load(clientId)` | code review only | remote image fetch test outstanding |
| `POST /app/api/meta/connect,check,select` | Meta | portal session | client ID passed to Meta services | code review only | verify downstream account ownership |
| `POST,PATCH /app/api/landing/drafts[/:id]` | landing | portal session | client ID passed to landing service | code review only | cross-tenant draft IDs need integration tests |
| `POST /app/api/landing/:id/publish` | landing publish | portal session | client ID passed to landing service | code review only | cross-tenant publish test outstanding |
| `GET /app/api/landing` | landing | portal session | `WHERE client_id=$1` | code review only | no two-tenant HTTP test |
| `POST /app/api/billing/checkout,manage` | billing | portal session | client ID passed to billing service | code review only | provider callback tenant mapping not tested |
| `GET /app/api/billing/invoices` | invoices | portal session | `WHERE client_id=$1` | code review only | no two-tenant HTTP test |
| `POST /billing/webhook` | billing webhook | verified provider event | `billingService.verify` | code review only | signed event to tenant binding unverified |
| `GET /app/api/report` | Meta report | portal session | `clientId` passed to report service | code review only | downstream authorization unverified |
| `GET /app/api/integrations` | social OAuth | portal session | `socialConnections.list(clientId)` | code review only | callback binding unverified |
| `POST /app/api/social/:provider/connect,account,disconnect` | social OAuth | portal session | client ID passed to social service | code review only | forged account ID test outstanding |
| `GET,POST,PATCH /app/api/workspace/:kind[/:id]` | workspace, posts, tasks | portal session | client ID passed to workspace service | code review only | two-tenant IDOR CRUD test outstanding |
| `POST /app/api/brand` | brand | portal session | client ID passed to workspace service | code review only | no cross-tenant HTTP test |
| `GET,POST /app/api/agent` | AI history | portal session | client ID passed to agent | code review only | history and async tenant scope unverified |
| `workflowWorker.runOne` | queued campaign operations | job `client_id` (untrusted DB row) | **new** claim requires lifecycle/client ID match, plus payload tenant check | `workflowWorkerTenantIsolation.test.js` pending CI | other worker types not reviewed |
| `workflowReconciliation.reconcileOne` | retry/reconciliation | job client ID | lifecycle query checks ID + client ID, payload tenant check | code review only | direct untrusted invocation test outstanding |
| `lifecycleStore.save` | approvals and jobs | caller-provided client ID | scoped lifecycle update, job enqueue | code review only | enforce caller identity at all entrypoints |
| `clientStore.setMetaAdAccount` | Meta account mapping | normalized phone | server-side client lookup | code review only | phone ownership and OAuth binding review |
| `portalStore.createTicket/redeem` | sessions | client ID and single-use token | ticket/client FK, session creation | portal HTTP test | complete expiry and revocation coverage pending |

## Not yet enumerated
`webhook.js`, `telnyx.js`, `backgroundJobs.js`, `metaOAuth.js`, `socialConnections.js`, `billingService.js`, `workspaceService.js`, `mediaStore.js`, `crmService.js`, all DB migrations and additional jobs/services. A complete route-by-route and worker-by-worker count **cannot be asserted** from this partial inspection.

## Confirmed fix
`workflowWorker.js`: a job with tenant A's `client_id` pointing at tenant B's `campaign_lifecycles.id` is excluded from the claim query before reconciliation or mock-Meta actions. The regression test checks the job stays PENDING and the foreign lifecycle stays unchanged.
