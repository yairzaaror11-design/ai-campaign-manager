# API cost plan — 2026-10-27

**No unverified price figures are asserted.** Current provider pricing, billing region, currency, taxes and volume tiers require vendor confirmation.

| Service | Cost class | Trigger | Recommendation |
|---|---|---|---|
| Render web | Fixed tier | Running instance | Verify paid tier before launch; currently free |
| PostgreSQL | Fixed tier + storage | Database uptime | Urgent: free instance expires 2026-11-24 |
| Gemini API | Usage-based | Tokens/models | Keep usage caps; verify official price |
| Claude API | Usage-based | Tokens/cache | Add only after adapter and budget controls |
| OpenAI API | Usage-based | Tokens/media | Defer until concrete need |
| WhatsApp Cloud API | Usage-based | Messages/templates by applicable pricing | Verify regional charges |
| Meta Ads | Advertising budget | Actual campaigns | Separate ad spend from SaaS cost |
| Telnyx | Usage-based | Calls/SMS/telephony | Verify account pricing |
| Image generation | Usage-based | Each generation | Limit variants; track per-tenant cost |
| Video generation | Usage-based | Seconds/requests | Defer from MVP |
| Object storage | Storage + egress | Image/video files | Select after retention estimate |
| Payment processor | Transaction-based | Successful payment | Verify provider and country support |
| Backups | Fixed/storage | Retention and restore | Required before commercial launch |
| Monitoring | Free tier/fixed/usage | Logs and alerts | Start minimal; avoid unlimited log retention |

## Budget model
Monthly total = web + database + backup + monitoring + storage base + AI tokens + WhatsApp usage + Telnyx + image/video usage + storage egress + payment fees. Advertising budget must be shown separately. One-time: migration rehearsal, security review, provider onboarding. Defer video, OpenAI as third provider, advanced analytics and paid creative subscriptions until validated demand.

Do not purchase subscriptions or enable billable calls during audit.
