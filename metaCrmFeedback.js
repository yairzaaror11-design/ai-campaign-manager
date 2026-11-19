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
const EVENT = { NEW: 'Lead', CONTACTED: 'Contacted', APPOINTMENT: 'Qualified', WON: 'Converted' };
// A sale is reported after a short delay so the amount the owner types next is included.
const DELAY = { WON: 30 };
const MAX_ATTEMPTS = 5;

// Called inside the CRM transaction so the stage and its report commit together.
async function enqueue(tx, lead) {
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
  if (!enabled()) return 0;
  const due = (await db.query(`SELECT * FROM meta_crm_events WHERE status='PENDING' AND available_at<=NOW() ORDER BY available_at LIMIT $1`, [limit])).rows;
  for (const row of due) {
    let outcome;
    try { outcome = await send(row); }
    catch (error) {
      const code = /^[A-Z_]+$/.test(error?.message || '') ? error.message : 'META_CRM_SEND_FAILED';
      outcome = row.attempts + 1 >= MAX_ATTEMPTS ? { status: 'FAILED', reason: code } : { status: 'PENDING', reason: code };
      logger.warn('CRM event to Meta not sent', { stage: row.stage, attempt: row.attempts + 1, reason: code });
    }
    await db.query(`UPDATE meta_crm_events SET status=$3,reason=$4,attempts=attempts+1,
      available_at=NOW()+make_interval(mins=>$5) WHERE lead_id=$1 AND stage=$2 AND status='PENDING'`,
      [row.lead_id, row.stage, outcome.status, outcome.reason || null, 10 * 2 ** row.attempts]);
  }
  return due.length;
}

module.exports = { enabled, enqueue, runDue, payload, EVENT };
