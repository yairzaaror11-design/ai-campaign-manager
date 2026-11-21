'use strict';
// Tells Meta what happened to each lead (contacted, meeting, sale) through the
// Conversions API for CRM. Only Meta's own lead id and the sale value are sent:
// no names, phones or emails leave the system. Meta then optimises delivery for
// people who become customers rather than for raw form fills.
const crypto = require('node:crypto');
const axios = require('axios');
const db = require('./db');
const { logger } = require('./logger');

const enabled = () => process.env.META_CRM_FEEDBACK_ENABLED === 'true';
// A readable failure reason and whether retrying can help. Meta error codes 1, 2, 4, 17,
// 341 and 613 (and HTTP 5xx / no answer) are temporary; other Graph errors (bad parameter,
// expired token, missing permission) will fail the same way again.
const TRANSIENT = [1, 2, 4, 17, 32, 341, 613];
function failure(error) {
  if (/^[A-Z_]+$/.test(error?.message || '')) return { reason: error.message, permanent: false };
  const status = error?.response?.status, code = Number(error?.response?.data?.error?.code);
  if (!status) return { reason: 'META_NO_ANSWER', permanent: false };
  if (status >= 500 || TRANSIENT.includes(code)) return { reason: 'META_TEMPORARY_' + (code || status), permanent: false };
  return { reason: 'META_ERROR_' + (code || status), permanent: true };
}
const EVENT = { NEW: 'Lead', CONTACTED: 'Contacted', APPOINTMENT: 'Qualified', WON: 'Converted' };
// A sale is reported after a short delay so the amount the owner types next is included.
const DELAY = { WON: 30 };
const MAX_ATTEMPTS = 5;

// Called inside the CRM transaction so the stage and its report commit together.
async function enqueue(tx, lead) {
  await enqueueWebPurchase(tx, lead);
  if (!enabled() || lead?.source !== 'meta_lead_ads' || !/^\d{1,40}$/.test(lead.source_event_id || '') || !EVENT[lead.status]) return false;
  const r = await tx(`INSERT INTO meta_crm_events(lead_id,stage,client_id,meta_lead_id,available_at)
    VALUES($1,$2,$3,$4,NOW()+make_interval(mins=>$5)) ON CONFLICT DO NOTHING RETURNING lead_id`,
    [lead.id, lead.status, lead.client_id, lead.source_event_id, DELAY[lead.status] || 0]);
  return r.rows.length > 0;
}

// The account's first pixel/dataset receives the events; looked up once a week.
async function datasetFor(clientId, credentials) {
  const account = credentials.meta_ad_account_id;
  if (!account) return null;
  const cached = (await db.query(`SELECT dataset_id FROM meta_crm_datasets WHERE client_id=$1 AND ad_account_id=$2 AND checked_at>NOW()-INTERVAL '7 days'`, [clientId, account])).rows[0];
  if (cached) return cached.dataset_id;
  const meta = require('./metaConnection');
  const list = await meta.graph('/' + account + '/adspixels', credentials.token, { fields: 'id', limit: 5 });
  const id = list.data?.map((p) => String(p.id)).find((x) => /^\d{1,40}$/.test(x)) || null;
  await db.query(`INSERT INTO meta_crm_datasets(client_id,ad_account_id,dataset_id) VALUES($1,$2,$3)
    ON CONFLICT(client_id) DO UPDATE SET ad_account_id=$2,dataset_id=$3,checked_at=NOW()`, [clientId, account, id]);
  return id;
}

// lead_id is a 15–17 digit number: written into the JSON as raw digits, never through a JS number.
function payload(row, lead) {
  const custom = { event_source: 'crm', lead_event_source: 'SCORPIO AI' };
  if (row.stage === 'WON' && lead?.revenue_minor > 0 && lead.currency) { custom.value = Number(lead.revenue_minor) / 100; custom.currency = lead.currency; }
  return '[{"event_name":' + JSON.stringify(EVENT[row.stage]) + ',"event_time":' + Math.floor(new Date(row.event_time).getTime() / 1000) +
    ',"action_source":"system_generated","user_data":{"lead_id":' + row.meta_lead_id + '},"custom_data":' + JSON.stringify(custom) + '}]';
}

async function send(row) {
  const meta = require('./metaConnection');
  let c;
  try { c = await meta.credentials(row.client_id); } catch { return { status: 'SKIPPED', reason: 'NO_META_CONNECTION' }; }
  const dataset = await datasetFor(row.client_id, c);
  if (!dataset) return { status: 'SKIPPED', reason: 'NO_DATASET' };
  const lead = (await db.query('SELECT revenue_minor,currency FROM crm_leads WHERE id=$1 AND client_id=$2', [row.lead_id, row.client_id])).rows[0];
  const proof = crypto.createHmac('sha256', process.env.META_APP_SECRET).update(c.token).digest('hex');
  const r = (await axios.post('https://graph.facebook.com/' + meta.config().version + '/' + dataset + '/events',
    new URLSearchParams({ data: payload(row, lead) }),
    { headers: { Authorization: 'Bearer ' + c.token }, params: { appsecret_proof: proof }, timeout: 15000, maxRedirects: 0 })).data;
  if (!(r?.events_received >= 1)) throw Error('META_CRM_EVENT_NOT_RECEIVED');
  return { status: 'SENT' };
}

async function runDue({ limit = 20 } = {}) {
  await runWebDue({ limit }).catch((error) => logger.warn('Web conversions not sent', { reason: /^[A-Z_]+$/.test(error?.message || '') ? error.message : 'WEB_CAPI_FAILED' }));
  if (!enabled()) return 0;
  const due = (await db.query(`SELECT * FROM meta_crm_events WHERE status='PENDING' AND available_at<=NOW() ORDER BY available_at LIMIT $1`, [limit])).rows;
  for (const row of due) {
    let outcome;
    try { outcome = await send(row); }
    catch (error) {
      const f = failure(error);
      outcome = f.permanent || row.attempts + 1 >= MAX_ATTEMPTS ? { status: 'FAILED', reason: f.reason } : { status: 'PENDING', reason: f.reason };
      logger.warn('CRM event to Meta not sent', { stage: row.stage, attempt: row.attempts + 1, reason: f.reason });
    }
    await db.query(`UPDATE meta_crm_events SET status=$3,reason=$4,attempts=attempts+1,
      available_at=NOW()+make_interval(mins=>$5) WHERE lead_id=$1 AND stage=$2 AND status='PENDING'`,
      [row.lead_id, row.stage, outcome.status, outcome.reason || null, 10 * 2 ** row.attempts]);
  }
  return due.length;
}

// ---------- Website and webhook leads: Pixel + Conversions API ----------
// A lead from a landing page (or a webhook that says the visitor agreed to measurement)
// is reported to the business's own pixel as "Lead" with the same event_id the browser
// pixel used, so Meta counts it once. A closed deal is reported as "Purchase" with its
// value. Nothing is sent without the visitor's measurement consent; identifiers are
// SHA-256 hashed and the stored copy is cleared once the event is sent.
const webEnabled = () => process.env.META_CAPI_ENABLED !== 'false';
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
function hashedPhone(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '972' + d.slice(1);
  return d.length >= 8 ? sha(d) : null;
}
function userData({ email, phone, ip, userAgent, fbp, fbc } = {}) {
  const u = {};
  const em = String(email || '').trim().toLowerCase();
  if (em) u.em = [sha(em)];
  const ph = hashedPhone(phone);
  if (ph) u.ph = [ph];
  if (typeof ip === 'string' && ip.length <= 64) u.client_ip_address = ip;
  if (typeof userAgent === 'string' && userAgent.length <= 400) u.client_user_agent = userAgent;
  if (typeof fbp === 'string' && /^fb\.\d\.\d{10,16}\.\d{1,20}$/.test(fbp)) u.fbp = fbp;
  if (typeof fbc === 'string' && /^fb\.\d\.\d{10,16}\.[A-Za-z0-9_-]{1,500}$/.test(fbc)) u.fbc = fbc;
  return u;
}
async function pixelFor(q, clientId) {
  return (await q('SELECT pixel_id FROM business_channels WHERE client_id=$1', [clientId])).rows[0]?.pixel_id || null;
}
// After a website/webhook lead is saved. Returns true when an event was queued.
async function enqueueWebLead(lead, { eventId, url = null, email, phone, ip, userAgent, fbp, fbc } = {}) {
  if (!webEnabled() || !lead?.id || !lead.measurement_consent || !/^[A-Za-z0-9:_-]{8,80}$/.test(eventId || '')) return false;
  const pixel = await pixelFor(db.query, lead.client_id);
  if (!pixel) return false;
  const r = await db.query(`INSERT INTO meta_capi_events(lead_id,stage,client_id,pixel_id,event_id,event_source_url,user_data)
    VALUES($1,'LEAD',$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING RETURNING lead_id`,
  [lead.id, lead.client_id, pixel, eventId, url ? String(url).slice(0, 500) : null, JSON.stringify(userData({ email: email ?? lead.email, phone: phone ?? lead.phone, ip, userAgent, fbp, fbc }))]);
  return r.rows.length > 0;
}
// A closed deal on a consented website lead: "Purchase" with value, after the amount is typed.
async function enqueueWebPurchase(tx, lead) {
  if (!webEnabled() || lead?.status !== 'WON' || !lead.measurement_consent || lead.source === 'meta_lead_ads') return false;
  const pixel = await pixelFor(tx, lead.client_id);
  if (!pixel) return false;
  // Browser ids kept on the lead (with consent) let Meta match the sale to the ad click.
  const u = userData({ email: lead.email, phone: lead.phone, fbp: lead.utm?.fbp, fbc: lead.utm?.fbc });
  const r = await tx(`INSERT INTO meta_capi_events(lead_id,stage,client_id,pixel_id,event_id,user_data,available_at)
    VALUES($1,'PURCHASE',$2,$3,$4,$5::jsonb,NOW()+make_interval(mins=>$6)) ON CONFLICT DO NOTHING RETURNING lead_id`,
  [lead.id, lead.client_id, pixel, 'purchase:' + lead.id, JSON.stringify(u), DELAY.WON]);
  return r.rows.length > 0;
}
// Conversions API rules (developers.facebook.com/docs/marketing-api/conversions-api/parameters):
// a "website" event must carry event_source_url and client_user_agent; a lead that reached us
// without them (a webhook from another site) is reported as system_generated. The browser pixel
// fires Lead with eventID = the same event_id, so Meta keeps one of the two (event_name + event_id).
// Purchase requires value and currency; a closed deal is sent only once its amount is known.
function webPayload(row, lead) {
  const purchase = row.stage === 'PURCHASE';
  const u = row.user_data || {};
  const website = !purchase && !!row.event_source_url && !!u.client_user_agent;
  const event = { event_name: purchase ? 'Purchase' : 'Lead', event_time: Math.floor(new Date(row.event_time).getTime() / 1000), event_id: row.event_id,
    action_source: website ? 'website' : 'system_generated', user_data: u, custom_data: { lead_event_source: 'SCORPIO AI' } };
  if (website) event.event_source_url = row.event_source_url;
  if (lead?.catalog_item_id) { event.custom_data.content_ids = [lead.catalog_item_id]; event.custom_data.content_type = 'product'; }
  if (purchase) { event.custom_data.value = Number(lead.revenue_minor) / 100; event.custom_data.currency = lead.currency; }
  return JSON.stringify([event]);
}
async function sendWeb(row) {
  const meta = require('./metaConnection');
  let c;
  try { c = await meta.credentials(row.client_id); } catch { return { status: 'SKIPPED', reason: 'NO_META_CONNECTION' }; }
  const lead = (await db.query('SELECT revenue_minor,currency,catalog_item_id,measurement_consent FROM crm_leads WHERE id=$1 AND client_id=$2', [row.lead_id, row.client_id])).rows[0];
  if (!lead?.measurement_consent) return { status: 'SKIPPED', reason: 'NO_CONSENT' };
  // Meta rejects the whole request when an event is older than 7 days.
  if (Date.now() - new Date(row.event_time).getTime() > 6.5 * 86400000) return { status: 'SKIPPED', reason: 'EVENT_TOO_OLD' };
  if (row.stage === 'PURCHASE' && !(Number(lead.revenue_minor) > 0 && /^[A-Z]{3}$/.test(lead.currency || ''))) return { status: 'WAIT', reason: 'WAITING_FOR_SALE_AMOUNT' };
  const proof = crypto.createHmac('sha256', process.env.META_APP_SECRET).update(c.token).digest('hex');
  const r = (await axios.post('https://graph.facebook.com/' + meta.config().version + '/' + row.pixel_id + '/events',
    new URLSearchParams({ data: webPayload(row, lead) }),
    { headers: { Authorization: 'Bearer ' + c.token }, params: { appsecret_proof: proof }, timeout: 15000, maxRedirects: 0 })).data;
  if (!(r?.events_received >= 1)) throw Error('META_CAPI_EVENT_NOT_RECEIVED');
  return { status: 'SENT' };
}
async function runWebDue({ limit = 20 } = {}) {
  if (!webEnabled()) return 0;
  const due = (await db.query(`SELECT * FROM meta_capi_events WHERE status='PENDING' AND available_at<=NOW() ORDER BY available_at LIMIT $1`, [limit])).rows;
  for (const row of due) {
    let outcome;
    try { outcome = await sendWeb(row); }
    catch (error) {
      const f = failure(error);
      outcome = f.permanent || row.attempts + 1 >= MAX_ATTEMPTS ? { status: 'FAILED', reason: f.reason } : { status: 'PENDING', reason: f.reason };
      logger.warn('Web conversion not sent', { stage: row.stage, attempt: row.attempts + 1, reason: f.reason });
    }
    if (outcome.status === 'WAIT') {
      // Not an attempt: check again in an hour, until the 7-day limit skips it.
      await db.query(`UPDATE meta_capi_events SET reason=$3,available_at=NOW()+INTERVAL '1 hour' WHERE lead_id=$1 AND stage=$2 AND status='PENDING'`, [row.lead_id, row.stage, outcome.reason]);
      continue;
    }
    await db.query(`UPDATE meta_capi_events SET status=$3,reason=$4,attempts=attempts+1,available_at=NOW()+make_interval(mins=>$5),
      user_data=CASE WHEN $3='PENDING' THEN user_data ELSE '{}'::jsonb END WHERE lead_id=$1 AND stage=$2 AND status='PENDING'`,
    [row.lead_id, row.stage, outcome.status, outcome.reason || null, 10 * 2 ** row.attempts]);
  }
  return due.length;
}

// For the connections screen: what was sent to Meta, what is waiting and what failed (and why).
async function status(clientId) {
  const one = async (table) => {
    const rows = (await db.query(`SELECT status,COUNT(*)::int AS n FROM ${table} WHERE client_id=$1 GROUP BY status`, [clientId])).rows;
    const last = (await db.query(`SELECT reason FROM ${table} WHERE client_id=$1 AND status='FAILED' AND reason IS NOT NULL ORDER BY available_at DESC LIMIT 1`, [clientId])).rows[0];
    const by = Object.fromEntries(rows.map((r) => [r.status.toLowerCase(), r.n]));
    return { sent: by.sent || 0, pending: by.pending || 0, skipped: by.skipped || 0, failed: by.failed || 0, lastFailure: last?.reason || null };
  };
  return { website: { enabled: webEnabled(), ...(await one('meta_capi_events')) }, crm: { enabled: enabled(), ...(await one('meta_crm_events')) } };
}

module.exports = { failure, status, enabled, enqueue, runDue, payload, EVENT, webEnabled, userData, enqueueWebLead, enqueueWebPurchase, webPayload, runWebDue };
