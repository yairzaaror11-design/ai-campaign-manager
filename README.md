# Campaign Bachat — קמפיין בצ׳ט

WhatsApp-driven Meta campaign management using Node.js/Express, PostgreSQL and a configurable Gemini/Claude service. The active entry point is root `index.js`; `src/` and the old Railway deployment guide are legacy.

Implemented: per-client Meta OAuth and encrypted credentials; account-scoped reads/reports; secure media and voice input; persisted inbound and outbound WhatsApp queues; tenant-bound, versioned, one-time approvals; image upload and PAUSED full campaign creation; separately approved activation and budget/status changes; data deletion/retention; transactional migrations; readiness checks and graceful shutdown.

All real effects remain disabled by default: `READ_ONLY=true`, `META_WRITES_ENABLED=false`, `WHATSAPP_SEND_ENABLED=false`. Mock/API tests passing do not establish commercial or production readiness.

```sh
npm ci --ignore-scripts
npm run check
npm test
```

- [Meta setup and chat commands](docs/META-ONBOARDING.md)
- [Operations, backups, release and rollback](docs/OPERATIONS.md)
- [Security review and remaining gates](docs/SECURITY-REVIEW.md)

Copy `.env.example` into a private environment file for development. Production startup validates required configuration. `npm run preflight` performs read-only checks against a configured target database. `npm run worker:messages` starts a separate message worker when the embedded worker is disabled.

No production deploy, Meta app publication, real campaign mutation, budget change or WhatsApp message is authorized by this branch alone.
