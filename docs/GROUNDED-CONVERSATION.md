# Grounded conversation and content flow

This release addresses five observed problems: ambiguous intent, generic recommendations, automatic reuse of old offers, content without a purpose, and promises that lead to another menu instead of a draft.

## Intent and next steps

Content intent distinguishes a refusal, an explicit correction such as “not a post, a campaign”, and ambiguous “no I want social content”. Clear corrections use the requested channel; ambiguity receives one bound choice; questions about another channel remain conversation. General refusal is never stored as a product answer. Pending offer or content questions take precedence over old Meta connection prompts. Offer consent is never advertising consent.

One suggested direction uses the known product and asks for the single missing input. A business-update request asks what actually happened. A work-example request asks for an image/caption. Explicit replies become a bounded user-reported content brief. No new event, customer story, proof or outcome is invented. Service explanation, showing work, an update, inquiry and promotion are distinct content purposes.

When an image/video arrives after the agent asked for it to prepare a post, it continues to the draft rather than displaying the generic media menu. Captions remain untrusted user-reported data. If the product is unknown, the agent asks what the file shows; it does not claim visual understanding. A new asset invalidates earlier draft review. Prepared content projects through the existing idempotent dashboard workflow. Calendar entries are a proposed sequence; no dates, publishing schedule or external publication are silently set.

## Offer use

A saved offer is historical context and is omitted from new copy by default. Explicit requests to use an offer collect any missing required terms, then present the exact offer/terms for confirmation. Unknown terms lead to an ordinary draft without the offer. Offer-use review expires after ten minutes. Confirmation is valid for up to 24 hours and is bound to plan, channel, product, purpose and offer terms; changes or expiration require a new review. A new informational social request does not inherit a promotional purpose. Cached legacy copy containing an unconfirmed offer is marked stale, including the Meta setup entry point.

Creative providers receive only the offer authorized for the current context. Advertising budget is excluded from copy facts, so it cannot serve as a supported product price. Copy validation rejects ungrounded numeric claims and free/discount claims. Required offer terms remain complete. This is bounded validation, not a general semantic truth verifier; final customer review remains required.

## Persistence and safety

The optimistic conversation update now persists removed transient fields as well as additions. This prevents completed content questions and offer reviews from returning after a response. Existing version conflict, event replay, tenant, deletion and approval protections remain. No schema migration, new dependency, paid service, actual campaign execution, or publishing adapter is introduced. Production ad writes remain gated by exact WhatsApp approval and separate creation-paused/activation approvals.

## Verification and rollback

Tests cover stale/expired offers, channel/product/purpose separation, unknown terms, old cached promotions, refusal/correction/side questions, one grounded recommendation, real input to draft, pricing-claim rejection, media to draft to dashboard, and offer approval never creating a Meta approval or execution. Existing voice, account, report, security and 20 acceptance scenarios must remain green. Provider calls and external sends are intercepted in automated tests; real-device proof is tracked separately.

Rollback target: d6523f946e2b98244d043080536b80793fc6be55. No migration reversal or customer-data restoration is needed. If an external-write safety concern appears, close READ_ONLY/META_WRITES gates before investigating; do not weaken action approvals. New optional profile keys are additive and ignored by the preceding version.
