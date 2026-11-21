# Meta approval: what to submit so SCORPIO can manage ads for other businesses

App: **Campaign Bachat API** (App ID `3244596585929846`). Today the app works only for accounts
that have a role on the app. To serve paying customers, three separate approvals are needed.
Do them in this order.

## Step 1: Business Verification (the owner does this)

Meta Business Suite → Settings → Business info → **Start verification**.
Needed: legal business name exactly as registered, address, phone, website on your own domain,
and one official document (עוסק מורשה / ח.פ certificate, or a utility bill with the business name).
Usually takes a few days.

## Step 2: Access verification as a Tech Provider

App Dashboard → **App settings → Advanced → Access verification** (appears after Step 1).
Answer: the app manages ads and lead forms **on behalf of other businesses** (small businesses in
Israel that connect their own ad account through Facebook Login for Business).

## Step 3: App Review for Advanced Access

App Dashboard → **App Review → Permissions and Features**. Request Advanced Access for:

| Permission | Why SCORPIO needs it (paste as the use-case description) |
|---|---|
| `ads_management` | SCORPIO creates campaigns, ad sets, ads and lead forms in the advertiser's own ad account, always in PAUSED status first. The advertiser reviews a plain-language summary (account, budget, audience, copy, start date) in WhatsApp and must approve creation, and then separately approve activation. Budget changes, pauses and resumes are also only executed after explicit approval. |
| `ads_read` | SCORPIO reads campaign performance (spend, impressions, clicks, leads) for the advertiser's selected ad account to send them a weekly business report that connects ad spend to leads, meetings and closed deals, and to suggest improvements. |
| `business_management` | Used during Facebook Login for Business so the advertiser can choose which of their own ad accounts and Pages SCORPIO may work with. We only list assets the user granted. |
| `pages_show_list` | Lets the advertiser pick the Facebook Page their ads and lead forms will run from. |
| `pages_read_engagement` | Reads basic Page information required to attach ads and lead forms to the selected Page. |
| `pages_manage_ads` | Creates lead-generation forms on the advertiser's Page and attaches them to their ads, after the advertiser approves the exact form questions and privacy policy link. |
| `pages_manage_metadata` | Subscribes the app to the Page's `leadgen` webhook so new leads reach the advertiser's CRM immediately and the owner gets a WhatsApp alert. |
| `leads_retrieval` | Retrieves lead details (name, phone, email) submitted to the advertiser's own lead forms and stores them only in that advertiser's CRM, so they can follow up quickly and track which leads became customers. |
| `whatsapp_business_messaging` | Sends and receives messages with the business owner (the advertiser) in WhatsApp, which is the main interface of SCORPIO: briefs, approvals, lead alerts and reports. |

Data handling statement (paste where asked): *Each advertiser's tokens are encrypted at rest and
used only for that advertiser's own assets. Lead data is stored per advertiser and is never shared
across tenants. Advertisers can disconnect at any time and request deletion through the data
deletion page `https://<your-domain>/data-deletion` (Meta data deletion callback: `https://<your-domain>/meta/deletion`, deauthorize callback: `https://<your-domain>/meta/deauthorize`).*

### Screencast (one recording, 3–5 minutes, English captions or narration)

1. Show the login page and click **Connect with Facebook** (Facebook Login for Business).
2. In the Meta dialog, select one ad account and one Page, and approve.
3. In WhatsApp, write: *"I want a lead campaign for my hair salon in Tel Aviv, 50 NIS a day."*
4. Show SCORPIO's draft summary: account, Page, audience, budget, copy, lead form questions.
5. Tap **Approve creation** → show in Ads Manager that the campaign was created **Paused**.
6. Tap **Approve activation** → show it is now active (or skip activation in a test account).
7. Submit a test lead (Ads Manager → Lead Ads Testing Tool) → show the WhatsApp lead alert and
   the lead in the CRM.
8. Write *"דוח עסקי"* → show the report (uses `ads_read`).
9. Show **Disconnect** and the data deletion page.

### Before you submit, make sure

- [ ] A domain you own serves the privacy policy (`/privacy`), terms and data deletion (`/data-deletion`) pages. **There is no terms-of-service page yet**; it needs a lawyer-reviewed text.
- [ ] The app's Privacy Policy URL, Terms URL and Data Deletion URL point to that domain.
- [ ] App icon (1024×1024), category "Business and Pages", and a contact email are set.
- [ ] A test ad account and Page you control are ready for the reviewer to see in the video.
- [ ] Facebook Login for Business configuration includes exactly the permissions above.

## After approval

Set in Render and redeploy: nothing changes in code. Customers can connect their own accounts.
Lead forms also require each customer's Page to accept Meta's Lead Ads Terms once.
