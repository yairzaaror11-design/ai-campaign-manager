# One conversation owner — 2026-11-04

Problem: a 12-second startup model probe timed out after the free Render instance woke up. The task manager was disabled by its acceptance gate, so the WhatsApp router continued into an older marketing journey. An explicit recruitment campaign and applicant-form request therefore received unrelated sales ads using old business facts.

`conversationController` now owns all ordinary WhatsApp text, voice transcripts and media follow-up for the rollout audience. Routing ownership is independent of model readiness. It calls the durable task engine, which retains the original request, plans the outcome, asks for missing information and prepares reviewed artifacts. Existing marketing/brief/generic-AI routes cannot take over these customer messages. Their source remains for rollback and existing non-pilot consumers; it is not a competing owner for the unified rollout audience.

During model warm-up or failure, the same task is persisted as WAITING_MODEL and the customer is told what is waiting. A later continuation uses the original request. No unrelated draft is generated and no external operation is executed. Failed acceptance can be checked again on a later user turn with a one-minute bound. Task planning now uses structured JSON and a 30-second provider timeout; the same backend validations still gate all plans and writes.

Meta OAuth/account-selection, notifications, explicit report commands, deletion and exact task approvals remain dedicated infrastructure adapters. Connections and credentials are not reset. Old standalone approval codes/buttons cannot authorize an unrelated legacy plan for a unified customer. The current task retains separate artifact review, exact creation approval and activation approval. Human handover and stale interactive choices do not revive an old marketing route.

Regression coverage includes the exact recruitment request with a stale digital-marketing profile, failed startup acceptance, continuation, another outage, greeting/media behavior, stale approval codes and the existing campaign approval/execution suite. The model acceptance recruitment probe also uses the original request against existing social-content business facts.

Rollout requires UNIFIED_CONVERSATION_ENABLED=true. TASK_AGENT_PILOT_ONLY keeps the audience restricted to the configured authorized phones. An enabled unified controller with a failed model probe must report controller=unified/planningReady=false in health and keep ownership; it must never report or use a legacy conversation as recovery.

Real WhatsApp acceptance remains required. No synthetic production webhook or outbound test is used. This change does not claim complete Ads Manager coverage or make a campaign-specific spending decision.
