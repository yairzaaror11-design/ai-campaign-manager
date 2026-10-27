# API and infrastructure cost plan

Checked 2026-10-27. Prices are USD list-price references where the official page exposed them; taxes, billing region, discounts, output length, quotas and future price changes can alter invoices. No service was purchased, no billing setting changed, and no paid API call was made. Any component without a reliable exact price is explicitly marked for verification.

## Cost inventory

| Cost item | Current code/config evidence | Cost class | Planning value/status | Recommendation |
|---|---|---|---|---|
| Render web service | One Free Node web instance; currently $0 plan | Monthly fixed/usage | Current bill amount/credits not independently accessible. Render pricing page currently lists a low paid compute tier at $6/month (256 MB) and 1 GB at $19/month; actual fit/limits must be checked. Hobby workspace is $0; Pro workspace is $25/month plus compute. | Keep free only for noncritical test; price a paid service before customers. |
| PostgreSQL | Free PostgreSQL 18, expires 2026-11-24 | Monthly fixed + storage | Current plan price $0 but is not durable. Render pricing lists Postgres storage at $0.30/GB/month; compute tier, backups/PITR and final DB total require a current quote. | Critical: choose durable plan before expiry, test restore, restrict network. |
| Gemini text/chat | Default provider Gemini; model set to `gemini-3.5-flash` in Blueprint | Usage-based tokens | Exact price for that exact configured ID was not established from the pricing table retrieved. Official Gemini pricing is model/tier/region dependent; verify the exact model in Google AI Studio/official pricing before enabling usage. | Meter input/output tokens by client; per-client daily/monthly ceilings and alerts. |
| Gemini image generation | Image model `gemini-nano-banana-2.1` | Usage-based per generated image/tokens | Official Gemini pricing page lists approximate output cost of $0.0336 per 1K image, $0.0504 per 2K, and $0.113 per 4K for this model. Batch pricing listed lower ($0.0168/$0.0252/$0.0567) but is not suitable if synchronous product UX is required. Verify model ID and account tier before budgeting. | Use the existing attempt limit; expose per-tenant usage; cap variants and image size. |
| Claude API | Adapter exists, API key/model env expected | Usage-based tokens/cache | Exact production model is not exposed by audit tooling. Official platform docs show Claude Sonnet 4.6 at $3/MTok input and $15/MTok output; use only if that model is deliberately selected. | Defer paid enablement until adapter, cost ceilings and model evaluation pass. |
| OpenAI API | No integration found | Usage-based | No implementation/model selected; do not estimate. Official current API token price requires selecting an API model and billing tier. | Defer until a product requirement exists. |
| WhatsApp Cloud API | Signed webhooks, outbox and templates implemented; send flag live true | Usage-based message charges | Meta's pricing is destination- and message-category-specific; official pricing page was unavailable to this audit (429), so no per-message amount is asserted. WhatsApp service is not a flat SaaS API subscription in the code. | Verify current Israel/recipient-country rate card, free-service rules and template costs in Meta billing before scaling. |
| Telnyx SMS | Inbound SMS webhook/admin inbox code; separate from WhatsApp | Usage-based + phone number | Telnyx pricing page lists US SMS from $0.004 per part plus carrier fees and numbers from $1/month. Current project number/account/route and destination-specific rate were not verified; these are reference floor figures, not invoice forecast. | Do not route customers through SMS unless product chooses it. |
| Meta advertising | Marketing API reads and gated writes | Advertising spend, separate from SaaS | Actual campaign spend is set at Meta and is not part of hosting/API totals. Meta API access itself may require app/business verification and permissions; no live ad account token exists in DB. | Require explicit budget approval; report customer ad spend separately. |
| Video generation | Not implemented; portal capability says false | Deferred usage | No current video API cost. | Defer until provider and storage workflow are selected. |
| Image/video storage | No general object-store integration confirmed; DB has tenant media references | Storage + operations/egress | No deployed bucket/provider to price. Google Cloud Storage official pricing is location/class/operation dependent; Oregon standard storage example is around $0.022/GB-month in a dual-region pricing example, not a quote for this app. | Decide storage lifecycle/retention and egress before video; keep provider URLs separate from durable copies. |
| Stripe/payment processing | Stripe-style adapter and endpoints exist; no subscriptions found in DB | Transaction fee | Exact fees depend on merchant country, payment method, currency and account agreement; no production merchant validation. | Verify Israel merchant availability/fees, tax invoices and refund/chargeback handling before launch. |
| Backups | Historical archive/rehearsal noted in release validation; current backup schedule not verified | Fixed/storage | Current plan's backup/PITR capability and archive retention are unknown. Render Pro pricing page lists database PITR as a plan feature; database compute and retention still need a quote. External encrypted backup storage depends on size/retention. | Obtain an offsite encrypted backup and document isolated restore proof. |
| Monitoring | Render logs available; no external monitor integration identified; metrics query empty | Free/fixed/usage | Alerting and log retention plan not verified. | Start with health/5xx/worker/queue alerts; set retention and spending budget. |

## Cost categories

### Currently known monthly fixed items

- Render service: currently on Free ($0 plan); operational cost could remain $0 only with free-tier constraints.
- Render PostgreSQL: currently on Free ($0 plan), with expiry on 2026-11-24. This cannot be treated as a viable commercial ongoing cost.
- No connected paid third-party storage, monitoring, billing subscription, Claude, or OpenAI integration was established by this audit.

### Usage-based charges

Gemini text/audio tokens; Gemini image requests; WhatsApp messages/templates; Telnyx SMS/carrier fees; Meta ad spend; payment fees; file storage, operations and egress. Calculate only after specifying activity volume, model, recipient countries, media sizes, retention and paid tiers.

### One-time/launch costs

Meta/Google business or app verification where required, domain setup, security/privacy review, integration test numbers/accounts, and the staff time for an isolated backup restore. Do not imply provider approval fees unless confirmed.

### Defer

OpenAI as a third model; Claude live traffic before evaluation and spend limits; video generation/editing; Google Ads/Analytics until specified; broad social publishing; high-retention object storage; paid monitoring products before alert requirements are set.

## Practical estimate

A trustworthy monthly total cannot yet be calculated: usage volume is unknown, exact Gemini text model price is unresolved, WhatsApp rate card is country/category-dependent, database paid compute/backup tier is unselected, merchant country pricing is unverified, and no media bucket is selected. The defensible current baseline is **$0 free-tier listed plans, with an expiring database and nonproduction reliability**. A minimal paid Render web service starts at the current public $6/month compute listing, plus PostgreSQL compute/storage/backup and any workspace features; this is not a full-system quote. Set a provisional cap only after the durable DB choice and expected monthly customers/messages/images are specified.

## Price references

- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Anthropic API model pricing](https://docs.anthropic.com/en/docs/about-claude/pricing)
- [OpenAI API pricing/docs](https://developers.openai.com/api/docs/pricing/)
- [Render pricing](https://render.com/pricing)
- [Meta WhatsApp pricing](https://developers.facebook.com/docs/whatsapp/pricing/)
- [Telnyx messaging pricing](https://telnyx.com/pricing/messaging)
- [Google Cloud Storage pricing](https://cloud.google.com/storage/pricing)
- [Stripe pricing](https://stripe.com/pricing)

Official prices should be rechecked immediately before subscription purchase or production enablement.
