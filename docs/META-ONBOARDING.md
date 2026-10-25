# Meta onboarding and permissions

Use an HTTPS test origin, separate test database and an app-role/tester ad account first. Production customer access is not established by the dashboard saying Ready for testing or Testing complete.

## Routes and credentials

- OAuth redirect: APP_PUBLIC_URL/auth/meta/callback
- Privacy policy: APP_PUBLIC_URL/privacy (503 until operator/contact/hosting/backup details are supplied)
- User instructions: APP_PUBLIC_URL/data-deletion
- Meta deletion callback: APP_PUBLIC_URL/meta/deletion
- Deauthorization callback: APP_PUBLIC_URL/meta/deauthorize

Use a Facebook Login for Business configuration with expiring user access tokens. Supply META_APP_ID, META_APP_SECRET, META_LOGIN_CONFIG_ID, APP_PUBLIC_URL and META_TOKEN_ENCRYPTION_KEY. ads_read is needed for reading; ads_management and the relevant Page permissions are needed for approved write/creative paths. Configure the minimum actual scope; the implementation additionally verifies ads_management before writing and Page membership before creating an image creative. Non-expiring/system-user token configurations are rejected by this onboarding path.

The authorization-code response is exchanged server-side. Hashed one-time state is bound to the browser's Secure, HttpOnly, SameSite=Lax cookie and originating client. No phone or client ID submitted from a browser is accepted as authentication. PKCE is not enabled without verified support for this Meta Login configuration; confidential client secret, state, cookie binding and exact redirect URI are enforced. Do not add unverified PKCE parameters or weaken state protection.

## Authorized chat journey

1. An allowlisted phone requests /meta-connect. The ten-minute personal invite appears in a URL fragment and is removed by the connection page before OAuth starts. Do not forward it.
2. The person approves Meta Login and returns to the authorized chat. /meta-accounts lists accessible accounts using cursor pagination (bounded to 20 pages); /meta-select act_ID validates membership and active status. Selection changes invalidate existing approval generations.
3. /brief TRAFFIC (or another supported brief workflow) gathers business, goal, audience, geography, budget and required assets. /brief-review and /brief-approve REVISION persist a local strategy draft. Natural-language requests use the AI read/propose layer and exact approval policy for real-write proposals.
4. Send an image to receive a one-day tenant media reference. The AI may propose UPLOAD_IMAGE, then CREATE_BUNDLE using the resulting image hash and an authorized Page. CREATE_BUNDLE includes exact per-ad-set audience, budget, currency and dates. With writes authorized/enabled, an explicit code approval creates only PAUSED objects. ACTIVATE_BUNDLE requires a new explicit approval naming all object IDs. The operator has not authorized these live actions in this task.
5. /report last_7d produces and stores a deterministic Meta performance summary. /meta-renew attempts the supported fb_exchange_token exchange for the same Meta user; expired/unsupported credentials require a fresh /meta-connect. There is no fabricated refresh token or promise of indefinite renewal.
6. /meta-disconnect deletes credentials and pending login links and invalidates approval generations. The Meta deauthorization callback performs local revocation. Meta-side consent can also be removed in Meta settings.
7. /meta-delete-data-confirm deletes the active tenant data, cancels outbox items, scrubs matching inbound payloads and records a keyed guard against recreation. The deletion command deliberately sends no post-deletion WhatsApp reply. Signed Meta deletion requests also work after disconnect because a user mapping is retained on the client until deletion. A random confirmation URL exposes only deletion status and expires under retention.

## Current Meta release requirements

Verify the exact app's requirements in the authenticated App Dashboard: App Review, the requested permissions' Advanced Access, Marketing API access tier, business verification and WhatsApp business/phone/template status. Role-authorized API tests are not commercial approval. Keep the app unpublished for development.

Official pages attempted during this task: Marketing API authorization, Facebook Login long-lived tokens, WhatsApp send-message guide and data-deletion callback documentation. These requests returned access errors/429 through the documentation tool, so current detailed commercial eligibility could not be verified from the official pages. The previously observed dashboard confirms test readiness only. The implementation must undergo a role-authorized live integration test and a review of the actual current dashboard requirements before commercial use; no live campaign/message or permission-grant action was performed.

See OPERATIONS.md for configuration, release and rollback gates and the known video/backup/production-validation limitations.
