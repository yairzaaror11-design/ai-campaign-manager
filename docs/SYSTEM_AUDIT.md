# System audit — 2026-10-27

Scope: read-only inspection of GitHub and Render. No live provider calls, deployments, migrations or production writes. Base commit: bece3706379713d92372f302095364d3fa9c2c3f.

## Verified
- Repository public; default main is older/minimal compared with development branch.
- 12 branches observed, 5 open PRs observed (PRs #1, #4, #5, #7, #8).
- Base branch includes Express backend, portal UI, conversation modules, Gemini and Claude modules, Meta/WhatsApp integrations, CRM, billing, reporting, marketing, graphics, worker and tests.
- Main contains a separate src/ implementation; inspect for duplication before consolidation.
- Production Render service uses audit-security-hardening-20261025, live deploy commit bece3706379713d92372f302095364d3fa9c2c3f.
- No end-to-end paid-provider or customer-device test performed in this audit.

## Evidence / limitations
GitHub tree API, Render service/deploy API, PostgreSQL read-only metadata. File presence is not operational proof. Full call graph, route-by-route authorization, dead code, button click testing and live provider verification remain unverified.

## Risks
Database free-plan expiry 2026-11-24; public IP allowlist on DB; production backup restore not independently proven; multiple divergent frontend branches; avoid accidental Meta writes.

## Next audit gates
Inventory every Express route and portal action; cross-check tenant guards, mocks, worker ownership, migration ordering, CI results and live integration credentials without reading secret values.
