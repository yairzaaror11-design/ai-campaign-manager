# Agent and dashboard context

Implemented locally on 2026-10-26. Reference: https://chatgpt.com/share/6adf8e5b-edf4-83eb-8305-fb721d8520f3 . The shared conversation supplies product context; uploaded screenshots and the linked Word attachment were not inspected here.

| Area | Current connection | Remaining work |
| --- | --- | --- |
| Business and brand | Shared marketing facts; logo and palette available as agent context | Verify generated media follows the palette and selected logo |
| Product catalog | Fresh tenant-scoped read tool; catalog context supplied to dashboard free replies | Explicit selection of the promoted catalog product; do not select silently |
| Content | Saved drafts available to the agent | Reviewable draft creation/editing from conversation; publishing remains separate |
| Tasks | Current titles, dates, notes and status available | Reviewable task creation/editing from conversation |
| Expenses | Recorded amounts and currency available with minor-unit explanation | Verified financial aggregation; no inference of ad attribution |
| Dashboard agent | Existing journey handles structured steps; free responses use configured AI, recent chat and current screen | Live conversational QA and shared channel history policy |
| WhatsApp agent | Read-only workspace tool available to Gemini and Claude | Live scenarios involving dashboard edits followed by WhatsApp questions |
| Calendar, team inbox and automation builder | Unimplemented capabilities explicitly identified in dashboard context | Separate feature implementation and API integrations |

## Runtime behavior

The portal adapter interprets a message and prepares its reply before acquiring profile write locks. It checks the profile version before saving the conversation, so a parallel edit cannot be overwritten by a delayed AI response. Existing request fingerprints provide replay protection. Free responses use planning mode: built-in providers receive no tools and reject unexpected tool calls. The common AI service rejects returned action plans in this mode. Structured navigation actions stay available alongside free replies.

Workspace data are fetched using the authenticated client ID, never a supplied tenant ID. Context has record and text limits with `hasMore` markers; it is a bounded view, not a complete ledger. All record text remains untrusted data. Model unavailability produces a recoverable message rather than a claim of completed work. This change does not deploy or call external executors.

## Validation

`npm run check` and the focused 37-test set passed, including fresh data after edits, tenant isolation, missing tenant rejection, replay, concurrent profile updates, provider tool rejection, existing journey behavior and provider safety. Full `npm test` run: 170 passed, 2 skipped, 0 failed (172 tests); HTTP tests ran with local server access. No live model-quality or production verification was performed.
