'use strict';
// Payment-provider adapters. SCORPIO never sees card numbers: every adapter
// sends the customer to the provider's own hosted page and keeps only tokens/ids.
//
// An adapter implements:
//   id                                   short provider name stored with each record
//   configured()                         true only when every secret/id it needs is set
//   price(planKey)                       {id, amountMinor, currency}, verified against billingPlans
//   createCheckout({checkoutId, clientId, planKey, priceId, trialEndsAt, successUrl, cancelUrl})
//                                        -> {url, sessionId}  (hosted payment page)
//   changePlan({subscriptionId, priceId}) next charge uses the new price, no proration
//   cancelAtPeriodEnd({subscriptionId})  -> {endsAt: Date|null}; nothing further is charged
//   managementUrl({customerId, returnUrl}) -> {url} or null when the provider has none
//   parseWebhook(rawBody, headers, now)  -> normalized event (see normalize below) or throws
//
// Normalized webhook events:
//   {id, created, kind:'CHECKOUT_COMPLETED', sessionId, clientReference, subscriptionId, customerId, paid}
//   {id, created, kind:'SUBSCRIPTION_STATUS', subscriptionId, status:'ACTIVE'|'PAST_DUE'|'CANCELLED', periodEnd}
//   {id, created, kind:'INVOICE_PAID', invoiceId, subscriptionId, amountMinor, currency, hostedUrl}
//   {id, created, kind:'IGNORED'}
//
// To add Grow / PayPlus / Cardcom: write an adapter with the same shape and add it
// to ADAPTERS. Nothing else in the code needs to change.
const axios = require('axios'), crypto = require('node:crypto'), plans = require('./billingPlans');

const stripePriceEnv = { basic: 'STRIPE_PRICE_BASIC', growth: 'STRIPE_PRICE_GROWTH', premium: 'STRIPE_PRICE_PREMIUM' };
const stripe = {
  id: 'stripe',
  webhookHeader: 'stripe-signature',
  configured() {
    return /^sk_(?:test|live)_/.test(process.env.STRIPE_SECRET_KEY || '') && !!process.env.STRIPE_WEBHOOK_SECRET
      && Object.values(stripePriceEnv).every(name => /^price_[a-zA-Z0-9]+$/.test(process.env[name] || ''));
  },
  async request(method, path, data, headers = {}) {
    if (!stripe.configured()) throw Error('BILLING_NOT_CONFIGURED');
    const options = { headers: { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY, ...headers }, timeout: 15000, maxRedirects: 0, proxy: false };
    try {
      return (method === 'GET' ? await axios.get('https://api.stripe.com/v1' + path, options) : await axios.post('https://api.stripe.com/v1' + path, new URLSearchParams(data), options)).data;
    } catch { throw Error('BILLING_PROVIDER_FAILED'); }
  },
  async price(planKey) {
    const id = process.env[stripePriceEnv[planKey]];
    if (!plans.plan(planKey) || !id) throw Error('BILLING_PLAN_UNKNOWN');
    const p = await stripe.request('GET', '/prices/' + id);
    // Refuse to charge anything other than the flat monthly price shown to the customer.
    if (!p.active || p.unit_amount !== plans.priceMinor(planKey) || p.currency !== 'ils' || p.recurring?.interval !== 'month' || p.recurring.interval_count !== 1) throw Error('BILLING_PRICE_UNSUPPORTED');
    return { id: p.id, amountMinor: p.unit_amount, currency: 'ILS' };
  },
  async createCheckout({ checkoutId, clientId, priceId, trialEndsAt, successUrl, cancelUrl }) {
    const data = { mode: 'subscription', 'line_items[0][price]': priceId, 'line_items[0][quantity]': '1', client_reference_id: String(clientId), 'metadata[checkout_id]': checkoutId, success_url: successUrl, cancel_url: cancelUrl };
    // First charge only when the free trial ends. Stripe needs at least 48 hours.
    if (trialEndsAt && trialEndsAt.getTime() - Date.now() > 48 * 3600 * 1000) data['subscription_data[trial_end]'] = String(Math.floor(trialEndsAt.getTime() / 1000));
    const session = await stripe.request('POST', '/checkout/sessions', data, { 'Idempotency-Key': checkoutId });
    const u = new URL(session.url);
    if (u.origin !== 'https://checkout.stripe.com' || typeof session.id !== 'string') throw Error('INVALID_BILLING_REDIRECT');
    return { url: session.url, sessionId: session.id };
  },
  async changePlan({ subscriptionId, priceId }) {
    const sub = await stripe.request('GET', '/subscriptions/' + encodeURIComponent(subscriptionId));
    const item = sub.items?.data?.[0]?.id;
    if (typeof item !== 'string') throw Error('BILLING_PROVIDER_FAILED');
    await stripe.request('POST', '/subscriptions/' + encodeURIComponent(subscriptionId), { 'items[0][id]': item, 'items[0][price]': priceId, proration_behavior: 'none' }, { 'Idempotency-Key': crypto.randomUUID() });
    return { ok: true };
  },
  async cancelAtPeriodEnd({ subscriptionId }) {
    const sub = await stripe.request('POST', '/subscriptions/' + encodeURIComponent(subscriptionId), { cancel_at_period_end: 'true' });
    const end = sub.cancel_at || sub.trial_end || sub.current_period_end || sub.items?.data?.[0]?.current_period_end;
    return { endsAt: Number.isSafeInteger(end) ? new Date(end * 1000) : null };
  },
  async managementUrl({ customerId, returnUrl }) {
    const result = await stripe.request('POST', '/billing_portal/sessions', { customer: customerId, return_url: returnUrl });
    if (new URL(result.url).origin !== 'https://billing.stripe.com') throw Error('INVALID_BILLING_REDIRECT');
    return { url: result.url };
  },
  parseWebhook(raw, headers, now = Date.now()) {
    const signature = headers?.['stripe-signature'];
    if (!Buffer.isBuffer(raw) || raw.length > 2 * 1024 * 1024 || typeof signature !== 'string' || signature.length > 2000 || !stripe.configured()) throw Error('INVALID_BILLING_SIGNATURE');
    const parts = signature.split(',').map(x => x.split('=')), timestamp = parts.find(p => p[0] === 't')?.[1], signatures = parts.filter(p => p[0] === 'v1').map(p => p[1]);
    if (!/^\d+$/.test(timestamp || '') || Math.abs(now / 1000 - Number(timestamp)) > 300) throw Error('INVALID_BILLING_SIGNATURE');
    const expected = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(timestamp + '.').update(raw).digest();
    if (!signatures.some(s => /^[a-f0-9]{64}$/.test(s || '') && crypto.timingSafeEqual(Buffer.from(s, 'hex'), expected))) throw Error('INVALID_BILLING_SIGNATURE');
    return stripe.normalize(JSON.parse(raw.toString('utf8')));
  },
  normalize(event) {
    if (typeof event?.id !== 'string' || event.id.length > 200 || typeof event.type !== 'string' || !Number.isSafeInteger(event.created) || !event.data?.object) throw Error('INVALID_BILLING_EVENT');
    const o = event.data.object, base = { id: event.id, created: event.created };
    if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
      return { ...base, kind: 'CHECKOUT_COMPLETED', sessionId: o.id, clientReference: o.client_reference_id, subscriptionId: o.subscription, customerId: o.customer, paid: o.mode === 'subscription' && ['paid', 'no_payment_required'].includes(o.payment_status) };
    }
    if (['customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type) && typeof o.id === 'string' && /^sub_[a-zA-Z0-9]+$/.test(o.id)) {
      const status = event.type.endsWith('deleted') || ['canceled', 'unpaid', 'incomplete_expired'].includes(o.status) ? 'CANCELLED' : ['past_due', 'incomplete', 'paused'].includes(o.status) ? 'PAST_DUE' : ['active', 'trialing'].includes(o.status) ? 'ACTIVE' : null;
      const end = o.current_period_end || o.items?.data?.[0]?.current_period_end;
      if (status) return { ...base, kind: 'SUBSCRIPTION_STATUS', subscriptionId: o.id, status, periodEnd: Number.isSafeInteger(end) ? new Date(end * 1000) : null };
    }
    if (event.type === 'invoice.paid') {
      let hostedUrl = null;
      try { const u = new URL(o.hosted_invoice_url); if (u.protocol === 'https:' && u.hostname === 'invoice.stripe.com') hostedUrl = u.toString(); } catch {}
      return { ...base, kind: 'INVOICE_PAID', invoiceId: o.id, subscriptionId: o.subscription || o.parent?.subscription_details?.subscription, amountMinor: o.amount_paid, currency: typeof o.currency === 'string' ? o.currency.toUpperCase() : null, hostedUrl };
    }
    return { ...base, kind: 'IGNORED' };
  },
};

const ADAPTERS = { stripe };

function enabled() { return process.env.BILLING_ENABLED === 'true'; }
// The provider that may take real money, or null. Nothing charges until the owner
// sets BILLING_ENABLED=true, picks BILLING_PROVIDER and fills that provider's settings.
function active() {
  if (!enabled()) return null;
  const adapter = ADAPTERS[process.env.BILLING_PROVIDER || 'stripe'];
  return adapter && adapter.configured() ? adapter : null;
}
function byId(id) { return Object.prototype.hasOwnProperty.call(ADAPTERS, id) ? ADAPTERS[id] : null; }

module.exports = { ADAPTERS, active, byId, enabled };
