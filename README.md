# Campaign Bachat — קמפיין בצ׳ט

Node.js/Express + Google Gemini + WhatsApp Cloud API + PostgreSQL.
The active application starts at root `index.js`. The `src/` tree and `DEPLOYMENT.md` are legacy Claude/Railway material.

Per-client Meta OAuth, encrypted credentials, account selection, disconnect and local campaign drafts are implemented for development testing. Tenant Meta writes are disabled. Keep `READ_ONLY=true`; the application is not commercially ready.

See [Meta onboarding and limitations](docs/META-ONBOARDING.md) and the unpublished [privacy draft](docs/PRIVACY-DRAFT.md).

```sh
npm ci
npm run check
npm test
```

Copy `.env.example` to a private environment file for local setup. Never commit tokens, encryption keys or app secrets. Do not deploy or publish the Meta app as part of this branch.
