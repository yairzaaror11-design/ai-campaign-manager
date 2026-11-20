# Branch consolidation plan — Task 2 (2026-10-27)

Base: audit-security-hardening-20261025 @ bece3706379713d92372f302095364d3fa9c2c3f. Task branch is not a Render deployment source; no PR merged.

## Evidence-based merge matrix
| Area | Baseline | Candidate(s) | Competing version / schema | APIs / tests | Decision |
|---|---|---|---|---|---|
| Dashboard/RTL | public/portal/{dashboard.js,portal.js,portal.css} | feature/dashboard-rtl, feature/scorpio-frontend-agent2, fix/dashboard-fit-without-cramping | Older dashboard-public/ and scorpio/public/ use migrations/009_dashboard.sql and 010_dashboard_settings.sql; current base uses 009_customer_portal.sql and 010_landing_pages.sql. Incompatible migration numbering; never cherry-pick migrations. | portalRoutes.js, dashboardPublicApi.js in old branches; tests/dashboard.test.js and tests/customerPortalHttp.test.js; dashboard-rtl CI success | Manual UI/feature port only after API/DB mapping; do not wholesale merge |
| CRM | crmService.js, crmConversation.js | feature/scorpio-frontend-agent2 has scorpio/crm.js | Distinct client and session model; DB alignment unproven | portalRoutes.js; CRM-specific route review pending | Preserve base, port only verified missing features |
| Marketing | marketingBrain.js, marketingQuestions.js, marketingStore.js | feature/marketing-brain-v1-20261026, feature/marketing-question-bank-20261026 | Base has 014_marketing_research.sql; early branches have fewer migrations | marketingConversation.js, tests/marketingBrain.test.js, marketingQuestions.test.js | Baseline likely more integrated; compare behavior/test fixtures before port |
| WhatsApp/context | whatsappInboundStore.js, whatsappWebhookWorker.js, conversationFlexibility.js | fix/whatsapp-context-and-approval-20261026, fix/immediate-processing-replies-20261026, release/agent-flexibility-20261027 | PR #7 small 22-file branch vs integrated baseline; duplicate logic risk | webhook.js, messageHandler.js; tests/whatsappWebhookQueue.test.js, contextualConversation.test.js | Compare regression behavior; no blind merge |
| Approval/budget | approvalEngine.js, approvalPolicy.js, metaExecution.js, metaWrite.js | fix/whatsapp-context-and-approval-20261026 | Existing baseline validates plan hash, TTL and consumed state; competing patch may differ | tests/security.test.js, campaignLifecycle.test.js | Keep baseline until targeted tests show defect |
| Webhook/security | webhook.js, telnyxSecurity.js, auth.js | fix/webhook-security-render-20261025 | Verify signature and request-body handling | tests/security.test.js, telnyx.test.js | Targeted diff/test before port |

## All observed branches (before task branch)
main, render-safe-deploy, audit-security-hardening-20261025, docs/system-audit-20261027, feature/dashboard-rtl, feature/scorpio-frontend-agent2, feature/marketing-brain-v1-20261026, feature/marketing-question-bank-20261026, fix/dashboard-fit-without-cramping, fix/immediate-processing-replies-20261026, fix/webhook-security-render-20261025, fix/whatsapp-context-and-approval-20261026, release/agent-flexibility-20261027. The task branch adds one.

Open PRs observed in earlier audit: #1, #4, #5, #7, #8. GitHub PR #7 remains open/draft. No merge performed.

## Required pre-merge gates
1. Compare changed file content, not dates or PR descriptions.
2. Map every UI action to current Express route and tenant authorization.
3. Resolve migration ID collisions through new forward-only migrations on a disposable database.
4. Run baseline and candidate tests against matching Node 22 environment; preserve current portal screenshots and RTL/mobile acceptance.
5. Require human review of security/approval/Meta write changes.

Local dashboard http://127.0.0.1:4320/app/home was not accessible from connected remote GitHub/Render tools. No visual inspection of that local UI was performed.
