# One conversation owner — 2026-11-04

Problem: a 12-second startup model probe timed out after the free Render instance woke up. The task manager was disabled by its acceptance gate, so the WhatsApp router continued into an older marketing journey. An explicit recruitment campaign and applicant-form request therefore received unrelated sales ads using old business facts.

`conversationController` now owns all ordinary WhatsApp text, voice transcripts and media follow-up for the rollout audience. Routing ownership is independent of model readiness. It calls the durable task engine, which retains the original request, plans the outcome, asks for missing information and prepares reviewed artifacts. Existing marketing/brief/generic-AI routes cannot take over these customer messages. Their source remains for rollback and existing non-pilot consumers; it is not a competing owner for the unified rollout audience.

During model warm-up or failure, the same task is persisted as WAITING_MODEL and the customer is told what is waiting. A later continuation uses the original request. No unrelated draft is generated and no external operation is executed. Failed acceptance can be checked again on a later user turn with a one-minute bound. Task planning now uses structured JSON and a 30-second provider timeout; the same backend validations still gate all plans and writes.

Meta OAuth/account-selection, notifications, explicit report commands, deletion and exact task approvals remain dedicated infrastructure adapters. Connections and credentials are not reset. Old standalone approval codes/buttons cannot authorize an unrelated legacy plan for a unified customer. The current task retains separate artifact review, exact creation approval and activation approval. Human handover and stale interactive choices do not revive an old marketing route.

Regression coverage includes the exact recruitment request with a stale digital-marketing profile, failed startup acceptance, continuation, another outage, greeting/media behavior, stale approval codes and the existing campaign approval/execution suite. The model acceptance recruitment probe also uses the original request against existing social-content business facts.

Rollout requires UNIFIED_CONVERSATION_ENABLED=true. TASK_AGENT_PILOT_ONLY keeps the audience restricted to the configured authorized phones. An enabled unified controller with a failed model probe must report controller=unified/planningReady=false in health and keep ownership; it must never report or use a legacy conversation as recovery.

Real WhatsApp acceptance remains required. No synthetic production webhook or outbound test is used. This change does not claim complete Ads Manager coverage or make a campaign-specific spending decision.

Task context is also rebuilt from business background only: historical drafts, journey stages, pending old questions, prior campaign goals, budgets, lead destinations and unconfirmed offers are excluded. Stable business identity, product, brand, media and connection information remain available. Regression checks assert both the removed old goal and the preserved business information.

## November 5: changing goals and cold-start recovery

Owner screenshots and read-only task-turn metadata showed that new messages at 14:13–14:14 UTC were attached to a stalled real-estate task and returned WAITING_MODEL. A later health read showed the selected model acceptance passed; no startup-gate bypass is required.

Explicit requests to market a different product or start a new task, and the standalone question “מה אתה ממליץ לי לשווק?”, now replace the active goal atomically under the client/task locks. Only that task's pending approvals and proposed actions are cancelled. Stored history and verified past effects remain; cancellation never undoes external changes. Live leases, uncertain image/Meta steps and unverified execution attempts prevent replacement pending review. Normal revision requests stay on the same task.

When the new product is unspecified the backend asks one short question immediately, even while the model is warming up. The answer becomes the new request; old task messages, economics and the old product are excluded. Bare approvals and pause/resume controls cannot become product details. Replayed inbound event IDs return their recorded response without creating another task.

The controller waits up to 45 seconds for the existing single-flight model evaluation on an incoming user turn, then rechecks readiness before planning. The acceptance gate, tenant isolation, exact write approvals and unknown-result protections remain enabled. A real provider outage still returns a short honest temporary-error response without quoting the old campaign or sending the user through a magic continuation phrase. This introduces no scheduled execution or outbound tests.
