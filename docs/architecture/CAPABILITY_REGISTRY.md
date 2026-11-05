# Capability inventory

botCapabilities.js is the executable registry and must match Gemini read declarations. Code support, configuration, provider eligibility and live verification are separate states.

| Requirement | Code | State / gate |
|---|---|---|
|Identity/OAuth/tenant|metaConnection, portalStore|Existing tested subset; full delegated RBAC missing.|
|Scoped authority|scopedAuthority, authorityRoutes, migration022|Implemented and isolated tested; flag off.|
|Natural text/voice tasks|conversationController, taskAgent|Existing tested paths; real-device acceptance remains.|
|Shared app/WhatsApp core|unifiedPortalAgent, migration023|Implemented and isolated tested; flag off.|
|Multiple independent tasks|Single-active task index|Partial; parent/child coordination missing.|
|Meta|Existing write/read/verify adapters|Supported subset, not all Ads Manager.|
|Google Ads|No runtime campaign adapter|Missing; developer/OAuth/test account needed.|
|Professional engines|professionalSkills, businessCase|16 partial guides and deterministic calculation subset.|
|CRM/measurement|crmService, reportService|Partial; live CRM import excluded.|
|Creative/landing|graphicService, mediaStore, landingDrafts|Images/partial landing support; video/independent durable storage missing.|
|Reliability|Leases, reconciliation, manual review|Tested subset; provider failure pilot needed.|
|Optimization|Deterministic economics|No autonomous paid changes or complete experiment engine.|
|Reports/notifications|reportService, WhatsApp gate|Partial; consent/template/eligibility checks apply.|
|Other platforms|Social connection records|No claim of complete campaign execution.|
|Commercial|billingService, humanSupport|Partial; real billing/paid access not enabled.|
