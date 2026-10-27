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

DATA_RETENTION_DAYS defaults to 90. Maintenance deletes old conversation rows, performance snapshots, delivery receipts, audit rows and anonymous deletion receipts, removes expired OAuth/rate-limit/media-reference rows, and scrubs stale queue content. Briefs, drafts, action records and business connection data persist until deletion. Successful/failed inbound events retain their dedupe IDs with payloads removed. A keyed phone digest remains after deletion to stop stale events recreating the client; re-enrollment needs an explicit operator process. Backups and provider-held copies require the operator's documented retention and deletion process. No claim of deleting all external copies is made.

## Current infrastructure inspection (2026-10-25)

The observed existing web service has auto-deploy off and follows audit-security-hardening-20261025, with an empty live healthCheckPath. The live service was not changed. A free PostgreSQL 18 instance is available in oregon and is scheduled to expire on 2026-11-24. Its current public network allowlist accepts all IP addresses. Before commercial use, the owner must choose a durable database/backup plan, test restoration, restrict public database access or use an approved private network configuration, and set the health check. None of these live infrastructure settings was mutated.

## WhatsApp graphics pilot
`GRAPHICS_ENABLED=true` enables explicit `/graphic <brief>` and Hebrew image requests. Set `GEMINI_IMAGE_MODEL=gemini-nano-banana-2.1` and `GRAPHICS_ATTEMPT_LIMIT=100`. A global persistent counter caps the pilot at 100 provider attempts, including failures. Generation requests are fixed to 1K with at most 2048 output tokens and minimal thinking. No automatic retry occurs after an uncertain generation/upload. Each tenant is also limited to three attempts/hour. Generated images become expiring tenant media, and image delivery requires the same open 24-hour reply window as text. Neither generation nor upload activates an advertisement. Google billing must be enabled separately; the operator authorized a $10 graphics pilot on 2026-10-25. Do not use this as authorization for other API spending, cloud upgrades, or advertising budgets.
