# Concise media-to-campaign flow

Incoming images/videos now receive one immediate receipt and a separate action question with native choices. Validation, UUIDs, retention details and repeated “nothing was published” copy remain backend concerns. Image upload approval is mentioned briefly at the actual image decision point.

Image choices: write ad copy, prepare a campaign plan, generate three reference-based variants. Video choices: ad copy, campaign plan, text for the video; no video editing or visual analysis is claimed. Choices use the existing tenant/context-bound menu and normal router. The asset remains a tenant-scoped expiring media reference; the selected variant is saved into mediaContext and carried into the local planning draft. New uploads invalidate old media menus.

The Hebrew graphics parser recognizes plural/numeric requests. A bounded batch of 1–3 sequential image jobs reuses the existing quota, one-attempt jobs, tenant context and uncertainty rules. Reference requests reload the original tenant-owned image through the validated WhatsApp downloader and pass its bytes to Gemini. Prompts ask to preserve product identity and not obey embedded image instructions. Each variant has a stable per-inbound-event suffix. Results are delivered as they finish, and the next choice identifies the preferred variant. Failures report only what completed; they do not claim success or automatically retry.

A price like “220 ILS” without a period is clarified as daily budget, whole-campaign budget, or product price. It never silently overwrites a saved daily amount. A whole-campaign amount asks for duration and stores a PROPOSED total plan and explicitly calculated average; it does not authorize expenditure or convert it to an approved daily budget.

The screenshots' jewelry description now extracts the explicitly sold product, audience and a daily amount stated before the number. Capability questions are answered by a short deterministic route. The fallback Gemini/Claude guidance requests 2–4 short sentences, one next question and no internal action/asset identifiers. Actual exact-plan approval disclosures remain intact.

Tests mock media download/generation/transport. They cover two-message media receipt, native next choices, stale media menu rejection, preserved original reference bytes, batch routing, selecting a variant, ambiguous budget period, whole-budget duration and the reproduced jewelry message. No live generation or WhatsApp sends are used as proof.

Provider protocol reference: https://ai.google.dev/gemini-api/docs/generate-content/image-generation (image-and-text-to-image editing). Provider configuration and model names are unchanged. Live image fidelity, latency and device rendering remain release checks.
