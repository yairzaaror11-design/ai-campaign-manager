# Campaign Bachat Dashboard

An RTL browser workspace on the existing Express application. It reads the same client identity, saved WhatsApp history, marketing memory, campaign lifecycles, approvals, audit log and performance snapshots as the bot.

## Local preview

```sh
npm ci --ignore-scripts
node scripts/preview-dashboard.js
```

Open http://127.0.0.1:4173/app/demo. This preview starts only the dashboard router: it does not initialize a database, start workers, send messages or call AI/Meta. Demo actions affect page memory only and reset on reload. The yellow banner remains visible. Example prices appear only in demo.

## Real data setup (isolated environment first)

1. Use an isolated copy of the existing PostgreSQL schema and an existing clients.id. Never treat a browser-supplied phone/client ID as identity.
2. The existing startup migration runner applies migration 009 transactionally. Review it before any release; do not apply it to production during development.
3. Configure DASHBOARD_ORIGIN as the exact browser origin, for example http://localhost:3000 for local development. Production must use HTTPS. APP_PUBLIC_URL is a fallback when both surfaces use the same origin.
4. Generate a random access token with at least 32 random bytes using an approved secret manager. Compute its SHA-256 hex digest. Keep the original token private and deliver it only to the verified owner of that existing client.
5. Set DASHBOARD_ACCOUNTS to a JSON array of `{ "clientId": "<existing ID>", "role": "owner", "tokenHash": "<64-character SHA-256 digest>" }`. Allowed roles: owner and viewer. Do not commit actual tokens or account configuration. With no configured accounts, real-data access is denied.
6. Run the existing server with its normal validated configuration and external effects disabled. Visit /app. Paste the private access token into the login screen. Do not use Meta credentials as a dashboard token.

Sessions last eight hours, are stored as hashes in PostgreSQL, and use HttpOnly/SameSite=Strict cookies (Secure in production). Logout deletes the session. Remove or rotate the configured digest to revoke all sessions for that credential. Role restrictions are enforced by the server. This initial provisioning flow does not implement self-registration, SSO, MFA or multiple-business switching.

## What works

- Overview: saved Meta spend/impressions/clicks, separate CRM lead count, pending approvals, source/timestamp labels and spend distribution by campaign.
- Optional manual Meta read synchronization for 7/30 days through the existing reportService and tenant context. One attempt/minute/client. No automatic provider requests occur when viewing or refreshing the dashboard. Live sync needs the existing verified Meta connection and account; it was not executed during development.
- Campaign snapshot list, name search, detail dialog and existing lifecycle summaries. A snapshot is not a live campaign-status check.
- CRM lead creation, contact validation, search/status filters, 50-row pages, lead details and seven status values.
- Tasks: title/due date, create, complete/reopen, newest 100.
- Same-client last 100 saved bot messages and marketing answers, ordered chronologically. Refresh reloads saved information; this is not streaming and does not expose the durable raw webhook inbox.
- Latest 50 audit events, stored Meta token expiry/account state, example billing view without checkout.
- Mobile menu with inert offscreen content, keyboard focus confinement, native accessible dialogs, reduced motion, skip link, labels and horizontal table scrolling.

Owner can create/update CRM records and request report reads; viewer can only read. Neither role gains campaign mutation permissions through these endpoints.

## API

All paths below use /app/api. JSON is returned with Cache-Control:no-store. For POST/PATCH requests send Content-Type:application/json, X-Dashboard-Request:1 and an Origin matching DASHBOARD_ORIGIN. The browser sends the session cookie; no client/tenant selector is accepted.

| Method/path | Purpose |
|---|---|
| POST /login | `{token}` exchanges a private access token for a session; 15 attempts/15 min/IP |
| POST /logout | Revoke current session |
| GET /me | Session role and client ID |
| GET /overview?period=last_7d | Matching-account cached report, CRM count, drafts, pending approvals, audit; also last_30d/last_90d |
| POST /sync | `{period}` read/snapshot from existing Meta report service; owner, 7/30 days, once/minute |
| GET /leads?q=&status=&offset= | items, hasMore; pages of 50 |
| POST /leads | `{name,phone?,email?,notes?}`; phone E.164; owner |
| PATCH /leads/:id | `{status}`; owner, tenant scoped |
| GET /tasks | Latest 100 tasks |
| POST /tasks | `{title,due_at?}`; ISO date; owner |
| PATCH /tasks/:id | `{status:"OPEN" or "DONE"}`; owner, tenant scoped |
| GET /conversation | Stored messages and public business answer fields |

Errors use `{code}` with 400/401/403/404/429/503. Internal/provider errors are replaced by DASHBOARD_UNAVAILABLE. Empty metrics are null, not fabricated zero. CRM lead dates are a rolling server-time window; Meta snapshot period is the provider's saved preset/account calendar. CPL is deliberately unavailable until attribution and calendar alignment are implemented.

## Verification

```sh
npm run check
npm test
git diff --check
```

API integration tests use PGlite and a loopback HTTP server. They cover account and tenant isolation, forged tenant input, read-only permissions, validation, CRM audit, shared WhatsApp history and business memory, snapshot account/period selection, missing metrics, mock Meta sync scope/throttling, session expiry/revocation/logout, CSRF origin checks and login throttling. Providers are mocked; no live external effects occur.

Browser checks: demo overview and campaign spend bars; navigate to CRM, add a sample lead and verify it appears; view shared chat/memory; mobile drawer and no page-wide horizontal overflow at a narrow viewport. Desktop and mobile screenshots are in docs/screenshots. Native dialogs support Esc and focus containment. Comprehensive WCAG compliance is not claimed.

## Remaining release work

Run external PostgreSQL integration/restore checks in a disposable environment, verify actual owner/client provisioning and role policy, review migration/privacy/retention, test live reads with authorized test credentials, and approve a release separately. Browser chat sending, browser campaign editing/approvals, live campaign status, daily analytics, team management, creative UI and real billing are outside this change. Keep these limitations visible in the product and review description.

Final local verification after integrating bot changes through 97a9c27: 144 tests, 142 passed, 0 failed, 2 external PostgreSQL checks skipped. The shared test fixture now routes cached store imports to the active PGlite instance, fixing use of a closed database when the newly added bot repair tests open a second fixture in the same process. Dashboard schema uses migration 009 to follow the bot repair migration 008.
