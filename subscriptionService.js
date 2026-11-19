'use strict';
// The customer's side of billing: trial, plan choice, one-step cancel and refunds.
// Provider calls go through billingProviders; with no provider configured nothing
// is ever charged and every screen says so.
const crypto = require('node:crypto'), db = require('./db'), plans = require('./billingPlans'), providers = require('./billingProviders');
const { logger } = require('./logger');
const DAY = 24 * 3600 * 1000;
const CANCEL_PROMPT_MINUTES = 30;
const LIVE = ['TRIAL', 'ACTIVE', 'PAST_DUE'];

function hebrewDate(value) {
  if (!value) return null;
  return new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(value));
}
async function row(clientId) {
  return (await db.query('SELECT * FROM customer_subscriptions WHERE client_id=$1', [clientId])).rows[0] || null;
}
async function ensureRow(clientId) {
  await db.query('INSERT INTO customer_subscriptions(client_id) VALUES($1) ON CONFLICT DO NOTHING', [clientId]);
}
function cancellable(r) { return !!r && LIVE.includes(r.status) && !r.cancel_requested_at && (!!r.plan_key || !!r.provider_subscription_id); }

function view(r, { refund = null, now = Date.now() } = {}) {
  const plan = plans.plan(r?.plan_key), paymentEnabled = !!providers.active();
  const trialEnds = r?.trial_ends_at ? new Date(r.trial_ends_at) : null;
  const trialActive = r?.status === 'TRIAL' && !!trialEnds && trialEnds.getTime() > now;
  const cancelled = !!r?.cancel_requested_at;
  let nextChargeAt = null;
  if (paymentEnabled && !cancelled && r?.provider_subscription_id) {
    if (trialActive) nextChargeAt = trialEnds;
    else if (['ACTIVE', 'PAST_DUE'].includes(r.status) && r.period_end) nextChargeAt = new Date(r.period_end);
  }
  const firstPaid = r?.first_paid_at ? new Date(r.first_paid_at) : null;
  const refundUntil = firstPaid ? new Date(new Date(firstPaid).setMonth(firstPaid.getMonth() + 1)) : null;
  return {
    planKey: plan?.key || null,
    planName: plan?.name || null,
    priceIls: plan?.priceIls || null,
    priceText: plan ? plans.priceText(plan.key) : null,
    status: r?.status || 'PILOT',
    paymentEnabled,
    paymentNote: paymentEnabled ? 'חיוב חודשי קבוע דרך ספק סליקה מאובטח. פרטי הכרטיס לא נשמרים אצלנו.' : plans.NOT_ENABLED_NOTE,
    hasPaymentMethod: !!r?.provider_subscription_id,
    trialUsed: !!r?.trial_started_at,
    trialActive,
    trialEndsAt: trialEnds?.toISOString() || null,
    trialEndsText: hebrewDate(trialEnds),
    trialDaysLeft: trialActive ? Math.max(0, Math.ceil((trialEnds.getTime() - now) / DAY)) : null,
    trialReminderDue: trialActive && !cancelled && trialEnds.getTime() - now <= plans.TRIAL_REMINDER_DAYS * DAY,
    nextChargeAt: nextChargeAt?.toISOString() || null,
    nextChargeText: hebrewDate(nextChargeAt),
    cancelled,
    cancellable: cancellable(r),
    accessEndsAt: r?.access_ends_at ? new Date(r.access_ends_at).toISOString() : null,
    accessEndsText: hebrewDate(r?.access_ends_at),
    refundEligible: !!refundUntil && refundUntil.getTime() > now && !refund,
    refundUntilText: hebrewDate(refundUntil),
    refundRequest: refund ? { id: refund.id, status: refund.status, createdAt: refund.created_at } : null,
    plans: plans.list().map(p => ({ key: p.key, name: p.name, priceIls: p.priceIls, priceText: plans.priceText(p.key), features: [...p.features] })),
    trialDays: plans.TRIAL_DAYS,
    adBudgetNote: plans.AD_BUDGET_NOTE,
    cancelHow: plans.CANCEL_HOW,
    refundPolicy: plans.REFUND_POLICY,
  };
}
async function summary(clientId) {
  const r = await row(clientId);
  const refund = (await db.query("SELECT id,status,created_at FROM billing_refund_requests WHERE client_id=$1 ORDER BY created_at DESC LIMIT 1", [clientId])).rows[0] || null;
  return view(r, { refund });
}

// Choosing a plan: the first choice starts the free trial. Later choices change the
// plan from the next charge on (no proration, no surprise). Never changes plan by itself.
async function selectPlan(clientId, planKey) {
  if (!plans.plan(planKey)) throw Error('BILLING_PLAN_UNKNOWN');
  await ensureRow(clientId);
  const r = await row(clientId);
  if (r.cancel_requested_at && LIVE.includes(r.status)) return { ok: false, reason: 'CANCEL_PENDING', message: 'המנוי בתהליך ביטול. כדי לחזור — כתבו לנו בוואטסאפ ונחדש אותו.' };
  if (!r.trial_started_at && !r.provider_subscription_id) {
    const updated = (await db.query(`UPDATE customer_subscriptions SET plan_key=$2,status='TRIAL',trial_started_at=NOW(),trial_ends_at=NOW()+make_interval(days=>$3),cancel_requested_at=NULL,access_ends_at=NULL,updated_at=NOW()
      WHERE client_id=$1 AND trial_started_at IS NULL RETURNING *`, [clientId, planKey, plans.TRIAL_DAYS])).rows[0];
    if (updated) {
      await audit(clientId, 'BILLING_TRIAL_STARTED', planKey);
      return { ok: true, trialStarted: true, summary: await summary(clientId) };
    }
  }
  const fresh = await row(clientId);
  if (fresh.plan_key === planKey) return { ok: true, unchanged: true, summary: await summary(clientId) };
  if (fresh.provider_subscription_id && LIVE.includes(fresh.status)) {
    const adapter = providers.active();
    if (!adapter || adapter.id !== fresh.provider) return { ok: false, reason: 'PROVIDER_UNAVAILABLE', message: 'לא הצלחנו לשנות מסלול כרגע. כתבו לנו בוואטסאפ ונשנה ידנית.' };
    const price = await adapter.price(planKey);
    await adapter.changePlan({ subscriptionId: fresh.provider_subscription_id, priceId: price.id });
  }
  await db.query('UPDATE customer_subscriptions SET plan_key=$2,updated_at=NOW() WHERE client_id=$1', [clientId, planKey]);
  await audit(clientId, 'BILLING_PLAN_CHANGED', planKey);
  return { ok: true, changed: true, summary: await summary(clientId) };
}

async function promptCancel(clientId) {
  await db.query('UPDATE customer_subscriptions SET cancel_prompted_at=NOW() WHERE client_id=$1', [clientId]);
  return summary(clientId);
}
// One step. The customer never has to call, email or argue. If the provider cannot be
// reached the cancellation still counts, and the team finishes it by hand.
async function cancel(clientId, { channel = 'PORTAL', requirePrompt = false } = {}) {
  if (!['PORTAL', 'WHATSAPP'].includes(channel)) throw Error('INVALID_BILLING_INPUT');
  const r = await row(clientId);
  if (r?.cancel_requested_at) return { status: 'ALREADY_CANCELLED', summary: await summary(clientId) };
  if (!cancellable(r)) return { status: 'NOTHING_TO_CANCEL', summary: await summary(clientId) };
  if (requirePrompt && !(r.cancel_prompted_at && Date.now() - new Date(r.cancel_prompted_at).getTime() < CANCEL_PROMPT_MINUTES * 60000)) return { status: 'PROMPT_REQUIRED', summary: await summary(clientId) };
  let providerStatus = 'NOT_NEEDED', endsAt = null;
  if (r.provider_subscription_id) {
    const adapter = providers.byId(r.provider);
    try {
      if (!adapter || !adapter.configured() || !providers.enabled()) throw Error('BILLING_NOT_CONFIGURED');
      endsAt = (await adapter.cancelAtPeriodEnd({ subscriptionId: r.provider_subscription_id })).endsAt;
      providerStatus = 'DONE';
    } catch (error) {
      providerStatus = 'MANUAL_REQUIRED';
      logger.warn('Provider cancel failed; manual follow-up', { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'CANCEL_FAILED' });
    }
  }
  const fallback = r.status === 'TRIAL' ? r.trial_ends_at : r.period_end;
  const accessEndsAt = endsAt || (fallback && new Date(fallback).getTime() > Date.now() ? new Date(fallback) : new Date());
  const updated = (await db.query(`UPDATE customer_subscriptions SET cancel_requested_at=NOW(),access_ends_at=$2,cancel_channel=$3,provider_cancel_status=$4,cancel_prompted_at=NULL,updated_at=NOW()
    WHERE client_id=$1 AND cancel_requested_at IS NULL RETURNING client_id`, [clientId, accessEndsAt, channel, providerStatus])).rows[0];
  if (!updated) return { status: 'ALREADY_CANCELLED', summary: await summary(clientId) };
  await audit(clientId, 'BILLING_CANCELLED', channel + ':' + providerStatus);
  if (providerStatus === 'MANUAL_REQUIRED') await notifyTeam(`⚠️ ביטול מנוי ידני נדרש: לקוח ${clientId} ביטל (${channel}). ספק הסליקה לא אישר — צריך לבטל אצל הספק כדי שלא יהיה חיוב נוסף.`, 'cancel:' + clientId);
  return { status: 'CANCELLED', providerStatus, summary: await summary(clientId) };
}

// Full refund in the first paid month, no questions asked. Recorded here; the team
// returns the money (by hand or via the provider) and is told right away.
async function requestRefund(clientId, { channel = 'PORTAL', reason = null } = {}) {
  if (!['PORTAL', 'WHATSAPP'].includes(channel)) throw Error('INVALID_BILLING_INPUT');
  if (reason != null && (typeof reason !== 'string' || reason.length > 1000 || reason.includes('\0'))) throw Error('INVALID_BILLING_INPUT');
  const r = await row(clientId);
  if (!r?.first_paid_at) return { status: 'NOT_CHARGED', summary: await summary(clientId) };
  const open = (await db.query("SELECT id,created_at FROM billing_refund_requests WHERE client_id=$1 AND status='REQUESTED'", [clientId])).rows[0];
  if (open) return { status: 'ALREADY_REQUESTED', id: open.id, summary: await summary(clientId) };
  const eligible = (await db.query("SELECT first_paid_at+INTERVAL '1 month'>NOW() AS ok FROM customer_subscriptions WHERE client_id=$1", [clientId])).rows[0]?.ok;
  if (!eligible) return { status: 'OUTSIDE_WINDOW', summary: await summary(clientId) };
  const id = crypto.randomUUID();
  const inserted = (await db.query(`INSERT INTO billing_refund_requests(id,client_id,plan_key,channel,reason) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT (client_id) WHERE status='REQUESTED' DO NOTHING RETURNING id`, [id, clientId, r.plan_key, channel, reason?.trim() || null])).rows[0];
  if (!inserted) return { status: 'ALREADY_REQUESTED', summary: await summary(clientId) };
  await audit(clientId, 'BILLING_REFUND_REQUESTED', channel);
  await notifyTeam(`💸 בקשת החזר כספי: לקוח ${clientId}, מסלול ${plans.label(r.plan_key) || 'לא ידוע'} (${channel}). לפי המדיניות — החזר מלא בלי שאלות. לסמן כטופל בדשבורד אחרי ההחזר.`, 'refund:' + id);
  return { status: 'REQUESTED', id, summary: await summary(clientId) };
}
async function refundQueue(actor) {
  if (!require('./humanSupport').operator(actor)) throw Error('SUPPORT_ACCESS_DENIED');
  return { refunds: (await db.query('SELECT id,client_id,plan_key,channel,reason,status,created_at,processed_at FROM billing_refund_requests ORDER BY created_at DESC LIMIT 100')).rows };
}
async function markRefunded(actor, id) {
  if (!require('./humanSupport').operator(actor) || !require('./workspaceService').uuid(id)) throw Error('SUPPORT_ACCESS_DENIED');
  const done = (await db.query("UPDATE billing_refund_requests SET status='REFUNDED',processed_at=NOW() WHERE id=$1 AND status='REQUESTED' RETURNING client_id", [id])).rows[0];
  if (done) await audit(done.client_id, 'BILLING_REFUNDED', 'OPERATOR');
  return { ok: !!done };
}

async function audit(clientId, event, result) {
  await db.query('INSERT INTO tenant_audit(client_id,event,result) VALUES($1,$2,$3)', [clientId, event, String(result).slice(0, 200)]);
}
// Support operators get a WhatsApp note when their 24h window is open; the
// tenant_audit row and the refund queue in the dashboard are the durable record.
async function notifyTeam(text, eventId) {
  const ids = String(process.env.SUPPORT_OPERATOR_CLIENT_IDS || '').split(',').map(x => x.trim()).filter(x => /^[1-9]\d*$/.test(x));
  for (const id of ids) {
    try {
      const op = (await db.query(`SELECT c.phone, w.last_inbound_at>NOW()-INTERVAL '24 hours' AS open FROM clients c LEFT JOIN whatsapp_contacts w ON w.phone=c.phone WHERE c.id=$1`, [id])).rows[0];
      if (!op?.phone || !op.open) continue;
      await require('./metaConnection').context.run(String(id), () => require('./whatsappDelivery').messageContext.run({ eventId: 'billing-team:' + eventId, sequence: 0, humanSupportNotice: true }, async () => {
        const delivery = require('./whatsappDelivery');
        await delivery.enqueue(op.phone, delivery.textPayload(text));
      }));
    } catch (error) { logger.warn('Billing team notice not queued', { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'NOTICE_FAILED' }); }
  }
}

function reminderText(s) {
  const lines = [`⏰ תזכורת: תקופת הניסיון שלך ב־SCORPIO מסתיימת ב־${s.trialEndsText}.`];
  if (s.paymentEnabled && s.hasPaymentMethod) lines.push(`מאז נחייב ${s.priceText} במסלול ${s.planName} — אותו מסלול שבחרת, בלי שדרוג אוטומטי.`);
  else lines.push(`המסלול שבחרת: ${s.planName}, ${s.priceText}. ${plans.NOT_ENABLED_NOTE}`);
  lines.push(plans.AD_BUDGET_NOTE, plans.CANCEL_HOW);
  return lines.join('\n');
}
// WhatsApp reminder 3 days before the trial ends, only inside the 24h window.
// Outside it the dashboard shows the same reminder (trialReminderDue).
async function runDue({ limit = 50 } = {}) {
  const due = (await db.query(`SELECT s.client_id, c.phone FROM customer_subscriptions s JOIN clients c ON c.id=s.client_id JOIN whatsapp_contacts w ON w.phone=c.phone
    WHERE s.status='TRIAL' AND s.trial_reminder_sent_at IS NULL AND s.cancel_requested_at IS NULL AND s.trial_ends_at>NOW() AND s.trial_ends_at<=NOW()+make_interval(days=>$1)
    AND w.last_inbound_at>NOW()-INTERVAL '24 hours' ORDER BY s.trial_ends_at LIMIT $2`, [plans.TRIAL_REMINDER_DAYS, limit])).rows;
  let sent = 0;
  for (const d of due) {
    const claimed = (await db.query('UPDATE customer_subscriptions SET trial_reminder_sent_at=NOW() WHERE client_id=$1 AND trial_reminder_sent_at IS NULL RETURNING client_id', [d.client_id])).rows[0];
    if (!claimed) continue;
    try {
      const text = reminderText(await summary(d.client_id));
      await require('./metaConnection').context.run(String(d.client_id), () => require('./whatsappDelivery').messageContext.run({ eventId: 'trial-reminder:' + d.client_id, sequence: 0, humanSupportNotice: false }, async () => {
        const delivery = require('./whatsappDelivery');
        await delivery.enqueue(d.phone, delivery.textPayload(text));
      }));
      sent++;
    } catch (error) {
      // Not sent (e.g. human support paused the bot): leave it to the dashboard banner and retry later.
      await db.query('UPDATE customer_subscriptions SET trial_reminder_sent_at=NULL WHERE client_id=$1', [d.client_id]);
      logger.warn('Trial reminder not queued', { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'REMINDER_FAILED' });
    }
  }
  return { sent };
}

module.exports = { summary, view, selectPlan, promptCancel, cancel, requestRefund, refundQueue, markRefunded, runDue, reminderText, hebrewDate, notifyTeam };
