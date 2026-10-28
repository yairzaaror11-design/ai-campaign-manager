# SCORPIO AI — WhatsApp-first MVP progress

Date: 2026-10-28, Asia/Jerusalem.

The product remains a WhatsApp-first marketing service. The dashboard is an
optional client of the same backend and business data; it is not a prerequisite
for conversation, discovery, strategy, creative drafts or local campaign-plan
review. This report records a completed local change set, not completion of the
entire product roadmap or a production release.

## Delivery record

- Work items: TASK-006 (worker monitoring) and TASK-013 (conversation), partial
  contributions to their acceptance criteria. Provider diagnostics also support
  TASK-010/TASK-016. None of these whole tasks is declared complete here.
- Branch: `feature/chat-resilience-20261028`.
- Base HEAD: `869a3226912cf4315548b55c59e10e3fb1c66f85`.
- Existing implementation: tenant-scoped PostgreSQL marketing profiles,
  WhatsApp text/voice routing, campaign journey, separate Meta write approvals,
  inbound/outbound workers and an optional customer portal.
- Changed application files: `conversationAnalysis.js`, `backgroundJobs.js`,
  `scripts/live-readiness.js`.
- Added tests: `tests/growthJourney.test.js`, `tests/workerReadiness.test.js`.
- Extended tests: `tests/liveReadiness.test.js`.
- Documentation: `docs/OPERATIONS.md` and this report.
- Database migrations, dependency declarations and lockfiles: unchanged.
- Commit: see the branch commit containing this report; no protected branch or
  production source branch was changed.

## Implemented and tested locally

1. **Growth requests start the conversation.** Previously, `אני רוצה עוד לקוחות`
   saved the goal and left the journey IDLE. Exact growth requests now use the
   existing discovery flow and ask for the missing business description. The
   same path supports the tested feminine/plural and leads/sales variants.
   Exact requests do not require a model call; longer free-form messages keep
   the existing contextual AI interpretation/fallback path.
2. **WhatsApp can complete local planning without a dashboard.** Integration
   coverage follows a text request through business details, audience, advantage,
   daily budget, destination, strategy review, creative review and local plan
   review. It does not register a customer portal account. Voice routing is also
   covered with a fixture transcription. No real audio transcription or WhatsApp
   delivery was performed in these tests.
3. **Existing safety gates remain intact.** A local plan is not an external
   campaign. `כן` at plan review does not authorize spending. Tests check that
   discovery creates no Meta execution approval, workflow job or external draft.
   Two independently authenticated businesses cannot read each other's agent
   history; forged tenant IDs and invalid CSRF do not redirect/modify it.
4. **Worker readiness reflects message processing and delivery.** Previously,
   the maintenance loop refreshed the MESSAGES heartbeat even if an inbound or
   outbound loop was stuck. The heartbeat now uses the older loop's actual last
   successful completion. Tests hold each loop pending, observe `/health` 503
   while maintenance continues, release it, observe recovery and check shutdown
   removes the heartbeat. Existing independent outbound progress tests also pass.
5. **Provider readiness defaults to read-only checks.** The diagnostic tool now
   accepts injected process environment bindings without requiring an exported
   secret file, reports absent bindings by name, validates selected targets,
   and exits nonzero on a non-passing check. Default checks list accounts,
   permissions, phone metadata and the selected provider's model catalog. Gemini
   generation requires both its explicit target and `--allow-generation`.
   Fixtures verify that the default sends no POST or model-generation request.

## Validation evidence

Runtime used: Node.js 24.19.0, npm 11.9.0, isolated PostgreSQL 17.11.
The repository requires Node >=22. Tests do not prove all other supported
runtime/database versions or the actual production configuration.

The original growth-request defect was reproduced before the change: IDLE,
no pending field, and a reply asking the customer to request a campaign again.
The new growth tests initially failed on that behavior.

Final full-suite invocation:

```sh
READ_ONLY=true META_WRITES_ENABLED=false WHATSAPP_SEND_ENABLED=false \
GRAPHICS_ENABLED=false BILLING_ENABLED=false WHATSAPP_WORKER_IN_WEB=false \
DB_SSL=false TEST_DATABASE_URL=<isolated-loopback-test-database> \
node --test --test-concurrency=2 tests/*.test.js
```

**221 tests passed, 0 failed, 0 skipped, 0 cancelled, 0 todo.**
The PostgreSQL-dependent tests executed. Many other database-backed tests use
the repository's PGlite fixture. `npm run check` passed. `npm audit --omit=dev
--audit-level=high` reported zero known production dependency vulnerabilities;
this is not a complete application security audit.

The actual web server was started against a newly created, isolated local
PostgreSQL database with both message loops enabled and external writes/sends
disabled. `/health` returned ready with database/worker true and both external
write flags false; `/health/live` returned 200; an unsigned webhook returned
401. No dashboard interaction was needed to start or validate the backend.

Raw local evidence is under `/workspace/audit-task-001/`:
`chat-final-tests.log`, `chat-final-check.log`, `chat-dependency-audit.json`,
`chat-http-smoke.json`, `current-provider-readiness.json`. These artifacts are
local evidence; their presence does not claim a fresh-task restoration or
production deployment.

## Real integration status and access requirements

The current instance and saved environment metadata were checked without
printing secret values. The provider probe returned NOT_CONFIGURED for Meta
account access, Meta permissions, WhatsApp phone access and Gemini model access.
`DATABASE_URL`, `META_APP_ID`, `META_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` and
`RENDER_API_KEY` are also absent from the actual process environment. The local
test database is configured only for the explicit local test/server commands.

The Gemini API secret requirement was added to the cloud environment draft with
HTTPS destination `generativelanguage.googleapis.com`. Existing Meta/WhatsApp
requirements were preserved. Saving a requirement does not inject a credential,
publish a cloud environment snapshot, configure Render or deploy the app.

For live acceptance, connect an isolated staging environment with its real
public URL, authorized Meta test app/account, WhatsApp test number and securely
provided credentials. Local encryption/HMAC/webhook secrets must be actual
server-side secret bindings, not network-proxy-only placeholder values. Do not
paste credentials into chat or run these tests against production data.
The read-only model catalog check does not prove generation quality, customer
OAuth, webhook delivery, sender consent or campaign creation/activation.

## Roadmap and remaining gates

| Priority | Current evidence | Remaining acceptance work |
|---|---|---|
| Infrastructure/security | Local DB suites, prior synthetic backup/restore, improved worker readiness | Current Render roles/network/backup/retention verification, staging restoration, full route/worker tenant review and production rollback rehearsal |
| Meta and WhatsApp | Existing code and local fixtures; safer diagnostics | Actual staging credentials, OAuth/permissions, signed inbound event and authorized reply; paused creation and activation tested separately |
| Smart chat/voice | Growth-to-local-plan path tested without dashboard | Live Hebrew text/voice acceptance, provider quality/cost limits and customer pilot |
| Campaign operations | Existing guarded actions and separate approvals remain covered by the suite | Connect the approved plan to validated customer assets/account and prove the complete staging journey; no live activation claimed |
| Google sign-in | A previous local implementation was reported in another Codex workspace | Preserve and inspect that source before recreating it; this does not block the WhatsApp-first path |
| Content, CRM, dashboard | Existing partial implementations retained | Dedicated acceptance of each feature and safe consolidation of competing branches; video is not declared implemented |
| Subscriptions and launch | Existing adapters/fixtures are not commercial acceptance | Provider sandbox validation, quota/cost controls, legal/privacy review, pilot and separate authorization for real billing/launch |

There was no deployment, real message send, provider generation, purchase,
campaign mutation or customer-data migration in this change set. Task status is
**TESTED locally for this change set**; live acceptance and the rest of the
roadmap remain outstanding. The next step is staging connection validation and
continued P0 security acceptance, not enabling production writes by default.
