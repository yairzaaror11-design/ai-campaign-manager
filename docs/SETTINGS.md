# Profile settings and launch preparation

The Settings navigation item and `/app/settings` route implement the supplied reference: support, profile/photo, language, Meta Ads, API keys and six social-account rows. Demo: `/app/demo#settings`. Real data remains tenant-scoped and requires the existing dashboard session.

## Profile and language

Migration 010 adds dashboard_profiles, dashboard_api_keys, social_connections and social_oauth_states. It does not rename/drop existing tables. Tenant deletion cascades remove these records.

Owners can update their profile name and preferred locale using optimistic revision checks. The profile name is independent from the WhatsApp contact/business name, so the next inbound message cannot overwrite a profile edit. Email is read-only, supplied from the administrator-verified optional `email` field on the existing DASHBOARD_ACCOUNTS entry. A missing email is shown as unavailable; it is never invented from a phone number.

PNG/JPEG/GIF input is capped at 5MB, decoded with Sharp with a 16-megapixel input limit, resized to at most 512×512 and re-encoded as PNG without source metadata. Animated GIFs use their first frame. No original filename or remote image URL is stored. Avatars are served only through the authenticated tenant-scoped route with no-store and nosniff.

Hebrew, English, Spanish, German, French and Portuguese are persisted. Settings copy and navigation labels are translated; Hebrew uses RTL, the other locales LTR. Business data and conversations remain in their original language. The other application screens still contain Hebrew UI copy; this is not full product localization.

## Support

Set SUPPORT_CONTACT_EMAIL to the operator's approved support email. PRIVACY_CONTACT_EMAIL is a fallback. The button opens a mail composer; it does not send automatically. Without a configured address, the UI says support setup is required.

## API keys

Owners can issue up to ten active read-only keys, valid for 90 days, with `overview:read` and/or `leads:read`. Keys contain 32 random bytes, are revealed once, are stored only as SHA-256 digests and masked prefixes, and can be revoked immediately. Token values are not written to logs/audit, browser storage or key-list responses. API keys cannot authenticate dashboard/settings routes.

Use `Authorization: Bearer <key>` at:

- GET /api/v1/overview?period=last_7d (also last_30d/last_90d), overview:read.
- GET /api/v1/leads?offset=0, leads:read, 50 rows/page.

Both derive the tenant exclusively from the key. Limit: 60 requests/key/minute. Keys cannot send messages, mutate campaigns, write leads or change settings. Key creation/revocation requires an owner session and same-origin request protection.

## Meta Ads

The settings button requests a new tenant-bound invite from the existing metaConnection service; its existing browser/state binding, callback, token encryption and permission checks remain authoritative. Account listing/selection reuses server-verified accounts and selectAccount. No ad is created or activated by connecting.

## Social authorization

All six rows have real server-side OAuth adapters behind configuration. Without configuration, the UI opens an explicit setup explanation and never shows a successful connection. No external provider was contacted during automated testing.

Set APP_PUBLIC_URL to the real HTTPS application origin, DASHBOARD_ORIGIN to the same origin, and keep the existing base64 32-byte META_TOKEN_ENCRYPTION_KEY available server-side. Each provider needs its own approved application/product/scopes, credentials and this exact registered callback:

`https://<application-host>/auth/social/callback/<provider>`

| Provider | Server environment variables | Requested scopes |
|---|---|---|
| facebook | SOCIAL_FACEBOOK_CLIENT_ID / SOCIAL_FACEBOOK_CLIENT_SECRET | pages_show_list, pages_read_engagement, pages_manage_posts |
| instagram | SOCIAL_INSTAGRAM_CLIENT_ID / SOCIAL_INSTAGRAM_CLIENT_SECRET | pages_show_list, pages_read_engagement, instagram_basic, instagram_content_publish |
| linkedin | SOCIAL_LINKEDIN_CLIENT_ID / SOCIAL_LINKEDIN_CLIENT_SECRET | openid, profile, w_member_social |
| tiktok | SOCIAL_TIKTOK_CLIENT_ID / SOCIAL_TIKTOK_CLIENT_SECRET | user.info.basic, video.publish |
| youtube | SOCIAL_YOUTUBE_CLIENT_ID / SOCIAL_YOUTUBE_CLIENT_SECRET | youtube.readonly, youtube.upload |
| x | SOCIAL_X_CLIENT_ID / SOCIAL_X_CLIENT_SECRET | tweet.read, tweet.write, users.read, offline.access |

YouTube scope names above abbreviate the required full `https://www.googleapis.com/auth/` URLs in the implementation. Facebook/Instagram adapters use Facebook Login and Graph v26.0; Instagram requires an eligible professional account linked to a Page. The ordinary Meta Ads app's existing credentials are not silently reused for these separate social permissions.

OAuth state expires after ten minutes and is bound to the provider, app ID, tenant, initiating owner's current dashboard credential, connection generation and a Secure/HttpOnly/SameSite=Lax browser cookie. State is consumed before token exchange. X uses S256 PKCE and confidential-client authentication. Token/identity HTTP requests use fixed provider endpoints, timeouts, bounded responses and no redirects. Credentials are encrypted with tenant+provider AAD using the existing key-version envelope.

Multiple Facebook Pages/Instagram accounts require an explicit choice from server-returned candidates. More than 100 accounts currently requires a narrower authorization; pagination is rejected rather than silently dropping accounts. Disconnect removes local credentials and pending states, increments the generation and audits the change. It does not revoke provider-side app permissions; users can revoke those with the provider. Expired connections require reconnecting; automatic token refresh is not implemented.

Successful authorization shows the provider-verified account identity and saved token expiry. It is not evidence of app-review eligibility or publishing readiness. No social publishing endpoint is added, and no content is posted by connecting. Production provider validation requires the owner's consent and actual approved developer applications.

## Opening greeting

Standalone greetings (including היי/שלום/אהלן, common time-of-day greetings, hi/hello and /start) use exactly:

> 🙋 היי, אני סוכן השיווק החכם של קמפיין בצא׳ט - מה לעשות בשבילך היום?

An actual request beginning with a greeting is not swallowed. Greeting does not reset facts, drafts, a paused state or pending questions. Existing welcome choice buttons remain available for an idle journey. Voice input retains its transcription acknowledgement before the welcome. Greeting does not invoke an AI or provider read/write operation. Messages are still stored in the shared history.

## Validation and release gates

Local integration tests use PGlite, loopback HTTP and mocked providers. They cover profile/email immutability/revisions, all locales, avatar bounds and tenant isolation, key scopes/revocation, all six token/identity adapters, wrong-browser/replayed states, generation invalidation, explicit account selection, withdrawn dashboard ownership and denied consent. Browser checks cover saving a demo profile, all six settings languages, one-time key display/clearing, and no horizontal overflow at 390/768/1440px.

The Render service was checked read-only: auto-deploy and PR previews remain off. Its current free database is available and expires 2026-11-24; this check does not verify backup availability or restoration. No production migration, provider permission change, live OAuth consent, message, campaign action, charge or deployment has been executed for this change.

Before release: verify a database backup/isolated restore and migrations 009/010 on the restored copy; configure an existing verified business owner's dashboard credential/email/origin; configure the approved support contact and the provider applications that should be enabled; run CI with external PostgreSQL; approve the exact release. Providers without verified configuration should remain visibly unavailable. Real billing, browser chat sending, browser campaign editing and full localization are still outside this change.

## Provider references inspected

- [LinkedIn authorization code flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow) and [userinfo](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2).
- [TikTok web authorization](https://developers.tiktok.com/docs/en/login-kit-web) and [token exchange](https://developers.tiktok.com/docs/en/oauth-user-access-token-management).
- [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server) and [YouTube authorization](https://developers.google.com/youtube/v3/guides/authentication).
- [X authorization code flow and PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code).
- [Sharp input bounds](https://sharp.pixelplumbing.com/api-constructor/) and [resizing](https://sharp.pixelplumbing.com/api-resize/).

Meta developer manual-flow and Instagram setup pages returned HTTP 429 during this task. Meta's published Postman collection was available as a supporting reference, but current Meta developer documentation and live app compatibility still require verification before enabling social consent in production. No app-review approval is assumed.
