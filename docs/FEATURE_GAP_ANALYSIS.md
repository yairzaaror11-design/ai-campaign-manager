# Feature gap analysis — 2026-10-27

Status convention: **code located** is not **live verified**. All rows require deeper implementation review.

| ID | Component | Purpose | Evidence | Gap | Priority | Dependency | Tests | Status |
|---|---|---|---|---|---|---|---|---|
| F01 | Portal | Customer UI | public/portal | Real navigation and UX acceptance | Important | Auth | Not independently run | Partial/unverified |
| F02 | Authentication | Tenant access | auth.js, sessionStore.js | Route-by-route review | Critical | DB | security tests present | Partial/unverified |
| F03 | CRM | Leads and customers | crmService.js | Live tenant isolation | Important | Auth | tests present | Partial/unverified |
| F04 | AI orchestration | Model calls | aiService.js, gemini.js, claude.js | Provider selection/fallback verification | Important | Secrets/config | provider tests present | Partial/unverified |
| F05 | Conversation | Context/memory | conversationOwner.js, conversationFacts.js | Real chat continuity | Critical | DB | conversation tests present | Partial/unverified |
| F06 | Brief/strategy | Discovery | briefStore.js, marketingBrain.js | End-to-end business brief | Important | Conversation | marketing tests present | Partial/unverified |
| F07 | Campaign lifecycle | Draft/pause/activate | campaignLifecycle.js, metaExecution.js | Live safe approval path | Critical | Meta OAuth | campaign tests present | Partial/unverified |
| F08 | Approvals | Spending gates | approvalEngine.js, approvalPolicy.js | Replay/expiry live assurance | Critical | Auth, campaign | tests present | Partial/unverified |
| F09 | Meta | Ads and OAuth | metaOAuth.js, metaAds.js | Live permission/account validation | Critical | OAuth | mocked tests present | Partial/unverified |
| F10 | WhatsApp | Customer channel | whatsapp.js, webhook.js | Live delivery and webhook authenticity | Critical | Meta config | webhook tests present | Partial/unverified |
| F11 | Voice | Transcription | voiceHandler.js | Live audio test | Important | Provider | Not verified | Partial/unverified |
| F12 | Graphics | Images | graphicService.js | Cost/fidelity/live generation | Future | AI provider | graphics tests present | Partial/unverified |
| F13 | Video | Video generation | mediaHandler.js | Provider workflow not established | Future | Storage | Not verified | Unverified |
| F14 | Reports | Campaign analytics | reportService.js | Live data accuracy | Important | Meta read | report tests present | Partial/unverified |
| F15 | Billing | Subscription/payment | billingService.js | Actual checkout and webhook verification | Important | Provider | billing tests present | Partial/unverified |
| F16 | Infrastructure | Service/DB | render.yaml, db.js | Backup restore and expiry mitigation | Critical | Render | restore script present | Partial/unverified |
| F17 | Social accounts | Social connectivity | socialConnections.js | Live OAuth and publishing | Future | Meta permissions | tests present | Partial/unverified |
| F18 | Google Ads/Analytics | External analytics | No confirmed live connector | Locate implementation or plan | Future | OAuth | None verified | Unverified |

No item is marked fully working solely from filenames or PR descriptions.
