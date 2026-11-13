# WhatsApp capability connections — 2026-11-05

Owner approved implementing the audit fixes and connecting existing capabilities directly. Scope preserves CRM deferral, disabled billing, exact Meta approvals and authorized-phone pilot rollout.

- botCapabilities is the shared executable registry for planner read access and capability discovery. Every declared read tool must match the registry in regression coverage. Discovery no longer claims a deployed bulk lead importer; it reports external prerequisites and unsupported integrations explicitly.
- Existing Meta knowledge (15 topics), marketing questions (500), saved answers, deterministic campaign diagnosis and existing landing-page drafts are available through the same WhatsApp task engine. There are 18 registered read tools and 12 unchanged Meta write intents.
- Landing content can be drafted through destination=landing_page, then saved as a private dashboard DRAFT only after exact package review. Task/lease/artifact binding is checked transactionally; request identity is deterministic and retries cannot duplicate a saved draft. Nothing here publishes a landing page or sends its leads to an external CRM.
- A re-emitted model plan on a continuation no longer causes TASK_PLAN_ALREADY_SET. The original validated plan remains authoritative; later plans are ignored. Each next operation must still match an existing unfinished step, its dependencies, its intent, review state, ownership and approval. An injected step in a later plan cannot execute or change the original goal.
- Live model acceptance adds a continuation-feedback probe: change only a cafe headline on an existing prepared draft, preserving the 45 ILS offer. Initial-decision probes alone were insufficient evidence of conversation reliability.

Regression covers the actual WhatsApp router -> planner -> knowledge/questions/answers/diagnosis/pages -> landing package -> explicit review -> private draft save, with repeated/injected plans, tenant isolation, stale lease rejection, replay idempotency and zero Meta writes/publication.

Claude credentials, video generation, full website deployment and organic social publication are not silently activated by a code adapter. They remain unavailable without their provider configuration and an implemented execution contract. No external permission, account connection, campaign approval or purchase is inferred from package approval.
