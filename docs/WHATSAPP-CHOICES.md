# Hybrid WhatsApp conversation

Native reply buttons (up to 3) and lists (4–10 choices) are attached only to explicit decision points: welcome, business goal, daily budget, lead destination, offer media terms, strategy/creative review and Meta connection/account selection. Open business descriptions, audience, differentiators and generated creative outputs remain free text. Users may always type or send voice messages.

The welcome describes discovery → strategy/ads → reviewed plan, with account connection when needed and separate publication approval. Each review asks about the next concrete step.

`budgetGuidance.js` offers example budgets of ILS 50/100/200 per day and exact seven-day planning arithmetic. The descriptions indicate testing scope, not guaranteed delivery or unsupported lead forecasts. Once actual suitable-inquiry costs exist a forecast can be grounded in that business's data. No benchmark CPL is invented. These are planning choices, not spend authorization.

`conversationUi` builds backend-owned choices and saves a random, expiring per-client menu with plan/stage/pending-question/revision/connection context. Inbound webhook IDs must match that menu; displayed titles are ignored. Stale, cross-client, forged and reused choices cannot invoke an action. The selected canonical text re-enters the same normal router. UI buttons never issue approval codes or external campaign actions. Text remains available if a menu is old or the device does not display controls.

The existing inbox/dedupe/order and outbox are reused. Interactive outbound messages obey the same 24-hour session window as text and images. Provider send uncertainty does not cause a fallback duplicate. No schema migration, production configuration change, actual message or deployment is needed for development tests.

Primary implementation references (retrieved 2026-10-26):
- Meta's Cloud API collection: https://www.postman.com/meta/whatsapp-business-platform/request/x0kd1at/send-reply-button
- Meta-hosted SDK interactive example (archived SDK; protocol reference only): https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/interactive/

Tests cover payload limits, state/tenant binding, replay/forged title handling, native button and list webhooks through messageHandler, budget facts, no approval creation, and open/closed delivery windows using mocked transports. Live rendering on an actual WhatsApp device remains a release validation item.
