# SCORPIO AI v2: new agent core, existing infrastructure

## Decision
Build a modular agent core beside the existing application, reuse validated adapters, and migrate one capability at a time. WhatsApp and dashboard are channels of the same business agent, not separate brains. No rewrite of the production transport, auth, tenant database, approval engine or queues is authorized by this branch.

## Existing modules inspected
- `index.js`: Express transport wiring, WhatsApp, Telnyx, Meta OAuth, portal, background workers.
- `briefConversation.js` and `campaignWorkflows.js`: fixed campaign brief states and objective-specific requirements.
- `portalAgent.js`: dashboard planner, explicitly non-executing.
- `approvalEngine.js`: current tenant-bound persisted approvals.
- `marketingStore.js`: tenant-scoped conversation/profile state.
- `workflowWorker.js`: durable campaign execution with tenant-aware claim checks.
- `backgroundJobs.js`: serial inbound, outbound, maintenance loops.
- `package.json`: Node 22, existing test/check scripts.

## Target boundaries
1. **Channels**: WhatsApp voice/text, portal, future APIs. Authenticate and resolve a trusted tenant/actor before calling the core.
2. **Agent core**: interpret intent, inspect authorized context, build typed action plans, select tools and summarize evidence. A model suggestion is not authorization.
3. **Capability registry**: one contract per capability: input schema, required tenant/actor, read/write classification, side effects, API limitations, provider cost, idempotency, audit policy.
4. **Policy and approvals**: immutable plan + hash + expiry, separate draft approval and launch approval. No model-generated text can override permission boundaries.
5. **Adapters**: reuse `crmService`, `workspaceService`, `metaConnection`, `metaConversation`, `mediaStore`, `billingService`, `approvalEngine`, and existing WhatsApp pipeline behind explicit interfaces. Verify each adapter before enabling.
6. **Durable execution**: existing job/worker infrastructure with tenant-bound claims, idempotency keys, retry/reconciliation, audit events and bounded budgets.
7. **Observability**: action intent, plan, approval, outcome and customer-level results. Do not invent ROI, leads, or revenue.

## Implementation started
- `agentCore/actionContract.js`: side-effect-free action planning contract, tenant identity validation, deny-by-default operation registry, approval classification.
- `tests/agentCoreContract.test.js`: five behavioral tests. The contract is **not wired to production** and does not execute Meta, WhatsApp, billing or AI operations.

## Safe migration sequence
A. Freeze current production behavior. Complete existing PR #9 security review independently.
B. Inventory capability-to-adapter mappings and classify: autonomous read, safe draft, explicit approval, manual/API unavailable.
C. Implement trusted identity context, tool adapters and policy executor behind a disabled feature flag, with two-tenant tests.
D. Connect dashboard in staging, then WhatsApp in staging, retaining the legacy path as rollback.
E. Test complete business journeys, approval races, retries, model hallucinations, tool injection and spend prevention.
F. Roll out per-tenant only after separate deployment authorization, with kill switch and metrics.

## Not done
No production migration, UI change, provider connection, feature flag enablement, new persistent schema, paid API calls, or live campaign execution. This is the first safe implementation slice, not the completed agent.
