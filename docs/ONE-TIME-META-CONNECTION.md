# One initial Meta connection

With META_MANAGEMENT_LOGIN_CONFIG_ID configured, the first ordinary WhatsApp or portal connection now uses the reviewed management configuration by default. It requests ads_read, ads_management and the configured Page permissions in the same Meta authorization. The former read-only configuration is retained for explicitly requested read-only links or environments without the management configuration; production has the management configuration set.

An explicit request to connect now receives its personal link immediately. The extra 'shall I send the link?' approval is skipped in the unified flow. A customer with an existing full grant receives the verified account status rather than another OAuth prompt. A legacy read-only connection needs one upgrade consent because software cannot grant Meta access on the customer's behalf.

On required renewal, an existing selected account is preserved only if the new token successfully verifies the same active account. Invalid/revoked access clears selection. Connection generation still advances, invalidating old pending actions. OAuth state, browser binding, expiry and single-use protections remain in place. A callback without ads_management is rejected without replacing the existing token, and gets a plain Hebrew explanation.

This change concerns account authorization, not advertising execution. Campaign creation and activation remain distinct explicit approvals in WhatsApp. READ_ONLY and Meta write switches are not changed. Meta may require a future renewal after expiry/revocation; 'one initial connection' is not a promise that third-party permissions never expire. If several accounts remain available, selecting the intended account is still necessary and is not an additional access grant.

No new schema migrations or external advertising writes. Tests cover initial full scope, direct link delivery, no redundant reconnect after full consent, verified account preservation/revocation and rejection of partial grants.
