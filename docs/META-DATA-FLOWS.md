# Meta data flows: what is real, how to switch it on

Checked against developers.facebook.com on 2026-11-21. Graph API default `v26.0` (supported; newest is v27.0).

## 1. Lead Ads → CRM (webhook)

Flow: Meta → `POST /webhook` (object `page`, field `leadgen`) → signature check (`X-Hub-Signature-256`,
HMAC-SHA256 of the raw body with `META_APP_SECRET`, timing-safe; unsigned/invalid → 401) →
`meta_lead_events` queue (idempotent by `leadgen_id`) → worker reads `GET /{leadgen_id}` with the
business's Page token (`leads_retrieval`) → `crmService.create` (unique per business+source+leadgen_id)
→ `leadConcierge.onNewLead` (owner alert + concierge). The lead keeps its source in
`crm_leads.source_detail` (page, form, ad, ad set, campaign, platform) and `crm_leads.ad_id/campaign_id`.

Which business a lead belongs to: a form registered in `meta_lead_sources`. Forms get there when
(a) SCORPIO creates the form (approved `CREATE_LEAD_FORM`), (b) the owner connects a form in the
dashboard, or (c) a new form appears on a Page the business already connected.

### Subscription steps (one time, by the app admin)
1. App Dashboard → **Webhooks** → choose **Page** → *Subscribe to this object*:
   - Callback URL: `https://<APP_PUBLIC_URL host>/webhook`
   - Verify token: the value of `META_WEBHOOK_VERIFY_TOKEN` (the WhatsApp token also works).
   - Subscribe the field **`leadgen`**.
2. Per business Page (automatic): when a form is connected, SCORPIO calls
   `POST /{page-id}/subscribed_apps?subscribed_fields=leadgen` with the Page token
   (needs `pages_manage_metadata`). If that fails, the dashboard shows "subscription required".
3. Render: `META_LEAD_IMPORT_ENABLED=true` (the worker loop and the webhook branch are off otherwise).
4. Test: Meta's **Lead Ads Testing Tool** (developers.facebook.com/tools/lead-ads-testing) → create a test lead → it appears in the CRM.

## 2. Pixel + Conversions API
- Landing page: the visitor consents → pixel loads → on submit the browser sends `eventId`
  (UUID) to the server and fires `fbq('track','Lead',{}, {eventID})` with the same id. The server
  queues one `Lead` event with the same `event_id` → Meta keeps one (dedup on event_name+event_id).
- `action_source: website` only when `event_source_url` and `client_user_agent` exist (Meta requires
  both); otherwise `system_generated`. `em`/`ph` SHA-256 (trimmed, lowercase, phone with 972),
  `fbp/fbc/ip/ua` not hashed, and only with consent. Stored identifiers are cleared once sent.
- `Purchase` when a consented lead is marked WON: sent once (`purchase:<lead id>`), only with a real
  amount and currency; waits (not an attempt) until the owner types the amount, skipped after ~7 days.
- Lead Ads leads: Conversion Leads (`META_CRM_FEEDBACK_ENABLED=true`): `system_generated`,
  `event_source=crm`, `lead_id` = Meta's leadgen id, one event per stage.
- Failures: temporary Meta errors retry with backoff (5 attempts); permanent ones stop with a reason
  (`META_ERROR_<code>`). Visible at `GET /app/api/meta/data-status` → `conversions`.

## 3. Real campaign creation
Production always uses `actionExecutor → metaWrite` (Graph). The mock adapters refuse to run when
`NODE_ENV=production`, and `MOCK_META_ENABLED=true` blocks production start. Writes need
`META_WRITES_ENABLED=true` and `READ_ONLY=false` plus an owner approval for the exact plan.
Every create is `PAUSED`; only `ACTIVATE_BUNDLE`/`RESUME_CAMPAIGN` (separate approval) set ACTIVE.
- Campaign: `special_ad_categories` (+ `special_ad_category_country`), `is_adset_budget_sharing_enabled=false` (budget on the ad set; required since v24).
- Real estate (`verticalProfiles.real_estate.housingCategory`) always declares `HOUSING`. Audiences in
  the US/Canada/EU get Meta's housing rules (ages 18-65, all genders, no detailed targeting, radius ≥ 15 km).
- Ad set: `destination_type=ON_AD` + `promoted_object.page_id` for lead forms;
  `targeting_automation.advantage_audience=0` (explicit since v23; keeps the approved audience).
- Creative: image hash from `/adimages`, Page identity + optional `instagram_user_id`
  (`instagram_actor_id` is gone); lead-form ads use `link=https://fb.me/` and `lead_gen_form_id`;
  all Advantage+ creative enhancements opted out.
- Organic: Page `/photos` or `/feed`; Instagram `/media` → wait for `FINISHED` → `/media_publish`
  (JPEG only). One row per post+network makes it idempotent; an uncertain call is never retried.

## 4. Measurement
`metaInsights.js`: `GET /act_{id}/insights?level=campaign&use_unified_attribution_setting=true`
(same as Ads Manager; 7d_view/28d_view no longer exist). Spend in the account currency
(`account_currency`). Leads = one action type (`lead`, else on-Facebook, else pixel), never summed.
Cached 15 minutes in `meta_insights_cache`; `clients.last_insights_sync` → `GET /app/api/meta/data-status`
(`?refresh=1` forces a read). Sales and revenue come only from the CRM.

## 5. Tests
- `npm test` → `tests/metaData.test.js` (mocked Graph).
- `npm run test:live` → only with `META_TEST_ACCESS_TOKEN`, `META_TEST_AD_ACCOUNT_ID`, `META_TEST_PAGE_ID`
  (optional `META_APP_SECRET`): creates campaign+ad set+creative+ad PAUSED, reads insights, deletes them.
