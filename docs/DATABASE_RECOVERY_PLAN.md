# Database recovery plan — Task 2 (2026-10-27)

## Read-only production inventory
PostgreSQL 18.6, database campaign_bachat, 44 public tables. All 44 names inspected:

action_plans, api_rate_limits, approvals, billing_checkouts, billing_events, billing_invoices, billing_subscription_state, campaign_briefs, campaign_journal, campaign_lifecycles, campaign_local_drafts, clients, conversation_messages, crm_leads, customer_accounts, customer_subscriptions, deleted_client_guards, deletion_receipts, graphic_jobs, graphic_usage_counters, landing_pages, marketing_profiles, meta_ads_knowledge, meta_connections, meta_execution_attempts, meta_login_secrets, mock_meta_objects, performance_snapshots, portal_login_tickets, portal_sessions, schema_migrations, social_connections, social_oauth_states, telnyx_inbound_messages, tenant_audit, tenant_media, whatsapp_contacts, whatsapp_inbound_events, whatsapp_outbox, whatsapp_receipts, worker_heartbeats, workflow_jobs, workspace_items, workspace_requests.

## Relationships and tenant scoping
Foreign-key metadata confirms client_id -> clients.id on many tenant-owned tables, plus action_id and lifecycle_id relationships. Other tables have no such FK, so application-level tenancy cannot be assumed. All 44 have rowsecurity=false.

## Migration order
schema_migrations lists all 001_baseline.sql through 014_marketing_research.sql, applied in ascending sequence. migrate.js sorts migration filenames, hashes each SQL, verifies checksum and serializes migration transactions with pg_advisory_xact_lock. Historical dashboard branch uses a conflicting 009_dashboard.sql; NEVER run it over current production migration sequence.

## Recovery rehearsal (not executed)
Existing scripts/backup-restore-rehearsal.js requires explicit RESTORE_TO_ISOLATED_LOCAL_DATABASE confirmation, a target on localhost/127.0.0.1/::1 named campaign_bachat_restore_*, an empty existing target, and a new absolute archive path. It runs pg_dump custom format and pg_restore with --single-transaction; checks table count and SHA-256. Before any rehearsal: provision isolated Postgres, ensure dump credentials read-only where feasible, mask personal data, restrict artifact permissions, and test version compatibility. No backup was downloaded or restore performed in this task.

## Availability deadline
Render free DB expires **2026-11-24 08:07:49 UTC**. Before that date: confirm backup retention and export capability, schedule isolated restore rehearsal, select compliant paid or alternate DB hosting with user authorization, validate cutover and rollback. No plan purchased and no network change made.

## Production readiness
NOT ready to certify commercial-grade protection: restore success, retention policy, runtime role least privilege, enforced TLS and tenant isolation remain unverified or insufficient.

## Task 2.1: least-privilege role separation (code prepared, production unchanged)

db.js now supports `RUN_MIGRATIONS_ON_STARTUP=false`. This is **opt-in**: default startup still runs migrations. Do not set it until a separate migration job and credentials are operational. Proposed accounts:

| Role | Needed | Prohibited |
|---|---|---|
| Runtime | CONNECT, USAGE on application schema, SELECT/INSERT/UPDATE/DELETE on required tables, USAGE/SELECT on sequences | CREATEDB, CREATEROLE, schema DDL, TRUNCATE, broad default grants |
| Migration | CREATE/ALTER schema objects and schema_migrations updates; advisory transaction locks | Superuser, production backup exports |
| Backup | CONNECT, USAGE, SELECT on backed-up tables/sequences; appropriate pg_dump privileges | INSERT/UPDATE/DELETE, DDL, role management |

Before implementing in isolated PostgreSQL, enumerate every SQL statement from app/worker and validate all required grants, ownership, default privileges, sequence grants and migration version checks. Apply no role changes to production in task 2.1.

## Task 2.1: restore safety fix

The rehearsal validator now treats localhost, 127.0.0.1 and ::1 aliases with matching effective port and database name as the **same target**, rejecting a destructive source-equals-target case before any subprocess executes. Regression test added. No real customer data copied; no restore executed.
