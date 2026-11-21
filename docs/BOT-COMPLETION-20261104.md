# Bot completion checkpoint — 2026-11-04

Production base: remote 604a2a564b5fc440d52d45c058f450710810830c, matching local tree e94715b1260e05665af138964ada33d0652ab823. This change selectively ports the durable task manager and approved lead-form executor into the current WhatsApp release; CRM and billing are outside this change.

Implemented: persistent outcome plans; missing-detail collection; owned media lookup; copy/image package review; approved Page lead-form creation; verified form attachment; paused campaign creation and separate activation; pause/cancel; uncertainty stops; human handover pause; bounded planning and graphics attempts. Graphics accept up to four tenant-owned reference images. Existing production conversation flows and one-time approval buttons are preserved.

Task manager rollout: TASK_AGENT_ENABLED=false, TASK_AGENT_PILOT_ONLY=true, TASK_AGENT_REQUIRE_EVAL=true. TASK_AGENT_EVALUATE_ON_START=true runs three synthetic planning probes per configured provider using server-held credentials; no Meta operations, client task rows or outbound messages. Only the selected provider passing the probes can satisfy the runtime gate. Passing these probes is not full end-to-end acceptance.

Validation: 283 tests passed, zero failed/skipped, including a fresh local PostgreSQL 18 database; syntax checks passed; npm production dependency audit found zero vulnerabilities. Provider calls in the regression suite are mocked. Production snapshot (44 tables, 748 rows) restored with exact typed rows in an isolated local database; eight sequences restored; the migration from 14 to 16 applied successfully. Backup contents remain private and outside the published release.

Still required: actual production model probe results; owner-device WhatsApp acceptance; granted Meta/Page access and a specifically approved pilot campaign; edits after existing writes; additional Ads Manager capabilities such as video/carousels/audiences; scheduled optimization; measured model cost and latency. The implementation does not expose every Ads Manager operation. Public rollout must not be represented as complete.

Infrastructure: free Render service can sleep; approved paid upgrade previously required a payment method. Database expiry and backup plan need a fresh infrastructure check before commercial launch. Billing remains disabled; CRM integration is deferred by owner instruction.
