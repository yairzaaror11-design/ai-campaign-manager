# Master development roadmap — planning only, 2026-10-27

All hours are rough engineering estimates pending code-level review. **Do not start task 2.**

| Stage | Goal and tasks | Files / reuse | Tests and acceptance | Dependency | Hours | Parallel? |
|---|---|---|---|---|---|---|
| A | Confirm canonical development branch and inventory differences | index.js, portal, dashboard branches | Diff inventory; no lost modules | None | 6–12 | Yes, read-only |
| B | Resolve release blockers: DB expiry, backup/restore design, access exposure | render.yaml, db.js, backup script | Documented isolated restore; release checklist | A | 8–16 | With C |
| C | Verify authentication, tenant isolation and approval boundaries | auth.js, approvalEngine.js, metaWrite.js | Cross-tenant, expiry, replay and write-gate tests | A | 12–24 | With B |
| D | Validate AI/WhatsApp conversation and fallback | aiService.js, gemini.js, claude.js, conversationOwner.js | Mock tests then separately authorized real-device tests | C | 12–24 | Limited |
| E | Validate Meta read, drafts, approval, reporting | metaOAuth.js, campaignLifecycle.js, reportService.js | No-spend sandbox and exact-plan checks | C,D | 12–24 | Limited |
| F | MVP customer acceptance: portal, CRM, onboarding, reports | public/portal, crmService.js, portalRoutes.js | User journey, mobile RTL, tenant isolation | C,D,E | 16–32 | Yes, UI and backend separate |
| G | Commercial product: billing, backups, monitoring, support, privacy | billingService.js, scripts, docs | Payment sandbox, restore drill, alerts | F | 24–48 | Yes |
| H | Full SaaS: multi-model routing, advanced social, media, video, analytics | socialConnections.js, graphicService.js, marketingBrain.js | Provider integration and cost ceilings | G | 40–100+ | Yes, bounded interfaces |

## Delivery targets
- **MVP with test customers:** A–F, gated by safe approvals and verified persistence.
- **Initial commercial product:** G after MVP acceptance and production backup readiness.
- **Advanced SaaS:** H only after evidence of usage and controlled costs.

## Task 2 (not started)
Create a controlled consolidation/hardening plan against the selected canonical development branch: diff and reconcile existing portal, conversation and approval modules, add failing regression tests for confirmed gaps, then implement minimal fixes only after separate authorization. No main/render-safe-deploy writes and no production deployment without explicit approval.
