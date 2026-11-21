# Operations and release gates

## Safety defaults

Keep READ_ONLY=true, META_WRITES_ENABLED=false, WHATSAPP_SEND_ENABLED=false and META_LEGACY_SINGLE_TENANT=false until the operator explicitly approves real effects. Setting one switch does not enable the other channels. MOCK_META_ENABLED must not be enabled in production. No deployment or external campaign/message action is part of this PR.

The active application is root index.js. src/ is a legacy implementation and is not a supported deployment entry point. npm start starts the web API and, by default, the message processing/delivery/retention loop. Set WHATSAPP_WORKER_IN_WEB=false and run npm run worker:messages in a separately approved worker service if independent scaling is required. Do not run the legacy worker.js against live accounts: it is mock-only.

## Configuration

Start from .env.example. Production startup validates required database, WhatsApp, OAuth, encryption and approval/deletion keys plus provider configuration before listening. Never put values in a PR, report or chat. Use three independent random secrets: a base64-encoded 32-byte Meta encryption key, a strong APPROVAL_HMAC_KEY, and a strong DELETION_HMAC_KEY. Keep these outside database backups and preserve the HMAC keys when changing token encryption keys.

DB_SSL=true validates the server certificate. If the provider needs a custom CA, supply DB_CA_CERT. A private-network plaintext connection requires explicit ALLOW_PRIVATE_DB_PLAINTEXT=true and DB_SSL=false; do not silently disable certificate verification. TRUST_PROXY_HOPS=1 is appropriate only behind the intended single trusted proxy. The Blueprint uses that setting for Render; direct local testing uses 0.

AI_PROVIDER defaults to gemini. Explicitly select verified GEMINI_MODEL and GEMINI_TRANSCRIBE_MODEL values for the connected account. Claude is an optional adapter using ANTHROPIC_API_KEY and CLAUDE_MODEL; voice transcription still uses Gemini and requires its configuration. Provider and Meta API mocks passing do not establish live model or account availability.

## Database upgrades and backups

Migrations are in migrations/ and execute transactionally under a PostgreSQL advisory lock. schema_migrations records checksums; never edit an applied migration. The baseline is idempotent for the prior schema. A unique partial index prevents multiple open briefs per client. Existing duplicate open briefs need operator reconciliation before deploying; do not discard them automatically.

Run npm run preflight with the intended environment before approving a release. It reads configuration, connectivity, pending migrations and duplicate open briefs without applying migrations or touching client records. Startup applies pending migrations; test them first on an isolated copy of the production database. Take a provider backup/export and perform a restore test on an isolated database before approving release. Neither a production backup nor restore test was performed in this task.

## Deploy and rollback procedure — requires separate approval

1. Confirm the existing Render resource, linked repository/branch and autoDeployTrigger=off. The prepared render.yaml matches the observed ai-campaign-manager service in oregon. It defines no paid databases or additional services. Do not blindly sync an unrelated resource name.
2. Inspect the Blueprint diff, database preflight and configuration. sync:false prompts only when creating a Blueprint; existing services need values saved separately without deploying. Omitted variables are not deleted by Blueprint sync. These behaviors were verified in the current Render documentation.
3. Confirm the backup/restore rehearsal and production data compatibility. Confirm approved privacy operator, contact, hosting and backup retention information. /privacy returns 503 until those values exist.
4. Deploy only the approved commit after explicit operator approval. Run a read-only role-authorized OAuth/account test first. /health returns 503 for missing database/configuration/required message worker heartbeat; /health/live checks process liveness. Inspect sanitized worker errors and MANUAL_REVIEW/UNKNOWN queues.
5. Roll back application code to a compatible prior successful deploy if startup/read-only checks fail. Do not automatically drop migrations or restore production over new writes. If a data restore is needed, stop writers and obtain a separate operator decision and backup validation.
6. Enable WhatsApp sends only after explicit approval and a controlled service-window/template test. Enable Meta writes only after permissions and separate live-test approval. Never infer these approvals from a green CI run.

## Recovery

WhatsApp events are persisted and deduplicated before webhook acknowledgment. Interrupted inbound processing moves to manual review instead of replay. Outbound messages are committed to an outbox; interrupted/timeout sends become UNKNOWN and are not retried automatically because Meta may have accepted them. Signed delivery receipts support SENT/DELIVERED/READ/FAILED and cannot regress a read message to sent. Approved template names require a configured allowlist plus the client's /notifications-on consent; free-form replies require an inbound message within 24 hours. No automatic template substitution is performed.

Meta executions claim an action once before external effects. A timeout, partial bundle creation or failed verification enters MANUAL_REVIEW and never automatically recreates objects. Inspect the target account and exact approved plan before any operator intervention. Full CREATE_BUNDLE produces a campaign, shared image creative, ad sets and ads in PAUSED. ACTIVATE_BUNDLE is a distinct approval that validates campaign/ad set/ad relationships and activates only the explicitly listed IDs. Existing images can be uploaded by UPLOAD_IMAGE with a tenant-owned unexpired media reference. Video upload/creative creation is not implemented; incoming video is accepted for review only.

## Privacy and retention

DATA_RETENTION_DAYS defaults to 90. Maintenance deletes old conversation rows, performance snapshots, delivery receipts, routine session audit rows and anonymous deletion receipts (the approvals/audit record is kept longer, see "Data retention" below), removes expired OAuth/rate-limit/media-reference rows, and scrubs stale queue content. Briefs, drafts, action records and business connection data persist until deletion. Successful/failed inbound events retain their dedupe IDs with payloads removed. A keyed phone digest remains after deletion to stop stale events recreating the client; re-enrollment needs an explicit operator process. Backups and provider-held copies require the operator's documented retention and deletion process. No claim of deleting all external copies is made.

## Current infrastructure inspection (2026-10-25)

The observed existing web service has auto-deploy off and follows audit-security-hardening-20261025, with an empty live healthCheckPath. The live service was not changed. A free PostgreSQL 18 instance is available in oregon and is scheduled to expire on 2026-11-24. Its current public network allowlist accepts all IP addresses. Before commercial use, the owner must choose a durable database/backup plan, test restoration, restrict public database access or use an approved private network configuration, and set the health check. None of these live infrastructure settings was mutated.

## WhatsApp graphics pilot
`GRAPHICS_ENABLED=true` enables explicit `/graphic <brief>` and Hebrew image requests. Set `GEMINI_IMAGE_MODEL=gemini-nano-banana-2.1` and `GRAPHICS_ATTEMPT_LIMIT=100`. A global persistent counter caps the pilot at 100 provider attempts, including failures. Generation requests are fixed to 1K with at most 2048 output tokens and minimal thinking. No automatic retry occurs after an uncertain generation/upload. Each tenant is also limited to three attempts/hour. Generated images become expiring tenant media, and image delivery requires the same open 24-hour reply window as text. Neither generation nor upload activates an advertisement. Google billing must be enabled separately; the operator authorized a $10 graphics pilot on 2026-10-25. Do not use this as authorization for other API spending, cloud upgrades, or advertising budgets.

**Ad text overlay (creativeOverlay.js).** The image model is always asked for a visual with no text at all. When a caller passes `imageText:{headline,cta,price}` to `graphicService.createGraphic` (the campaign package does this with its reviewed headline/CTA; a WhatsApp request with `כיתוב "..."` passes the quoted headline), the Hebrew text is drawn in code with `sharp` (libvips/Pango, correct RTL, numbers and ₪) using the bundled Heebo font (`@expo-google-fonts/heebo (full TTF)`, OFL-1.1), on a dark scrim with safe margins, plus the brand logo (portal brand settings, public https URL) in the top corner and the first brand color for the CTA. Default output is unchanged in shape: one 1080×1080 image returned as the media row. Pass `formats:['1:1','4:5','9:16']` to render 1080×1080, 1080×1350 and 1080×1920 from the same single generation (one monthly-limit attempt); the first format is the returned media and all are attached as `asset.formats[format]` (also on a deduplicated retry). In 9:16 no text is placed in the top 14% or bottom 25%. Without `imageText` and `formats` the provider image is stored untouched, as before. If the overlay fails (for example sharp cannot load), the text-free visual is used and `Creative overlay failed` is logged. A provider answer without an image logs `Graphic provider returned no image` with provider, model and finish reason (never the prompt); HTTP failures log `Graphic provider request failed` with status only. No new environment variable is needed; `sharp` ships prebuilt binaries and works with `npm ci --omit=dev --ignore-scripts`.

## Data retention (updated 2026-11-20)

| Data | Kept for | Notes |
|---|---|---|
| Conversation content (messages, support messages, agent task turns, queue payloads, receipts) | `DATA_RETENTION_DAYS` (90) | Deleted by `maintenance.js` every minute. |
| Routine session audit rows (`CONVERSATION_STATE`, `PORTAL_LOGIN`, `PORTAL_LINK`, `WORKSPACE_CONTENT`) | 90 days | They describe a session, not a decision. |
| Approvals/audit record (`tenant_audit` decisions such as `APPROVAL_CREATED`, `APPROVAL_CONSUMED`, `META_EXECUTION`, billing, retention notices; `approvals` rows) | `AUDIT_RETENTION_DAYS` (2557 = 7 years, allowed 365–3650) | Who approved what and when; event codes and ids only, no message text. Deleted with the customer on a deletion request (`ON DELETE CASCADE`). |
| Inactive marketing profile | 90 days without updates **and** 7+ days after a warning | See below. |

**Warning before deleting a marketing profile.** Once an hour `dataRetention.warnDue()` finds profiles that will reach 90 days of inactivity within 7 days, records `retention_notice_at`, writes a `RETENTION_NOTICE` audit row (`CHAT`, `TEMPLATE`, `UNREACHABLE` or `FAILED`) and messages the owner:

- inside the 24h WhatsApp window: a message with a **"שמרו את המידע שלי"** button;
- outside it: the approved template named in `DATA_RETENTION_TEMPLATE` (see `docs/WHATSAPP-TEMPLATES.md`); without a template the owner cannot be reached and the row says `UNREACHABLE`.

The profile is deleted only when it is older than 90 days **and** the warning is at least 7 days old, so the latest deletion is about 97 days after the last activity. The button, or writing "שמור את המידע שלי", resets the clock (`RETENTION_KEEP` audit row). Any profile update after the warning also cancels that deletion and a new warning is needed.

## Monitoring and alerts

A self-check runs inside the background jobs about every 5 minutes (`selfCheck.js`, off with `SELF_CHECK_ENABLED=false`):

- **database** – `SELECT 1`;
- **meta** – each connected business: expired or expiring (7 days) access from the database every run, and every 6 hours a live read of the selected ad account (revoked access, disabled/unpaid account);
- **whatsapp** – 3+ failed sends and none delivered in the last hour = failing (shows `disabled` while `WHATSAPP_SEND_ENABLED` is not `true`);
- **queues** – an incoming or outgoing WhatsApp message waiting 10+ minutes;
- **jobs** – the worker heartbeat is older than 5 minutes, or a background job (reports, campaign guard, daily advice, …) failed and has not succeeded for 30 minutes (`job_runs` table).

On a failure the support operators (`SUPPORT_OPERATOR_CLIENT_IDS`) get a plain-Hebrew WhatsApp note with what to do; it repeats at most every `OPS_ALERT_REPEAT_MINUTES` (360) and a single "back to normal" note follows the recovery. Free-text notes need the operator's 24h window: write anything to the bot once a day, or approve the `ops_alert` template and set `OPS_ALERT_TEMPLATE`. Every alert is also logged at `error` level in Render logs.

`GET /health` now includes `checks`: `{overall, checkedAt, database, meta, whatsapp, queues, jobs, inboundOldestSeconds, outboundOldestSeconds, heartbeatSeconds}` — statuses (`ok`/`warn`/`fail`/`disabled`/`unknown`) and ages only, never ids, phones or tokens. These checks are informational: they do not change the HTTP status, so a Meta or WhatsApp problem never makes Render restart the service. The HTTP status (200/503) still reflects database, configuration and worker heartbeat.

### External uptime monitor (free)

1. Create a free account at a monitoring service such as UptimeRobot (free plan: 50 monitors, 5-minute interval) or Better Stack.
2. Add an **HTTP(s) – Keyword** monitor for `https://<APP_PUBLIC_URL host>/health`, interval 5 minutes, alert when the keyword `"status":"ready"` is **missing** (this also catches a 503).
3. Optional second monitor on the same URL alerting when the keyword `"overall":"fail"` **exists** (Meta/WhatsApp/queue/job problems).
4. Alert contact: the founder's email or the monitoring app's phone notifications.

On the free web plan the service sleeps after 15 minutes without traffic and **background jobs stop while it sleeps** (reports, lead check-ins, alerts). A monitor calling `/health` every 5 minutes keeps it awake; a single free service running all month uses about 730 of Render's 750 free instance hours. The paid Starter plan removes sleeping (see below).

## AI cost per customer

Every AI call is written to `ai_usage` with its cost. The customer is taken from, in order: an explicit `clientId`, `usageLedger.forClient()`, the Meta tenant context. Work for no customer runs inside `usageLedger.system('<purpose>')` and is stored with `kind='system'` and that `purpose` (the model acceptance checks are `model_acceptance`). Anything else is stored as `system`/`unattributed` and logged once a minute, so a new unattributed path is visible.

Finding on 2026-11-20: ≈90% of AI rows had no customer. They were the model acceptance checks (`taskEvaluation.js`: ~15 calls per provider, rerun on every deploy because the cache key includes the commit), about $2–3 a day, mostly the Gemini run. They are now recorded as `system/model_acceptance`.

- Owner dashboard: `GET /app/api/usage` → this month's AI cost for the owner's own business, by kind, and the cap level when a cap is set.
- Operator: `GET /app/api/usage/operator` (only for `SUPPORT_OPERATOR_CLIENT_IDS`) → total, per customer with cap level, and system work by purpose.

**Monthly cap** – `AI_COST_CAP_USD_PER_CLIENT` (off when unset). By the customer's spend this calendar month (UTC):

| Spend | What happens |
|---|---|
| 80% | operator is told once; nothing changes for the customer |
| 100% | conversations use the cheaper model of the same provider (`AI_CAP_GEMINI_MODEL`=gemini-3.5-flash-lite, `AI_CAP_CLAUDE_MODEL`=claude-haiku-5-5), one image per request, no new videos; operator told |
| `AI_COST_CAP_BLOCK_RATIO` × cap (1.5) | no new images or videos until next month; operator told; the owner gets a friendly message |

Chat is never blocked, so the owner always gets an answer. Explicit model choices (the acceptance checks) are not changed.

## Separate background worker (prepared, not applied)

`RUN_BACKGROUND_JOBS_IN=worker` stops the web service from running background jobs; `npm run worker:messages` (`messageWorker.js`) then runs them, and refuses to start unless the same setting is present, so jobs never run twice by mistake. Default (`web`, or unset) is unchanged. The legacy `WHATSAPP_WORKER_IN_WEB=false` means the same as `worker`.

`deploy/render.paid.yaml` is a ready Blueprint with the web service on **Starter** (no sleeping) and a **Starter background worker**. **It requires the owner's approval because it is paid.** It is a separate file on purpose: changing `render.yaml` itself could be picked up by a Blueprint sync. To apply after approval: copy it over `render.yaml`, commit, and sync the Blueprint in Render (or make the same two changes by hand in the dashboard).

Prices (Render list prices, November 2026): web Starter $7/month, background worker Starter $7/month. The Postgres plan is already paid and unchanged.

- Option A (recommended first): web service to Starter only, jobs stay in the web service — **+$7/month (≈₪26)**.
- Option B: web Starter + separate worker — **+$14/month (≈₪52)**.

## Rollback to the previous deploy (one step)

Render keeps every successful deploy. To return to the previous one:

**Dashboard:** Render → service `ai-campaign-manager` → **Events** → find the previous successful deploy → **Rollback**.

**API (same thing):**

```bash
curl -X POST "https://api.render.com/v1/services/srv-dbe9q03rjlhs73evfii0/rollbacks" -H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" -d '{"deployId":"<previous dep-… id from the Events list>"}'
```

Notes: a rollback restores code only, not the database. Migrations run forward only; every migration so far is additive (new tables/columns, a wider CHECK), so older code keeps working on the newer schema — `042_infra_operations.sql` is in this category. Never restore a database backup over new data without a separate decision. Auto-deploy stays off; the next manual deploy replaces the rollback.
