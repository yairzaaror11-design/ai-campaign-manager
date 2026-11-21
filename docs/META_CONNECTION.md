# Meta connection — setup, permissions and App Review

The owner connects Meta from the dashboard (**חיבורים**) or from WhatsApp. The login is
Meta's official one; tokens are stored encrypted; the connection is checked every hour.
Checked against developers.facebook.com on 2026-11-21 (latest Graph API: v27.0, Nov 4 2026;
the code defaults to v26.0, set with `META_GRAPH_VERSION`).

## How it works

| Step | What happens | Code |
|---|---|---|
| Connect | One-time link (10 min) → `/auth/meta/connect` → Meta dialog. With `META_LOGIN_CONFIG_ID`: Facebook Login for Business (`config_id`). Without it: the classic dialog with `scope`. `state` is single-use and bound to an HttpOnly cookie. | `metaConnection.begin`, `metaOAuth.js` |
| Callback | Code → token, then `fb_exchange_token` → long-lived (~60 days). `debug_token` gives the real expiry, data-access expiry and app/user check. `GET /me/permissions` → granted / declined saved. | `metaConnection.callback`, `metaAuth.js` |
| Missing permissions | Screen and WhatsApp list them in Hebrew. **תן הרשאה** opens the dialog with `auth_type=rerequest` and `scope` = only the missing ones. WhatsApp: "תן הרשאה" or `/meta-permissions`. | `createInvite({rerequest:true})` |
| Expiry | Hourly job: `debug_token` + permissions. Under 10 days left: tries `fb_exchange_token` again. Under 7 days (token or data access): one WhatsApp notice to reconnect. | `metaAuth.runDue` |
| Revoked | Any Graph error 190 for a business → `debug_token` confirms → token deleted (every Meta job stops), pending approvals and lead imports expire, owner told in WhatsApp. The deauthorize callback does the same. Chosen assets are kept for the reconnect. | `metaAuth.markRevoked`, `metaDeletion.js` |
| Assets | Ad account, Facebook Page, Instagram professional account (from the Page) and Pixel (dataset), listed live from Meta and saved per business. The Pixel is the same `business_channels.pixel_id` the Conversions API uses. | `metaAuth.assets / selectAsset` |
| Screen | `GET /app/api/connections` (no secrets) → `public/portal/connections.js` | `connectionRoutes.js` |
| Health | `/health` → `integrations`: counts and statuses only. | `metaAuth.healthSummary` |

## Environment variables

| Name | Required | What it does | Where to get it |
|---|---|---|---|
| `META_APP_ID` | yes | The Meta app | App Dashboard → App settings → Basic |
| `META_APP_SECRET` | yes | Code exchange, `appsecret_proof`, `debug_token` app token, signed requests | App Dashboard → App settings → Basic → App secret |
| `META_LOGIN_CONFIG_ID` | recommended | Facebook Login for Business configuration. Without it the classic dialog is used | App Dashboard → Facebook Login for Business → Configurations → create one: token type **User access token**, permissions below |
| `META_MANAGEMENT_LOGIN_CONFIG_ID` | optional | Existing "full management" configuration; when set, a login without `ads_management` is refused | Same place, a second configuration |
| `APP_PUBLIC_URL` | yes | https origin of the service (e.g. `https://app.scorpioads.example/`) | Render service URL / custom domain |
| `META_REDIRECT_URI` | optional | OAuth redirect. Must be `<APP_PUBLIC_URL origin>/auth/meta/callback` and listed in **Valid OAuth Redirect URIs** | Facebook Login for Business → Settings |
| `META_TOKEN_ENCRYPTION_KEY` | yes | AES-256-GCM key for tokens (32 bytes, base64) | `openssl rand -base64 32`, kept only in Render |
| `META_TOKEN_KEY_ID`, `META_TOKEN_PREVIOUS_KEYS` | optional | Key rotation (existing mechanism) | — |
| `META_GRAPH_VERSION` | optional | Graph API version, default `v26.0` | Meta changelog |
| `META_WEBHOOK_VERIFY_TOKEN` (or `WHATSAPP_VERIFY_TOKEN`) | for Lead Ads | Webhook verification string (owned by the webhook module) | Any random string, same value in App Dashboard → Webhooks |
| `META_LEAD_IMPORT_ENABLED` | for Lead Ads | Turns lead import on | `true` |
| `DELETION_HMAC_KEY` | yes (prod) | Data-deletion guard | `openssl rand -hex 32` |
| `META_TEST_ACCESS_TOKEN`, `META_TEST_AD_ACCOUNT_ID` | tests only | Enables `npm run test:live` (read-only) | A test user / your own token from Graph API Explorer; `act_<id>` it can read |

Also set in the App Dashboard (Facebook Login for Business → Settings):
- **Deauthorize callback URL**: `https://<domain>/meta/deauthorize`
- **Data deletion request URL**: `https://<domain>/meta/deletion`

## Permissions

The configuration (`META_LOGIN_CONFIG_ID`) must include all of these; the classic dialog asks for them in `scope`.

| Permission | Required | Used for |
|---|---|---|
| `ads_management` | yes | Create campaigns (PAUSED), change budgets, pause/resume |
| `ads_read` | yes | Insights, reports, campaign guard |
| `business_management` | yes | Ad accounts and pixels owned by the Business portfolio |
| `pages_show_list` | yes | List the owner's Pages |
| `pages_read_engagement` | yes | Read Page content; dependency of ads and lead forms |
| `pages_manage_ads` | yes | Page ads and lead forms |
| `leads_retrieval` | yes | Read Lead Ads submissions |
| `instagram_basic` | optional | Show the Instagram account linked to the Page |

Not requested here on purpose: `pages_manage_posts` and `instagram_content_publish` belong to the
separate Facebook/Instagram publishing connection (`socialConnections.js`); `whatsapp_business_messaging`
is not needed because WhatsApp uses the system token, not the owner's login;
`pages_manage_metadata` is not used (the code checks the Page's `leadgen` subscription but does not create it).

## App Review (Advanced Access)

Meta: "To serve businesses that you do not own or manage, your app must be approved for Advanced Access via
Meta's App Review", and Business Verification is required for any Advanced Access request.
`leads_retrieval` also depends on **Ads Management Standard Access** (Marketing API access level).

For each permission: a short use-case text, a screencast of the real flow (login → the feature), and test instructions.

| Permission | What to show in the screencast |
|---|---|
| `ads_management` | Owner asks in WhatsApp for a campaign → approves → campaign created **PAUSED** in the ad account; then pause/resume after approval |
| `ads_read` | Dashboard → תוצאות: spend, leads, cost per lead from Insights |
| `business_management` | חיבורים → בחר נכסים: ad accounts and pixels of the Business portfolio |
| `pages_show_list` | חיבורים → בחר נכסים → the Page list |
| `pages_read_engagement` | Choosing the Page and using it in an ad preview / lead form |
| `pages_manage_ads` | Creating a lead form on the Page and an ad that uses it (PAUSED) |
| `leads_retrieval` | A test lead from Lead Ads Testing Tool appears in לידים and as a WhatsApp alert |
| `instagram_basic` | חיבורים → the Instagram account linked to the Page is shown and selected |

Give the reviewer: a test account login for the dashboard, the steps above, and note that nothing is spent (campaigns stay PAUSED until the owner approves).
