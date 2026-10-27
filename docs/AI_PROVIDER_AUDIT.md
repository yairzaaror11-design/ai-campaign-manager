# AI provider and capability audit

Code audited: deployed commit `bece3706379713d92372f302095364d3fa9c2c3f`. No provider API was called during this audit. Tests and historical release records are not represented as fresh provider calls.

| Capability/provider | Code exists | API connection evidence | Automated tests | Real test evidence | Remaining work | Status |
|---|---|---|---|---|---|---|
| Gemini text/chat | Yes: `gemini.js`, `aiService.js`; @google/genai dependency; Gemini default | Live health says configuration true; secret values were not read; no request made | Gemini integration/probe and provider safety tests | No real chat/text call in this audit; manual-only connectivity workflow not invoked because it bills | Confirm exact model ID, account access/quota, errors/latency and per-client spend controls | Partial |
| Gemini images | Yes: `graphicService.js`, image model env | Blueprint names `gemini-nano-banana-2.1`; key not exposed to read-only audit | Graphics/media tests | Release validation doc reports a prior live image generation/upload; not repeated | Confirm model, account billing, caps, retention and current output quality | Partial; historical live evidence |
| Gemini voice | Yes: `voiceHandler.js`; separate transcription model | Runtime configuration only; no live call | Voice/media tests | No current live audio request | Validate Hebrew accuracy, format, timeout, privacy and usage cost | Partial |
| Claude | Yes: `claude.js`; provider dispatch in `aiService.js`; key/model config | No key value read and no live Anthropic call | `providerSafety.test.js` mocks Claude through common proposal interface and checks no direct write tool | No real request evidence | Confirm model ID, dispatch, timeout, rate limits, usage metering, quality and fallback | Partial |
| OpenAI | No adapter/package/API module found in deployed tree | None found | None identified | None | Only add after product requirement, data policy, model and spend cap are selected | Missing |
| Model choice/fallback | Yes: config-driven provider selection, Gemini/Claude modules | Blueprint selects Gemini; current actual env not readable; no fallback request verified | Provider contract/safety tests | None | Verify provider switch, timeout/failure/malformed output paths; preserve server-side validation and no duplicate effects | Partial |
| Memory/context | Yes: conversation owner/facts, message and profile/brief stores | PostgreSQL live query succeeds; tables/migrations exist | Conversation journey, flexibility, repair, context, persistence, queue tests | No customer chat in this audit | Test restart, correction, tenant isolation, retention and deletion end to end | Partial |
| Question flow/brief | Yes: question bank, marketing questions, brief conversation/store | Internal orchestration; provider not live-tested | Marketing question/router/persistence tests | None this audit | Validate skip/correct/resume and complete saved brief with a test tenant | Partial |
| Strategy | Yes: `marketingBrain.js` advisory logic | No live call | Marketing brain tests | None this audit | Evidence grounding and uncertainty; no claim of live performance without Meta data | Partial |
| Copy/creative | Yes: creative generation/revision and media flow | Gemini image has historical evidence; text not live-tested | Creative/revision/media tests | No fresh generation during this audit | Verify Hebrew quality, disclosures, brand constraints and draft/approval state | Partial |
| Campaign analysis | Yes: report service/conversation analysis and Meta read layer | 0 stored Meta token rows; no account call | Reporting/pagination tests | None | Connect approved test ad account; reconcile sampled values before relying on recommendations | Partial |

## Adding Claude beside Gemini

Claude can likely be used through the existing provider boundary without replacing campaign, conversation or approval domains: both adapters are present and a mocked safety test checks a shared proposal shape. That supports a low-scope provider addition, not a claim of production-ready transparent failover.

Before live enablement, confirm model IDs and keys, identical schema/output validation, timeout/error mapping, retry limits, per-tenant metering and fallback behavior. Model output must remain a proposal. Server-side validators, approval hashes and independent Meta switches must authorize all effects.

The checked-in Blueprint names `gemini-3.5-flash`; verify availability/pricing for that exact model before spending. The audit did not run the manual Gemini connectivity workflow or perform any paid inference.
