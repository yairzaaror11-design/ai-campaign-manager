# PostgreSQL backup, isolated restore and release readiness (2026-10-26)

## Verified read-only infrastructure
- Render web service: `srv-dbe9q03rjlhs73evfii0`, auto-deploy off, branch `audit-security-hardening-20261025`; currently deployed commit `0475317`.
- Render PostgreSQL 18: `dpg-dberhl8ae00c73e437j0-a`, free plan, expires 2026-11-24. Public network allowlist is `0.0.0.0/0`. No allowlist was changed.
- Existing public schema has `clients`, `conversation_messages`, `approvals`, `campaign_briefs`, `campaign_lifecycles`, `campaign_journal`, `action_plans`, `workflow_jobs`, `mock_meta_objects` and `telnyx_inbound_messages`. It does not yet have the new `schema_migrations` registry, OAuth tables or WhatsApp queues.
- Read-only counts of clients, conversation_messages, approvals and campaign_briefs were all zero at inspection time. These counts do not prove the whole database is empty or backed up.

## Migration assessment
1. `001_baseline.sql` uses `IF NOT EXISTS` for existing tables, adds tenant login tables and `clients.meta_generation`. **IF NOT EXISTS does not verify that existing table definitions match**. Compare columns, indexes, foreign keys and constraints on a restored copy before application startup.
2. `002_operations.sql` adds approval hashes, tenant audit, WhatsApp inbox/outbox, rate limits, media and performance tables. It updates `clients.meta_user_id` from `meta_connections`. The partial unique index on `campaign_briefs(client_id) WHERE status IN ('COLLECTING','REVIEW')` will fail if duplicate open briefs exist. Preflight checks this before migration; do not delete duplicates automatically.
3. `003_meta_app_scope.sql` adds nullable `app_id` to legacy tokens/secrets. Never backfill an app ID without reconnection/verification.
4. `004_graphic_jobs.sql` creates graphic job and global attempt-counter tables.
5. `migrate.js` wraps migrations in a transaction with an advisory lock and checksum registry. A failed migration should roll back transactionally. Rehearse on a restored isolated copy first; never edit already-applied migration files.

## Operator-run backup and restore rehearsal
**Not executed yet.** The GitHub connector and the Render read-only SQL tool cannot create a binary `pg_dump` archive or restore it. Use a trusted workstation/isolated runner with PostgreSQL 18 client tools (`pg_dump`, `pg_restore`, `psql`) and access to a separately provisioned empty local PostgreSQL database.

1. Provision an isolated PostgreSQL 18 instance on localhost and create an **empty** database named `campaign_bachat_restore_rehearsal`. Do not reuse the production database or its credentials as the restore target.
2. Set the following environment variables **privately** (never commit, print or paste credentials): `BACKUP_SOURCE_DATABASE_URL` for the source, `RESTORE_TARGET_DATABASE_URL` for the isolated local target, `BACKUP_ARCHIVE_PATH` for a new absolute file path, and `RESTORE_CONFIRMATION=RESTORE_TO_ISOLATED_LOCAL_DATABASE`.
3. Run `node scripts/backup-restore-rehearsal.js`. The script refuses non-local or non-empty targets, creates a custom-format archive, calculates SHA-256, restores into the isolated database with `--single-transaction` and `--exit-on-error`, and checks the restored schema has tables. It never drops a database. Archive retention and encryption remain operator decisions.
4. Record the archive SHA-256 and restored table count. Independently compare row counts, constraints and critical indexes against source read-only queries. Run `npm run preflight` using the **isolated** database and safe flags; then rehearse migrations on that isolated database and run integration tests. Do not treat successful archive creation alone as a verified restore.
5. Retain the backup securely with an explicit expiration policy. The free Render database expires on 2026-11-24; obtain an owner-approved durable replacement or backup destination before then.

## Network access hardening plan
- Map every real connection path: Render web service to PostgreSQL, approved maintenance workstation, backup runner and any separately authorized workers. Confirm private-network connectivity from service to database and required external administrative access.
- Only after successful restore rehearsal, replace `0.0.0.0/0` with the minimal required CIDRs or approved private-only access. Validate from every dependent service and prepare a tested rollback of the previous allowlist. **No network change is authorized or performed by this document.**
- Do not silently set `DB_SSL=false` or disable certificate verification. Review the application `DATABASE_URL`, `DB_SSL` and CA trust settings before a controlled change.

## Configuration and integration gates
- Active Render service has build command `npm install`, no health-check path and live commit `0475317`. Proposed `render.yaml` uses `npm ci --omit=dev --ignore-scripts`, `/health`, branch `audit-security-hardening-20261025` and `autoDeployTrigger: off`. Blueprint settings are **not yet applied**.
- `docs/LIVE-VALIDATION.md` records an ads_read-only Meta Login Configuration `1893382361625002`, while `render.yaml` has `1547508470739287`. Compare each ID's parent app, permissions, login variant and OAuth redirect URI directly in Meta before selecting one; do not change production on inference.
- Gemini generation previously returned HTTP 503. Run the isolated `scripts/live-readiness.js` probe with private credentials from an approved secure runner; it must report actual model, HTTP status and structured-response result. No live success is claimed.
- WhatsApp production phone is registered but a permanent token requires owner SMS verification in Meta. Read-only phone access can be probed after token provisioning. Do not send messages without separate approval.

## Deployment and rollback (requires explicit owner approval)
1. Complete a real backup and isolated restore; reconcile schema/duplicate briefs, run migrations on the restored copy and pass CI.
2. Confirm all required runtime secrets and privacy/backup retention configuration without exposing values; confirm Render branch, auto-deploy off, health path, provider limits and read-only safety switches.
3. Verify OAuth config, provider permissions and at least one successful Gemini generation; separately verify WhatsApp phone access.
4. Obtain explicit deployment approval for a precise commit. Deploy only with `READ_ONLY=true`, `META_WRITES_ENABLED=false`, `WHATSAPP_SEND_ENABLED=false`. Review database migration effects before deployment because startup applies migrations.
5. Verify `/health`, worker heartbeat, queue status, tenant OAuth/account reads and logs. If unsuccessful, roll back application code to the last compatible deployed commit. **Do not assume database migrations are reversible**; stop writers and require an explicit decision before any data restoration.
6. Obtain separate approvals for live WhatsApp messages, creation of real PAUSED campaigns, and campaign activation. Never infer them from deployment approval.

## Current gate decision
**NOT READY.** No production settings, customer data, ad accounts, messages or deployment were changed in preparing this document.
