# API and adapter contracts

Existing mutation path remains validated actionPlan → preparePlan → exact approval or bounded authority → actionExecutor → metaExecution permit → metaWrite → metaVerify. Missing operations stay unsupported. Account/page ownership, permission, generation and state checks stay server-side. A configured Graph version is not blanket API eligibility.

New routes inside existing authenticated session/CSRF boundary:

- GET /app/api/authority: own authorization records.
- POST /app/api/authority/proposals: UUID replay key, label, supported intents, currency, action cap, expiry and optional resource/draft-budget scopes.
- POST /app/api/authority/:id/approve: exact revision/hash and APPROVE_SCOPED_AUTHORITY confirmation.
- POST /app/api/authority/:id/revoke: current revision; remains available with the feature off.
- GET/POST /app/api/agent: opt-in common task controller for authorized pilot users; browser tenant fields cannot select the actor.
- GET /app/api/agent/media/:id: only unexpired owned safe image bytes.

get_authorization_status is a read tool; there is no model grant/approve equivalent. Future adapters require typed discovery, permission/capability snapshots, strict mutation schemas, pagination/completeness, date/timezone/attribution definitions, durable attempts and readback. Access gaps return BLOCKED, never customer-looking samples or fabricated successful IDs.
