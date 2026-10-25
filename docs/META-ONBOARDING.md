# Meta client onboarding — development only

The active entry point is root index.js (Express, Gemini and PostgreSQL). src/ and the old Railway/Claude instructions describe the previous architecture. Keep READ_ONLY=true. Do not deploy or publish Meta as part of this change.

## Configuration

Use a separate test database and HTTPS development origin. Supply APP_PUBLIC_URL (origin only), META_APP_ID, META_APP_SECRET, META_LOGIN_CONFIG_ID and META_TOKEN_ENCRYPTION_KEY (base64 encoding of 32 random bytes). Keep the encryption key outside the database, back it up separately, and do not replace it while encrypted connections exist: key rotation/migration is still pending.

Create a Facebook Login for Business configuration using expiring **user** access tokens with ads_read. System-user/non-expiring tokens are deliberately rejected. Register exactly APP_PUBLIC_URL/auth/meta/callback as the Valid OAuth Redirect URI. Never put secrets in redirect URIs. The app can remain unpublished; use an authorized app role/tester and an ad account they may access. Verify current requirements in Meta before changing any dashboard settings.

## Test journey

1. From an already authorized WhatsApp sender, request /meta-connect. No public endpoint accepts a phone/client ID as proof of identity.
2. Open the personal link within ten minutes. It contains a bearer invite in the URL fragment, removed before starting OAuth. Do not forward it. Invite and state hashes are stored, not raw secrets. The state is consumed atomically and bound to an HttpOnly Secure SameSite=Lax cookie.
3. Approve Meta login. Return to chat and use /meta-accounts, then /meta-select act_ID. The selection must be in Meta's account list and active. This first version shows up to 100 accounts; pagination is a follow-up.
4. Start /brief TRAFFIC (or another supported workflow), complete the questions, /brief-review, then /brief-approve REVISION. A local draft and strategy are saved for the linked real ad account. This is not a Meta campaign, ad set, ad creative or ad. There is no publication/billing path for tenant connections.
5. /meta-disconnect removes credentials and pending login links and cancels pending action approvals. A callback already in flight cannot restore a disconnected connection. Removing the app in Meta settings revokes Meta-side consent.
6. /meta-delete-data-confirm deletes the client's active relational data. POST /meta/deletion accepts a recent HMAC-SHA256 Meta signed_request and synchronously deletes clients matching an active connection's Meta user ID. It returns Meta's confirmation response. After disconnection, use chat deletion: the local Meta user mapping no longer exists. The status URL /data-deletion explains synchronous completion; no per-request status registry is retained.

## Isolation and limitations

WhatsApp processing runs in an AsyncLocalStorage tenant context. Every Meta read loads that client's unexpired encrypted credentials, checks selected account IDs and checks campaign account ownership. It never falls back to the server token. Tenant writes remain blocked even if READ_ONLY is accidentally disabled. Old standalone integration calls also fail closed unless META_LEGACY_SINGLE_TENANT=true is explicitly set; do not enable that switch for a multi-client deployment.

Tokens use AES-256-GCM with the client ID as authenticated associated data. Meta errors are sanitized; token and code responses are never logged. HTTP access logs record only paths. Enforce the same query-string redaction in reverse proxies and hosting logs. Expiry requires a fresh login; automatic refresh is not implemented. No in-memory OAuth credential fallback exists.

Commercial readiness remains blocked on: real Meta role/account OAuth verification, hosted identity/user interface beyond authorized chat, tenant-aware live write adapters and independent publication approval, full deletion/retention of WhatsApp queue payloads, media, logs and backups, privacy operator/contact/provider details, token key rotation, rate limiting and expired-secret cleanup. Existing mock workers can simulate activation; keep MOCK_META_ENABLED unset for this journey. The privacy document is an unpublished draft, not a deployed policy.

## Verification

npm run check and npm test. metaConnection.test.js runs the schema and lifecycle against embedded PostgreSQL (PGlite), while mocking Meta HTTP. Existing TEST_DATABASE_URL integration tests require a separate external PostgreSQL instance and otherwise skip. No external Meta or WhatsApp call is performed by the new test.
