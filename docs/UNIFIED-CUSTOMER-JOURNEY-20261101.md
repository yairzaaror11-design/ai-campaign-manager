# SCORPIO customer journey: implementation and remaining gates

The customer chooses a task before intake: advertise a product/service, prepare social content, or discuss something else. WhatsApp profile name is a display hint, never a verified identity or gender. Explicit preferred names override it; opting out is supported. Names are used occasionally, separately from business identity. The ordinary route asks what to advertise, its business goal and the media budget before preview when website onboarding is enabled. Differentiation is optional refinement, never a mandatory second question.

## This release

- Combined draft review includes actual ad text and the plan; ordinary build requests skip strategy/creative continuation checkpoints. Explicit strategy or copy-only requests remain available.
- Local post/story drafting, revision, return/resume and an editorial week proposal reuse business facts and received media references. Social drafts project idempotently into the existing dashboard content workspace. All remain DRAFT; a proposed calendar does not schedule publication.
- Both-channel requests prepare ad and social text without confusing media budget with organic posting.
- Optional refinement captures desired customers, capacity, lead owner, proof, prior marketing and success criteria. Unknowns remain unknown. General AI can extract these bounded explicit fields with verbatim evidence.
- Media receipt offers a social-content option alongside campaign and variation options. Graphic prompts now include bounded business, color and current social-draft context.
- CRM chat supports manual lead intake, existing bound outcome menus, revenue with explicit currency, loss reasons and aggregate follow-up. Manual outcomes are never presented as verified campaign attribution.
- Existing account verification, voice transcription, report date parsing, pagination, tenant-bound approvals and outbox dedupe remain in place.

## Requirement map

| Requirement | Evidence | Current limit |
| --- | --- | --- |
| Natural conversation, detours, short replies, resume | conversationAnalysis/Flexibility/Journey, existing regression suite | AI interpretation still depends on provider availability |
| Personal name and task-first opening | personalConversation, conversationUi, unifiedCustomerJourney tests | Display name is unverified and correctable; no gender inferred |
| Business website and brand confirmation | businessEntry/publicWebsite + integratedJourney tests | Public readable pages only; inferred facts need confirmation |
| 500-question XLSX/JSON and source/logic tables | existing catalogue + exported workbook and validation report | Catalogue rules include descriptive guidance, not a universal rule executor |
| Paid plan and real creation/activation approvals | campaignSetup, approvalEngine, metaExecution + approval button tests | Must verify real campaign after customer-specific approval; no campaign spending authorized by this release |
| Meta one initial authorization | unifiedMetaLogin tests and real granted permissions | Revocation/expiry may need renewal; account and app access remain required |
| Social post/story preparation and dashboard continuity | socialContent + unifiedCustomerJourney tests | External organic publishing/scheduler is not implemented here; publishing permissions/adapters still required |
| Graphics/media/voice | graphicService/mediaHandler/voiceHandler tests | No video generation or editing; real provider output must be validated |
| Registration/dashboard/CRM continuity | portalStore/Routes, workspaceService, HTTP isolation tests | Customer login is required for private dashboard data |
| Lead to outcome and reported revenue | crmConversation/crmService | Meta instant-form lead ingestion and verified revenue attribution are not implemented |
| Performance diagnosis and experiments | marketingBrain + marketing questions diagnostic routes | Recommendations are read-only and data-dependent; not proof of autonomous optimization |
| Subscription/payment | disabled existing billing scaffold | Owner will supply Israeli provider and price; no paid purchase enabled |
| Uptime | existing Render service | Free plan can sleep; approved upgrade remains blocked by missing payment method |
| Production verification | Render deploy + exact SHA health + real inbound/outbox checks | A successful health check is not proof of the new conversation on a real device |

## Validation and rollback

Run syntax, full tests with isolated PostgreSQL and the dependency audit. Acceptance includes existing 20 scenarios, product-first flow, channel switching, stale content, naming/opt-out, draft projection dedupe and CRM outcomes. No new schema migration. Roll back to c0919bb51ad6c1a63b633058bd96ec31958b078e if this release regresses the conversation; additive profile keys and local content records are compatible. Never restore an old snapshot over new customer writes as an application rollback.

Production remains within the owner's scope: software deploy is authorized. Previous explicit prohibition on changing READ_ONLY requires a focused owner decision before opening the write gate. A write gate is never campaign approval. Each creation and subsequent activation still requires its own exact WhatsApp approval.
