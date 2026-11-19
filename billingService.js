'use strict';
// Checkout and provider webhooks. Provider specifics live in billingProviders; the
// customer-facing rules (trial, cancel, refund) live in subscriptionService.
const crypto = require('node:crypto'), db = require('./db'), plans = require('./billingPlans'), providers = require('./billingProviders');

function configured() { return !!providers.active(); }
async function price(planKey) {
  const adapter = providers.active();
  if (!adapter) return { available: false, reason: plans.NOT_ENABLED_NOTE };
  if (!plans.plan(planKey)) throw Error('BILLING_PLAN_UNKNOWN');
  const p = await adapter.price(planKey);
  return { available: true, planKey, id: p.id, amountMinor: p.amountMinor, currency: p.currency, interval: 'month', notice: `חיוב חודשי קבוע של ${plans.priceText(planKey)}. ${plans.AD_BUDGET_NOTE} ${plans.CANCEL_HOW}` };
}
async function checkout(clientId, { planKey, confirmPurchase = false, expectedAmountMinor } = {}) {
  const adapter = providers.active();
  if (!adapter) throw Error('BILLING_NOT_CONFIGURED');
  const p = await price(planKey);
  if (confirmPurchase !== true || expectedAmountMinor !== p.amountMinor) throw Error('BILLING_PRICE_CONFIRMATION_REQUIRED');
  const id = crypto.randomUUID();
  let trialEndsAt = null;
  await db.transaction(async tx => {
    const account = await tx('SELECT client_id FROM customer_accounts WHERE client_id=$1', [clientId]);
    if (!account.rows.length) throw Error('REGISTRATION_REQUIRED');
    const sub = (await tx("SELECT trial_ends_at FROM customer_subscriptions WHERE client_id=$1 AND status='TRIAL' AND trial_ends_at>NOW()", [clientId])).rows[0];
    trialEndsAt = sub ? new Date(sub.trial_ends_at) : null;
    await tx('INSERT INTO billing_checkouts(id,client_id,price_id,plan_key) VALUES($1,$2,$3,$4)', [id, clientId, p.id, planKey]);
  });
  try {
    const o = require('./portalStore').origin();
    const session = await adapter.createCheckout({ checkoutId: id, clientId, planKey, priceId: p.id, trialEndsAt, successUrl: o + '/app?payment=returned', cancelUrl: o + '/app?payment=cancelled' });
    await db.query("UPDATE billing_checkouts SET provider_session_id=$2,status='READY' WHERE id=$1", [id, session.sessionId]);
    return { url: session.url };
  } catch (e) { await db.query("UPDATE billing_checkouts SET status='FAILED' WHERE id=$1", [id]); throw e; }
}
// Verifies and normalizes a provider webhook. Throws on anything unsigned or malformed.
function verify(raw, headers, now = Date.now()) {
  const adapter = providers.active();
  if (!adapter) throw Error('INVALID_BILLING_SIGNATURE');
  return { provider: adapter.id, event: adapter.parseWebhook(raw, headers, now) };
}
async function apply({ provider, event: e }) {
  if (!providers.byId(provider)) throw Error('INVALID_BILLING_EVENT');
  return db.transaction(async tx => {
    const inserted = await tx("INSERT INTO billing_events(provider,event_id,result) VALUES($1,$2,'PROCESSING') ON CONFLICT DO NOTHING RETURNING event_id", [provider, e.id]);
    if (!inserted.rows.length) return { duplicate: true };
    let result = 'IGNORED';
    if (e.kind === 'CHECKOUT_COMPLETED') {
      const row = (await tx("SELECT client_id,plan_key FROM billing_checkouts WHERE provider_session_id=$1 AND status='READY' FOR UPDATE", [e.sessionId])).rows[0];
      if (row && String(row.client_id) === e.clientReference && e.paid && typeof e.subscriptionId === 'string' && typeof e.customerId === 'string') {
        await tx("UPDATE billing_checkouts SET status='COMPLETE' WHERE provider_session_id=$1", [e.sessionId]);
        const known = (await tx('SELECT status FROM billing_subscription_state WHERE provider_subscription_id=$1', [e.subscriptionId])).rows[0];
        // Paying during the free trial keeps the trial: the first charge is on its end date.
        await tx(`INSERT INTO customer_subscriptions(client_id,plan_code,plan_key,status,provider,provider_customer_id,provider_subscription_id) VALUES($1,'PAID',$5,$4,$6,$2,$3)
          ON CONFLICT(client_id) DO UPDATE SET plan_code='PAID',plan_key=COALESCE($5,customer_subscriptions.plan_key),
          status=CASE WHEN $4='ACTIVE' AND customer_subscriptions.status='TRIAL' AND customer_subscriptions.trial_ends_at>NOW() THEN 'TRIAL' ELSE $4 END,
          provider=$6,provider_customer_id=$2,provider_subscription_id=$3,cancel_requested_at=NULL,access_ends_at=NULL,cancel_channel=NULL,provider_cancel_status=NULL,updated_at=NOW()`,
        [row.client_id, e.customerId, e.subscriptionId, known?.status || 'ACTIVE', row.plan_key, provider]);
        result = 'SUBSCRIPTION_SAVED';
      }
    }
    if (e.kind === 'SUBSCRIPTION_STATUS') {
      await tx(`INSERT INTO billing_subscription_state(provider_subscription_id,status,last_event_created) VALUES($1,$2,$3) ON CONFLICT(provider_subscription_id) DO UPDATE SET status=EXCLUDED.status,last_event_created=EXCLUDED.last_event_created,updated_at=NOW() WHERE billing_subscription_state.last_event_created<=EXCLUDED.last_event_created`, [e.subscriptionId, e.status, e.created]);
      const current = (await tx('SELECT status,last_event_created FROM billing_subscription_state WHERE provider_subscription_id=$1', [e.subscriptionId])).rows[0];
      const latest = Number(current.last_event_created) === e.created;
      const r = await tx(`UPDATE customer_subscriptions SET status=CASE WHEN $2='ACTIVE' AND status='TRIAL' AND trial_ends_at>NOW() THEN 'TRIAL' ELSE $2 END,
        period_end=CASE WHEN $4 THEN COALESCE($5,period_end) ELSE period_end END,updated_at=NOW() WHERE provider_subscription_id=$1 AND provider=$3 RETURNING client_id`,
      [e.subscriptionId, current.status, provider, latest, e.periodEnd]);
      if (r.rows.length) result = 'STATUS_UPDATED';
    }
    if (e.kind === 'INVOICE_PAID') {
      const row = (await tx('SELECT client_id FROM customer_subscriptions WHERE provider=$1 AND provider_subscription_id=$2', [provider, e.subscriptionId || ''])).rows[0];
      if (row && typeof e.invoiceId === 'string' && Number.isSafeInteger(e.amountMinor) && e.amountMinor >= 0 && typeof e.currency === 'string') {
        await tx('INSERT INTO billing_invoices(provider_invoice_id,client_id,amount_paid_minor,currency,status,hosted_url) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [e.invoiceId, row.client_id, e.amountMinor, e.currency, 'PAID', e.hostedUrl || null]);
        // A real charge (not the zero-amount trial invoice) starts the refund window.
        if (e.amountMinor > 0) await tx("UPDATE customer_subscriptions SET first_paid_at=COALESCE(first_paid_at,NOW()),status=CASE WHEN status IN ('TRIAL','PAST_DUE') THEN 'ACTIVE' ELSE status END,updated_at=NOW() WHERE client_id=$1", [row.client_id]);
        result = 'INVOICE_SAVED';
      }
    }
    await tx('UPDATE billing_events SET result=$3 WHERE provider=$1 AND event_id=$2', [provider, e.id, result]);
    return { result };
  });
}
async function management(clientId) {
  const row = (await db.query('SELECT provider,provider_customer_id FROM customer_subscriptions WHERE client_id=$1', [clientId])).rows[0];
  const adapter = providers.active();
  if (!row?.provider_customer_id || !adapter || adapter.id !== row.provider) throw Error('BILLING_CUSTOMER_REQUIRED');
  return adapter.managementUrl({ customerId: row.provider_customer_id, returnUrl: require('./portalStore').origin() + '/app' });
}
module.exports = { configured, price, checkout, verify, apply, management };
