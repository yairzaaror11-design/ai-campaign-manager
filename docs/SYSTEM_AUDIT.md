# Campaign Bachat system audit

Audit date: 2026-10-27 (Asia/Jerusalem)  
Code audited: deployed development branch `audit-security-hardening-20261025`, commit `bece3706379713d92372f302095364d3fa9c2c3f`  
Production checked: Render service `ai-campaign-manager`; read-only Render and PostgreSQL inspection.  
Scope boundary: no app-code edits, migrations, deployments, campaign writes, outbound test messages, provider API calls, purchases, or secret-value reads were performed.

## Executive finding

This is a substantial Node.js/Express application with persistent WhatsApp processing, guarded Meta campaign workflows, marketing discovery, image generation, a customer portal, CRM, landing pages, reporting, and a Stripe-style billing adapter. This is a source-code and test-suite finding, not blanket commercial-readiness approval.

Live Render health returned `ready`, with database/configuration/worker all true, `READ_ONLY=true`, Meta writes disabled, and WhatsApp sends enabled. The live Render Blueprint says WhatsApp sends should be disabled, so deployment configuration has drifted. The Free PostgreSQL plan is scheduled to expire on 2026-11-24 and currently accepts connections from all IPv4 addresses. Those two infrastructure findings take precedence over feature work.

The database contains two client rows, but read-only aggregates found no stored Meta OAuth token and no social-provider connection rows. Thus no tenant Meta account/report/campaign path could be considered live-connected at audit time. Health/configuration checks validate readiness and required configuration shape; they do not prove current provider authorization or customer delivery.

## GitHub state

Repository: [yairzaaror11-design/ai-campaign-manager](https://github.com/yairzaaror11-design/ai-campaign-manager). Default branch is `main` at `0694a9f89ae05f9b998bca4ef04c0e9d8de3a115`. It contains an older minimal Express service under `src/`; the active application entry point is root `index.js`. Do not treat `src/` as the deployed app.

Branches returned during enumeration:

- `audit-security-hardening-20261025` (deployed source)
- `feature/dashboard-rtl`
- `feature/marketing-brain-v1-20261026`
- `feature/marketing-question-bank-20261026`
- `feature/scorpio-frontend-agent2`
- `fix/dashboard-fit-without-cramping`
- `fix/immediate-processing-replies-20261026`
- `fix/webhook-security-render-20261025`
- `fix/whatsapp-context-and-approval-20261026`
- `main`
- `release/agent-flexibility-20261027`
- `render-safe-deploy`
- `docs/system-audit-20261027` (documentation branch used for these reports)

Five PRs were open when checked: #1 broad WhatsApp/Meta/application release line to `render-safe-deploy`; #4 marketing brain to `audit-security-hardening`; #5 RTL customer portal to `audit-security-hardening`; #7 WhatsApp context/approval safety to `main`; #8 desktop dashboard layout to `release/agent-flexibility`. PR descriptions and passing CI are evidence of reviewed/tested changes at their stated commits, not proof that each branch is deployed or that live provider behavior passed. The currently deployed branch is `audit-security-hardening-20261025`; `main` and `render-safe-deploy` were not changed by this audit.

## Architecture and inventory

- Runtime: Node.js 22+, Express 4, PostgreSQL 18, `pg`; npm 10.9.2. The app is organized as root CommonJS modules, not a separate frontend/backend monorepo.
- Frontend: static Hebrew RTL customer portal in `public/portal/` (HTML, CSS, vanilla JavaScript, components/dashboard scripts); server routes serve it at `/app`. There are also generated public landing pages under `/p/:slug`, privacy/deletion pages, and a legacy `src/` Express implementation. No React/Vue build is declared.
- Backend domains: `portalRoutes.js`, `campaignLifecycle.js`, `campaignWorkflows.js`, `metaOAuth.js`, `metaExecution.js`, `whatsappInboundStore.js`, `whatsappDelivery.js`, `messageWorker.js`, `graphicService.js`, `crmService.js`, `reportService.js`, `billingService.js`, `socialConnections.js`, `landingService.js`.
- Data: 14 transactional migrations are recorded in the live `schema_migrations` table. Live public tables include client/conversation state, OAuth and approvals, campaign plans/lifecycles, inbound/outbound WhatsApp queues and receipts, CRM, billing, media, graphics, social connections, landing pages, reporting snapshots, workspace items, audit and worker heartbeat state. Names are in `INFRASTRUCTURE_AUDIT.md`.
- Build/test: `npm run check`, `npm test`, `npm run preflight`, `npm run worker:messages`. CI uses Node 22, PostgreSQL 16 service, syntax checks, Node tests, production dependency audit; current-head run 40466697771 passed. The database is PostgreSQL 18 in production, so retain a PostgreSQL 18 isolated restore/rehearsal as a release gate.
- Deployment: Render Node web service starts `npm start`; web process currently hosts the message/background loop (`WHATSAPP_WORKER_IN_WEB`); a separate worker command exists but no separate Render worker service was listed.

## API surface located in the active backend

The Express mount points are in `index.js`. The portal route file currently registers:

- Pages/assets: `GET /app`, `GET /app/:screen`, `GET /app/{portal.js,dashboard.js,components.js,portal.css}`.
- Authentication and customer data: `POST /app/api/login`, `POST /app/api/register`, `POST /app/api/logout`, `GET /app/api/dashboard`.
- CRM/business: `GET /app/api/leads`, `POST /app/api/leads`, `PATCH /app/api/leads/:id`, `POST /app/api/business/{inspect,confirm}`.
- Meta/account setup: `POST /app/api/meta/{connect,check,select}`.
- Landing pages: `GET/POST /app/api/landing`, `POST /app/api/landing/drafts`, `PATCH /app/api/landing/drafts/:id`, `POST /app/api/landing/:id/publish`.
- Reporting/media/workspace: `GET /app/api/report`, `GET /app/api/creative-image`, `GET /app/api/brand-image`, `GET/POST /app/api/workspace/:kind`, `PATCH /app/api/workspace/:kind/:id`, `POST /app/api/brand`.
- Integrations/agent: `GET /app/api/integrations`, social `POST /app/api/social/:provider/{connect,account,disconnect}`, `GET/POST /app/api/agent`.
- Billing: `GET /app/api/billing/{price,invoices}`, `POST /app/api/billing/{checkout,manage}`, `POST /billing/webhook`.
- Other mounts: WhatsApp `GET/POST /webhook`; health `GET /health`, `GET /health/live`; Telnyx `POST /telnyx/webhook`, `GET /telnyx/inbox`, `GET /telnyx/messages`; Meta/social OAuth callbacks; Meta deletion; landing `GET /p/:slug`, `POST /p/:slug/lead`; privacy routes.

Route registration was inspected. Full browser click-through and authorization review of every handler were not performed; see gap table before changing any of them.

## Feature groups

- Conversation/memory: tenant-scoped persisted business facts, message history, brief state, discovery questionnaire, contextual choice keys, image/media routing, and queues are present. Unit/integration coverage is broad, but no current customer-device chat was sent in this audit.
- Campaigns/approvals: campaign lifecycle and Meta execution services exist. Plans are validated, approvals expire and bind to exact plan hash/account/generation, writes are behind independent flags, and full campaign creation starts paused; activation is separate. Current live Meta write flag is false; no active Meta OAuth token was found in DB.
- Meta: OAuth onboarding/account selection, encrypted token storage, read/report and guarded write paths exist. Stored token count is zero at this inspection; live permissions, app review eligibility, account selection and campaign read are unverified.
- WhatsApp: signed webhook verification, durable inbound/outbound queue, receipts, templates/consent and worker heartbeat exist. Live readiness says configuration and worker are ready, and sends are enabled. No live customer message was sent during this audit; current send flag contradicts the Blueprint.
- CRM/portal: dashboard, leads/tasks, business context and tenant-scoped portal code exist. The UI is not a general public self-serve/multi-team RBAC product; customer login uses provisioned one-time access links/tickets.
- Media: Gemini image-generation integration and Meta image upload paths exist; historical release record says a live image generation/upload check succeeded. Video generation/editing is explicitly unavailable. General-purpose object storage was not identified; media refs/metadata and provider storage should not be conflated.
- Reporting: Meta performance read/snapshot code exists with missing values kept null. No connected account was present; current live reporting accuracy cannot be claimed.
- Billing: Stripe API/webhook/checkout/customer-portal code and schema exist. No billing subscription rows were found and live merchant configuration was not read or verified. Demo plan copy does not prove a working checkout.
- External channels: Facebook/Instagram/social OAuth code exists for publishing-oriented providers. Google Ads and Google Analytics integrations are not implemented in the inspected portal capability map. YouTube OAuth in the social provider list is not a Google Ads/Analytics integration.

## Security and quality findings

Implemented in code/docs: HMAC-verified raw WhatsApp webhook body; hashed one-time portal tickets/sessions; HttpOnly/Secure/SameSite cookies and CSRF/origin checks; tenant-scoped database access; encrypted Meta/social tokens; separate HMAC keys for Meta approval/deletion; idempotent queues and manual-review states for uncertain external effects; rate limits; restricted media fetches; sanitized logs/errors; TLS verification for PostgreSQL; migrations with lock/checksum registry.

High-priority operational findings: database network allowlist `0.0.0.0/0`; expiring free database; live WhatsApp sends enabled while `render.yaml` specifies false; current source is a development branch; backup artifact and previous PGlite-based restore rehearsal are described in repo docs, but a fresh hosted PostgreSQL 18 restore was not observed or independently run in this audit.

CI configuration grants `contents: write` and can commit/push automated lockfile security changes to the audit branch. Review that permission and branch policy as part of CI hardening. CI and mocks do not prove live-provider readiness.

## Duplicate/incomplete/dead-code review boundary

Known structural duplication: legacy `src/` code alongside root active services; source of truth is root `index.js` as stated by README/operations. Multiple open branches contain related dashboard, conversation and marketing changes. `DEPLOYMENT.md` still describes an old Railway/Claude setup and is stale relative to Render/Node 22/current runtime. `render.yaml` and live WhatsApp setting also diverge.

A complete static call graph, unused-export scan, repeated component diff, unconnected UI button sweep, and full front-end browser interaction were not executed. Treat “dead code”, “all buttons work”, and “no duplicate features” as not yet established; do not delete modules based on this inventory alone.

## Evidence references

Key sources: `index.js`, `portalRoutes.js`, `render.yaml`, `README.md`, `docs/OPERATIONS.md`, `docs/SECURITY-REVIEW.md`, `migrations/001_baseline.sql`–`014_*.sql`, `tests/`, GitHub CI run 40466697771, Render deploy `dep-dbg528l9fdbs73cq59a0`, read-only database metadata query, and live `/health` response at 2026-10-27 10:45 UTC.
