# Campaign approval inside WhatsApp

The campaign customer reviews the exact account, objective, budgets, targeting, dates, creative text and image/link references in WhatsApp. Review messages longer than 3,800 characters are sent in full, in order, before the approval buttons. Text approval codes remain an optional chat fallback.

An approval button is bound to the tenant, current conversation context, latest nonce, action ID and approval expiry. The button title is never trusted. A server-consumed selection creates a one-request authorization in AsyncLocalStorage. Typing its internal command, replaying a click, changing account or using another customer's button cannot approve it. Plain yes is never advertising authorization. No plaintext approval code is saved in the menu profile.

After CREATE_BUNDLE is executed and verified PAUSED, the server prepares a fresh ACTIVATE_BUNDLE approval for the exact created campaign/ad sets/ads. Its WhatsApp button explicitly warns of advertising expenditure. It never automatically activates. If preparing the second approval fails, the customer is told the campaign exists paused and activation is not complete. Existing no-retry/manual-review rules remain intact.

PLAN_REVIEW can continue through the WhatsApp creation option instead of remaining a disconnected local draft. Saved creative is passed as context to the shared AI provider. The get_campaign_setup tool reads tenant-verified account/permissions/pages/existing images/pixels; missing or ambiguous assets are not fabricated. User must supply any missing critical destination, asset, delivery and date information. A change of selected account interrupts setup. A draft remains planning context, not approval.

## One-time Meta authorization

Customer permission to SCORPIO is distinct from approval of an individual campaign. Meta must present its own login/permission screen. The customer receives a personal single-use link in WhatsApp, completes Meta consent, then returns to the chat. No Facebook password is collected in WhatsApp.

The read configuration META_LOGIN_CONFIG_ID remains unchanged. A separate reviewed user-token configuration is selected only for management invitations using META_MANAGEMENT_LOGIN_CONFIG_ID. Missing configuration fails closed; an ads_read-only configuration is never silently reused. Management invites use the existing expiring, hashed INVITE/STATE mechanism and browser binding, without a schema change. OAuth callback preserves generation and server verification of granted permissions.

At implementation, the active tenant had ads_read/public_profile only. Meta UI showed one read configuration, ID 1547508470739287. A separate management configuration was prepared (not created) with ads_management, ads_read, pages_read_engagement and dependent pages_show_list. Saving expands requested access and requires the owner's concrete approval before clicking Create. Then configure its generated ID, obtain actual customer Meta consent and verify the token. Standard-access permissions may be limited to app-role users; commercial access for other businesses must not be claimed without Meta approval.

Production write switches remain unchanged during this implementation. Enabling execution is separate from approving any specific campaign and cannot substitute for missing Meta permissions. No production ads, uploads or budgets were changed by validation.

## Validation and rollback

221 automated tests passed with zero failures and zero skips against isolated PostgreSQL and provider mocks. This includes genuine handler routing from the creation button to a verified paused bundle, a distinct activation button, duplicate replay rejection, forged typed commands, complete long reviews, management-config selection, saved creative handoff and account-change interruption. npm syntax checks and production dependency audit passed. This does not certify a real Meta write.

No new database migrations. Rollback to release 23c626f7ed8fa09188b94e6482fc8069476bcb42 / Render dep-dbj4a70u01pc73eei8m0 if the chat regresses. Keep existing read-only gates and do not restore over new customer data.
