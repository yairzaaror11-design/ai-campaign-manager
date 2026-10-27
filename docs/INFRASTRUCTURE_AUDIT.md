# Infrastructure audit

Audit time: 2026-10-27; Render and database checks were read-only. Secret values and customer-level content were not queried.

## Render service

| Item | Observed |
|---|---|
| Workspace | My Workspace |
| Service | `ai-campaign-manager` (`srv-dbe9q03rjlhs73evfii0`) |
| Type/region/plan | Node web service, Oregon, Free, 1 instance |
| Repository branch | `audit-security-hardening-20261025` |
| Build/start | `npm ci --omit=dev --ignore-scripts`; `npm start` |
| Auto deploy | `autoDeploy=no`; trigger `off` |
| PR previews | Off |
| Health path | `/health` |
| Latest live deploy | `dep-dbg528l9fdbs73cq59a0`; commit `bece3706379713d92372f302095364d3fa9c2c3f`; succeeded 2026-10-27 07:22:48 UTC |
| Service status | Not suspended; Render reports latest deployment successful |

### Direct readiness check

A read-only HTTP GET to `https://ai-campaign-manager.onrender.com/health` returned:

```json
{"status":"ready","database":true,"configuration":true,"worker":true,"readOnly":true,"metaWritesEnabled":false,"whatsappSendsEnabled":true}
```

The endpoint completed on 2026-10-27 10:45 UTC. This establishes app readiness and the app's own readiness flags at that time. It does not prove Meta OAuth or WhatsApp delivery success. No outbound WhatsApp message, Meta read/write, or paid API request was made.

### Runtime configuration mismatch

Live readiness reports `whatsappSendsEnabled=true`. Checked-in `render.yaml` for the deployed branch sets `WHATSAPP_SEND_ENABLED: "false"`. Render's current live environment-variable values are not available through the read-only connector; the health response is the non-secret runtime evidence. This drift needs an owner decision and reconciliation before test-customer onboarding. Meta writes remain false and READ_ONLY true. Avoid assuming the README's default safety statement matches the live runtime.

Render logs returned recent repeated GET `/health` entries and no 5xx request-log matches in the queried seven-day range. The service event list shows the latest build and deploy succeeded and includes an earlier `update_failed` event on 2026-10-26; it is not the latest deployment. Metrics lookup for instance count, CPU, memory and request counts returned empty series, so capacity/usage cannot be asserted from that query. No dedicated Render worker service was listed; `WHATSAPP_WORKER_IN_WEB` is true in the Blueprint and live readiness `worker=true`, consistent with the embedded worker.

## PostgreSQL

| Item | Observed |
|---|---|
| Instance | `campaign-bachat-db` (id omitted from this report) |
| Database engine | PostgreSQL 18.6 |
| Plan/status | Free / available |
| Expiry | 2026-11-24 08:07:49 UTC |
| Region | Oregon |
| HA/read replicas | Disabled / none |
| Connection pool | None reported |
| Network allowlist | `0.0.0.0/0` |
| Live connection check | Read-only query succeeded at 2026-10-27 10:43 UTC |
| Migrations | 14 entries, `001_baseline.sql` through `014_marketing_research.sql` |
| Public tables | 44, read from `information_schema` |

The live schema includes `clients`, `conversation_messages`, `campaign_briefs`, `campaign_lifecycles`, `action_plans`, `approvals`, `meta_connections`, `whatsapp_inbound_events`, `whatsapp_outbox`, `whatsapp_receipts`, `worker_heartbeats`, `crm_leads`, `customer_accounts`, `customer_subscriptions`, `billing_events`, `billing_invoices`, `graphic_jobs`, `tenant_media`, `social_connections`, `landing_pages`, `performance_snapshots`, `workspace_items`, `tenant_audit`, and associated state/guard tables. All 44 names are available via `information_schema`; the live count confirms migrations have been applied but not semantic correctness of every constraint.

Read-only aggregate queries found 2 client rows, 0 Meta token rows, 0 social connection rows, and 0 subscription rows. Only aggregates were retrieved; no client content or token value was read.

## Backup and recovery

Repository documentation (`docs/RELEASE-VALIDATION-20261026.md`) states an archive was created from a consistent snapshot, source row checksums were matched after extraction/restore into PGlite PostgreSQL 18.6, and four migrations were rehearsed idempotently before production migration. This is useful historical evidence, but it is not a current independent restore test to a separately hosted PostgreSQL 18 target. The archive is described as outside the repository/private local output; its current availability, retention, encryption and restore access were not checked. Render connector exposes no backup listing or restore action. Therefore:

- **Historical archive/rehearsal:** documented as performed.
- **Current backup existence/retention:** not independently verified.
- **Successful full hosted PostgreSQL 18 restore:** not verified.
- **Automated backup/PITR on current Free plan:** not verified; do not assume it exists.

## Urgent operational actions for a later task

1. Select a durable PostgreSQL plan/provider before 2026-11-24; preserve the current data and rehearse migration/restore on an isolated copy.
2. Replace the all-address database allowlist with the narrowest supported private/service access or explicit operator addresses, after confirming connectivity and rollback.
3. Decide whether WhatsApp sending should be enabled. Align live configuration, `render.yaml`, docs and the controlled test plan.
4. Verify backup schedule, encryption, retention and a PostgreSQL 18 restore with checksums; record evidence without credentials.
5. Add actionable error/latency/worker/queue/backlog alerts; current metrics API query returned no data.
6. Review CI's `contents: write` permission and lockfile auto-push behavior; keep deployment approval separate from CI success.

No infrastructure configuration was changed in this audit.
