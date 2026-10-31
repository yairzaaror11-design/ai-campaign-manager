# WhatsApp production repair — 2026-10-31

## Scope

Repair the existing production conversation, without enabling advertising writes, billing, new paid services, Google login or unrelated development migrations. Baseline: `bece3706379713d92372f302095364d3fa9c2c3f`. The separate development checkout and its pending features remain preserved.

- Parse native Gemini `audioTranscription` text/words as well as ordinary text; reject empty, oversized, blocked or truncated transcripts. Spoken requests pass through the same tenant router and approval gates.
- Route named account switches, search and account paging before onboarding/brief questions. Verify live permissions and account membership before selection. Ambiguous names show choices, never silently choose.
- Paginate eight accounts per page with previous/next controls (at most ten WhatsApp rows). Button payloads store exact account IDs; titles never authorize a choice. Context includes account IDs, selection, page and search. Expired controls are refreshed without executing them; reused controls remain rejected.
- Parse explicit ISO/day-month dates, rolling last 365 days, current/previous calendar year and existing common periods. Unknown periods require clarification. Pass `time_range` unchanged and reject invalid/future/excessive ranges. Check selection generation after report fetch before displaying or recording it.
- Suppress generic waiting messages for ordinary conversation, account checks, approvals and voice. Retain the explicit useful graphics/media acknowledgement. Add content-free processing latency logs and expose the deployed commit in health.
- Apply the dependency security patch and keep READ_ONLY enabled, Meta writes disabled and billing disabled.

## Acceptance and backup

`tests/whatsappReleaseAcceptance.test.js` defines twenty scenarios derived from the current owner's requirements. These are automated isolated acceptance tests, not claims of twenty live device tests. Existing suites additionally cover signatures, durable inbound deduplication, outbox replay protection, voice routing, tenant isolation and exact approvals.

Before release: a single read-only PostgreSQL transaction exported all 44 public tables at 2026-10-31T19:03:56.97913Z. The private archive is outside source control with directory 0700/file 0600. SHA-256: `8528cef3b955dd122cbc9c088f012b02d893656019a05b2b2e398c22a3678ade`. Restored all 622 rows into isolated PostgreSQL 18, verified all table values with typed timestamp normalization, and reapplied the same 14 migration checksums. Production writes: zero. The JSON archive requires the matching migration schema; it is not a provider-managed PITR backup. Live provider backups remain unavailable on the current free database plan.

No new migration is part of this repair. Preserve existing runtime secrets, encryption keys, WhatsApp phone/app and OAuth configuration. No campaign activation, budget change, external purchase, customer deletion or plan change is authorized by this release.

## Rollback

Keep Render auto-deploy off. Before triggering verify remote head equals the tested release commit. Inspect the returned deployment commit. If readiness, queue delivery or live conversation regresses, roll back to the retained successful deploy `dep-dbg528l9fdbs73cq59a0` (commit bece370) in Render. Confirm READ_ONLY=true and META_WRITES_ENABLED=false. No schema reversal or restoration over new production writes is needed or authorized. Recheck health, queue leases and webhook receipts after rollback; uncertain provider requests must not be replayed.

## Live evidence before release

The owner's voice message reached the existing webhook at 2026-10-31T18:11:25Z and produced `Empty transcription` at 18:11:28Z. The provider returned non-text `audioTranscription` parts that the old handler did not inspect. This is evidence of the bug, not a successful voice acceptance check. A new owner message after the tested deployment must verify the repaired path.

The current free web service can suspend when idle; an embedded worker cannot run while the service is suspended. Do not represent this plan as an always-on worker. No paid plan change is included.
