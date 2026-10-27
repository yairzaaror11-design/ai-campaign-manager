# Infrastructure audit — 2026-10-27

## Render (read-only verified)
- Workspace: My Workspace; service ai-campaign-manager (srv-dbe9q03rjlhs73evfii0).
- Service branch audit-security-hardening-20261025; autoDeploy=no; autoDeployTrigger=off; PR previews off.
- Service plan free, runtime Node, region Oregon, one web instance, health check /health; not suspended.
- Latest live deploy dep-dbg528l9fdbs73cq59a0, commit bece3706379713d92372f302095364d3fa9c2c3f, finished 2026-10-27 07:22:48 UTC.
- Sample logs show /health requests and process startup; sample is not a full incident audit. Worker process presence not verified.

## PostgreSQL (read-only verified)
- Database campaign_bachat, Postgres 18.6, status available, 44 public tables by information_schema count.
- Free plan, expires 2026-11-24 08:07:49 UTC. No high availability or read replicas; no connection pool configured.
- IP allowlist 0.0.0.0/0: assess network exposure and credentials controls urgently.
- Backup and restore success **not verified**; repository contains scripts/backup-restore-rehearsal.js and docs/DB-RESTORE-RELEASE-PLAN.md.

## Release gates
1. Resolve free database expiry and backup retention.
2. Prove restorable backup in isolated environment, never production.
3. Inspect logs/errors and actual worker scheduling.
4. Validate security of external DB connectivity and least-privilege accounts.
5. Confirm service /health semantics and monitor alerts.

No production settings were changed.
