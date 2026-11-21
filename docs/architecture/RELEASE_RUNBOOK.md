# Release runbook

This integration is not released. Existing production stays at add62da437fac1e508a7ef43568c3c9b626d80a8 until separately approved.

1. Review exact diff, authorization wording and CI commit.
2. Rehearse restore plus additive022/023/024 migrations in isolated PostgreSQL; preserve prior checksums. Review per-sender queue admission/claim ordering and drain old workers before validating the new claim path.
3. Review retention, deletion and owner-only scope. Both new feature flags default false.
4. Obtain approval for named production commit, migrations and any pilot flag changes.
5. Deploy only to the confirmed service/workspace; verify terminal deploy state, exact SHA, DB/worker and model readiness.
6. Use separately authorized test assets/recipient. Test text/voice/app continuity, paused creation, revoke and separate exact launch only when explicitly permitted. Do not inject synthetic production webhooks.
7. Record provider IDs/status, readback, cost and unknown-result reconciliation.
8. Disable new flags to stop scoped automation/new portal routing. Roll back compatible code without dropping additive schema/audit. Completed changes or spent media cannot be undone by a code rollback.

Remaining commercial gates: paid scope incomplete; Google/video credentials and test accounts absent; Meta/WhatsApp eligibility unresolved; free Render sleep and PostgreSQL expiry2026-11-24/backups need infrastructure review. No paid upgrade is automatic.
