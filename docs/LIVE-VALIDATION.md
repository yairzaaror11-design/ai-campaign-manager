# Live validation — 2026-10-25

## Confirmed

- The authenticated Meta Graph API Explorer for Campaign Bachat successfully read 20 ad accounts, 16 with account_status=1. The cached browser token works; the old Render META_ADS_ACCESS_TOKEN was rejected with HTTP 401 / code 190. The per-client OAuth redirect flow has not yet run through the deployed application.
- With explicit user approval, created Login Configuration `Campaign Bachat Read Test`, ID `1893382361625002`, using a User access token and ads_read only. No ads_management grant was added and the app was not published.
- The production WhatsApp setup shows a registered Campaign Bachat phone ending 8167, phone ID `1361596290375265`, WABA ID `2437172833477487`, with webhook subscription enabled. Test-number absence does not mean the real phone is unregistered.
- The current Render WHATSAPP_ACCESS_TOKEN and ANTHROPIC_API_KEY values were empty. A permanent WhatsApp token was requested through Meta; generation is awaiting the user's SMS two-factor authentication. Do not invent a token or copy the Marketing API token into this field.
- Gemini model listing succeeded. A small, structured Hebrew campaign-understanding generation request returned HTTP 503, including one bounded retry. A successful generation is not claimed; Claude generation could not run without a configured key.
- Render is still running commit `0475317`, not the new PR code. Read-only database inspection found no OAuth schema, migration registry or outbound queue yet. The inspected clients, conversation_messages, approvals, campaign_briefs and telnyx_inbound_messages tables each contained zero rows. This is not a complete backup or restore test.
- User-provided privacy operator: קמפיין בצ׳ט. Contact: yairdigitalil@gmail.com. Prepared configuration now includes these non-secret values and the approved Meta app/configuration IDs. Backup retention remains to be established, so privacy release requirements are not considered complete.

## Secret handling

Render's environment export was used only for isolated provider probes. No secret values were printed, added to code, or committed. The downloaded temporary export was removed. `scripts/live-readiness.js` takes a private env-file path and emits only whitelisted summaries. It imports no workers, message handlers or write adapters and sends no WhatsApp or Meta campaign write requests.

## Next gates

Complete the pending SMS authentication directly in Meta, then store the generated WhatsApp token in Render and verify phone access without sending a message. Prepare and validate deployment configuration and database backup/recovery before deploying the new application. A real incoming/outgoing message test, end-to-end client OAuth, commercial Meta approval and a successful live AI generation remain outstanding.

## Configuration discrepancy requiring verification (2026-10-26)

- The live-validation record lists Meta Login Configuration `1893382361625002` for an approved `ads_read`-only test, but `render.yaml` currently specifies `META_LOGIN_CONFIG_ID=1547508470739287`. Do not assume these configurations are interchangeable. Verify which app/configuration is authorized for the intended OAuth flow before any deployment or live client login. No production setting was changed.
- The isolated Gemini probe now tries the configured `GEMINI_MODEL` first and falls back to `gemini-2.5-flash` only when listed as supporting `generateContent`. This code change is not evidence of a successful live generation.

## Verified release update — 2026-10-26
The old OAuth configuration 1893382361625002 belongs to old Meta app 1893122418791568. The user requested migration to app 3244596585929846; its approved ads_read-only user-token configuration is 1547508470739287. These are intentionally different apps. The new app was published with the owner’s explicit approval after privacy/deletion configuration. Gemini 3.5 Flash passed live Hebrew understanding; Nano Banana 2.1 passed live image generation after owner-enabled billing, and the image uploaded successfully to WhatsApp without sending a message. New WhatsApp number +1 711-932-5514 (phone ID 1386258271239045, messaging account 2354617882025456) is connected, with a verified webhook and app subscription. Permanent token provisioned and verified; values remain outside source control. Backup, restore rehearsal, four production migrations and deployment were completed; see `RELEASE-VALIDATION-20261026.md`. First real inbound test reached the app but was rejected by the existing sender allowlist; owner-number authorization and a successful reply remain to be confirmed.
