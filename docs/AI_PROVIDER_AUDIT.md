# AI provider audit — 2026-10-27

| Capability | Code | API configured/live | Automated tests | Real call during audit | Gap |
|---|---|---|---|---|---|
| Gemini | gemini.js, @google/genai dependency | Not verified | geminiIntegration.test.js | No | Check runtime selection, quota and output |
| Claude | claude.js | Not verified | providerSafety.test.js exists | No | Verify interface, keys and error handling |
| OpenAI | No confirmed dedicated module in inspected tree | Not verified | Not identified | No | Confirm actual requirement before implementing |
| Model selection | aiService.js | Not verified | Not established | No | Verify routing and fallback |
| Memory | conversationFacts.js, conversationOwner.js | DB persistence not fully traced | Conversation tests | No | Validate tenant isolation and retention |
| Context | conversationFlexibility.js, messageHandler.js | Not verified | Conversation tests | No | Real multi-turn regression |
| Voice | voiceHandler.js | Not verified | Not established | No | Real transcription quality |
| Questions/brief | marketingQuestions.js, briefConversation.js | Internal code | Marketing tests | No | Full journey acceptance |
| Strategy/copy | marketingBrain.js, creativeGeneration.js | Not verified | Marketing/creative tests | No | Evidence-grounding and approval |
| Campaign analysis | reportService.js, conversationAnalysis.js | Not verified | Reporting tests | No | Real Meta data verification |

Claude alongside Gemini is architecturally plausible without wholesale rewrite because both modules exist; this is **not** proof of a common adapter or successful provider failover. Never use paid calls during this audit.
