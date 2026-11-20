# Task 2.1 — Tenant isolation results (in progress)

- Source-reviewed **24 distinct entry-point groups**, including portal HTTP endpoints, worker, reconciliation, lifecycle and client store. This is a partial review; it is **not** a complete repository-wide route count.
- New behavioral database-backed regression: `tests/workflowWorkerTenantIsolation.test.js` (one test). It constructs two clients, inserts a job under tenant A that targets a lifecycle owned by tenant B, runs the actual worker, and checks that the job is not leased and tenant B's lifecycle remains unchanged.
- Confirmed defect in `workflowWorker.js`: the original claim selected queued jobs without verifying `workflow_jobs.client_id = campaign_lifecycles.client_id`. A mismatched job could be leased and moved into reconciliation. Fixed by requiring a matching lifecycle owner **inside the transactional claim**.
- Existing portal HTTP integration test covers two sessions and tenant-separated leads; no claim is made that it covers all routes.
- CI for the new test is pending; do not mark the regression PASS until the exact commit's Actions log confirms it.
- Outstanding: complete repository inventory, two-tenant read/write/delete checks for workspace, media, Meta OAuth, billing, agent, webhook and background job/retry paths; full tenant identity provenance tracing.
- No production DB, external API, deploy, or protected branch changes.
