# Conversation ownership and Meta onboarding

The marketing journey owns ordinary discovery, strategy, creative review and local plans. Explicit `/brief` commands keep the existing manual workflow; lifecycle approval commands keep the existing approval engine. `conversationOwner.owner` picks one controller per message. Diagnostic question-bank routes remain available on explicit request.

## Canonical memory

`marketing_profiles.payload.answers` is the existing canonical fact store. `conversationFacts` maps semantic names to existing bank storage keys/scopes. Each answer retains status, verbatim evidence, timestamp, source and up to eight earlier values. Business facts survive a new plan; campaign facts are scoped by plan ID. Unknown is an explicit value, never an inferred budget. The journey has schemaVersion 2, stage, pendingField, revision, draft, requested output, pause state and review flags. A profile revision guards analysis computed outside a database lock. History import reads only the latest 200 USER messages once; it never imports assistant assertions.

Eight core facts drive discovery. A promotional gift may need additional questions to establish media funding, scope and obligations. An explicit summary uses canonical facts; the AI receives typed current context rather than a truncated chat summary. Corrections invalidate derived drafts/review flags. Generic yes/continue advances only the current review; it never approves an external action.

The deterministic draft is stored in the same profile as LOCAL_DRAFT. It is a planning proposal, not an executable Meta action. The existing workflow validates account/currency/assets/dates before issuing a hashed, expiring approval. Creation is PAUSED and activation needs a separate exact-plan approval.

## Logical data mapping

- customer_id/business_id: existing clients.id in the pilot's one-business-per-client model.
- business name/type/location: existing answer keys via conversationFacts.
- onboarding/conversation/brief status: payload.journey; existing manual campaign_briefs remains available.
- account/user/encrypted token: existing clients and meta_connections; no parallel token table.
- verified account name/currency, permissions/check/error: payload.connection, verified server-side.
- page/form/Instagram asset references: existing campaign brief/plan payload; portfolio or other assets not returned by the granted permissions remain unknown. No association is inferred from a name or user assertion.
- campaign goal/audience/budget/location/service/advantage/destination: existing scoped answers.

## Meta states and security

`metaConversation.STATES` and `TRANSITIONS` define the allowed lifecycle. Server verification checks configured app, expiration, granted ads_read, current active accounts and account generation. Connection status is never established by “I connected”. Permission failures and provider errors are sanitized. Read access is distinct from ads_management plus backend write switches. OAuth reuses existing encrypted tokens, single-use state/browser binding and generation checks; parallel callbacks cannot overwrite a newer connection. Disconnect cancels pending approvals. Invite URLs are excluded from saved AI/profile history.

## Versioned knowledge

Migration 006 adds only meta_ads_knowledge, seeded with 15 topic cards from data/meta-ads-knowledge.he.json. Each carries id/category/content/version/update date/source/source_status/tags/conditions. `metaKnowledge.retrieve` ranks the current database content and returns at most three bounded cards. It never returns credentials. Knowledge is reference data, not permission or behavior instructions.

To update knowledge without core-code changes, review the documentation and edit a card's payload, increment version and updated_at in a **new migration** (or an authorized administration transaction in a development environment). Keep the same stable ID; add new cards under distinct IDs. Include source verification status. Existing migration checksums are immutable. The repository seed is the reproducible baseline; runtime selection uses the database version. Deployment and production migrations require separate authorization.

Some official Meta documentation endpoints returned access errors/429 during research. Those cards explicitly carry an unverified-reference status. Actual permission eligibility, App Review and business verification must be checked with the real app before release.

## Queue order

Migration 007 adds monotonic ingest_order/delivery_order, avoiding lexical WhatsApp IDs and transaction-timestamp ties. Workers claim one active event per sender and one send per recipient using row locks, transaction advisory locks and a busy recheck. Other tenants may progress independently. Uncertain external effects are not replayed automatically. Existing independent inbound/outbound worker loops preserve progress notices while work is running.

## Verification and release boundaries

Tests use mocked AI/Meta/voice/WhatsApp transports, embedded PostgreSQL and external PostgreSQL in CI. No new live OAuth, real message or campaign is used as test evidence. New migrations must run before workers start (existing initializeDatabase does this). Runtime imports require the complete commit, including both migrations and knowledge seed.


## Conversation-control and creative repair

Direct Hebrew requests to restart the conversation are handled before routing or extraction, just like `/reset`. They clear chat history, collected facts, the local draft and interactive/media context for that client, cancel pending action approvals, preserve the Meta connection and mark history import complete. This resets local conversation state, not external Meta objects or WhatsApp chat history on the device.

Migration 008 removes only stored fact values containing explicit chat-reset instructions from the reported incident. Other facts and connections remain untouched; affected cached menus/results and drafts are invalidated. New fact validation rejects such control text.

Creative feedback for message/all/style/short/personal now produces changed copy using existing facts and offer terms, invalidates review flags and persists the edited creatives when progressing to a plan. Unsupported feedback asks for clarification without claiming a rewrite. No new model call or external campaign operation is required.
