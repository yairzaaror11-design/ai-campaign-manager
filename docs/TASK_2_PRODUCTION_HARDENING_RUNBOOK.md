# Task 2.1: production PostgreSQL hardening runbook (NOT EXECUTED)

This runbook is preparation only. Production changes require explicit approval and a verified restore rehearsal using authorized backups.

## Prerequisites
1. Resolve Render Free PostgreSQL expiry **2026-11-24** with an approved durable plan. Confirm backup retention and restoration capability before any cutover.
2. Inventory current roles, grants, ownership, schema migrations, extensions, connection pool settings and active sessions. Never print connection strings or credentials.
3. Verify the application can run against an isolated clone with least-privilege runtime credentials. Test workers, WhatsApp ingestion, Meta approval reads/writes, dashboard APIs, and migration process separately.
4. Verify a recent encrypted backup and a full restore into an isolated database. Record table counts and checksums.

## Controlled rollout, subject to separate approval
1. Create distinct migration-owner, application-runtime, and read-only backup roles in a controlled maintenance window. The migration role owns application schema objects and can run approved migrations; the runtime role receives only necessary table/sequence DML and schema USAGE; the backup role receives SELECT and necessary sequence/schema visibility. Avoid CREATEDB/CREATEROLE for runtime.
2. Test migration scripts and their ordering against a staging clone using the migration role. Compare against all existing 001–014 migrations and colliding branch numbering before introducing any new migration.
3. Configure a separate runtime connection in staging; verify login, tenant-scoped queries, workers, write permissions and pool reconnect behavior. Validate the old credential remains available for rollback.
4. Change the production runtime credential only after passing staging and with explicit deployment authorization. Monitor error rates, denied queries, queue health, and connection pools. Do not revoke old grants before confirming successful operation.
5. Narrow public network allowlist only after verifying actual egress IPs, maintenance access, and backup/restore routes. Prefer private networking when supported.
6. Evaluate RLS per tenant-owned table: define trusted tenant session context, FORCE RLS/owner bypass considerations, background worker identity, migrations and connection pooling semantics. Enable first in isolated staging with two-tenant adversarial tests; no blanket production RLS switch.

## Rollback
- Stop rollout, restore prior authorized runtime connection credentials and grants, restart pools safely, and verify read/write and worker health.
- Revert staged network allowlist changes only if required to restore service, while keeping the smallest safe access scope.
- If a schema change caused data inconsistency, stop writes and restore from a verified backup according to the approved recovery plan; do not improvise destructive rollback.
- Never disable security controls silently.

## Remaining blockers
- Production privileges, network allowlist, migration ownership, actual staging clone and a verified customer-data backup have not been changed or validated by this task.
- The isolated CI role test validates a synthetic schema only, not all 44 production tables or worker access paths.
- Production RLS requires a separate schema-by-schema compatibility review and authorization.
