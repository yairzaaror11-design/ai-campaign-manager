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

Live rollout also exposed a failed financial probe: the model paraphrased the optional period label, which the strict evidence validator correctly rejected. Planner instructions and the shared tool schema now specify an exact contiguous owner quotation for period.value and evidence, or omission with UNKNOWN when unavailable. The validation rule remains strict; the real task path turns the rejected period into a targeted question instead of a generic ERROR. All five acceptance probes must still pass before planning is enabled.

## November 5: first plan after the product answer

Owner WhatsApp acceptance confirmed goal switching, then failed on the next property description. Read-only task metadata showed INVALID_TASK_PLAN, zero accepted steps and one planner call. No raw provider response was persisted, so a specific malformed field is not claimed. The instructions had an ambiguous “every continuation omits plan” rule even when a backend clarification occurred before the first model decision.

Every planner call now carries a server-derived planningPhase: INITIAL_PLAN_REQUIRED for an empty persisted plan, CONTINUE_EXISTING_PLAN otherwise. The former requires a full plan regardless of user message count. Before any step is accepted, one malformed JSON/initial-plan response can be corrected with safe backend feedback, within the same existing task/turn/rate limits. A second invalid response fails closed. Accepted plans remain authoritative, and no read/image/Meta executor or uncertain side effect is retried by this mechanism. The apartment response regression covers clarification, missing initial plan, correction, grounded property fields, draft review and duplicate inbound replay. A sixth real-model startup probe covers the apartment answer after a clarification.
