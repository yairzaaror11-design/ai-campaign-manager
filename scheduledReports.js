'use strict';
// Proactive weekly business report: every Sunday from 09:00 Israel time, each
// active client gets the report once. Inside the 24-hour WhatsApp window it is the
// full report; outside it, an approved template (opted-in owners only) invites them.
const db = require('./db');
const { logger } = require('./logger');

const enabled = () => process.env.WEEKLY_REPORTS_ENABLED === 'true';

// Local Israel time parts without extra dependencies.
function israelNow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).map((p) => [p.type, p.value]));
  return { weekday: parts.weekday, hour: Number(parts.hour), date: `${parts.year}-${parts.month}-${parts.day}` };
}

const due = (now = new Date()) => { const t = israelNow(now); return t.weekday === 'Sun' && t.hour >= 9; };
const periodKey = (now = new Date()) => 'week:' + israelNow(now).date;

// Clients with something to report: a connected ad account or leads in the last 30 days.
async function candidates(key, limit = 20) {
  return (await db.query(`SELECT c.id, c.phone, w.opted_in, w.last_inbound_at>NOW()-INTERVAL '24 hours' AS open
    FROM clients c LEFT JOIN whatsapp_contacts w ON w.phone=c.phone
    WHERE (c.meta_ad_account_id IS NOT NULL OR EXISTS(SELECT 1 FROM crm_leads l WHERE l.client_id=c.id AND l.created_at>NOW()-INTERVAL '30 days'))
      AND NOT EXISTS(SELECT 1 FROM scheduled_reports s WHERE s.client_id=c.id AND s.period_key=$1)
    ORDER BY c.id LIMIT $2`, [key, limit])).rows;
}

async function sendOne(client, key, { build = require('./businessReport').businessReport } = {}) {
  // Claim first so a crash never sends twice.
  const claim = await db.query("INSERT INTO scheduled_reports(client_id,period_key,status) VALUES($1,$2,'SKIPPED') ON CONFLICT DO NOTHING RETURNING client_id", [client.id, key]);
  if (!claim.rows.length) return 'ALREADY_DONE';
  const template = process.env.WEEKLY_REPORT_TEMPLATE;
  let status = 'SKIPPED';
  try {
    status = await require('./metaConnection').context.run(String(client.id), () =>
      require('./whatsappDelivery').messageContext.run({ eventId: 'weekly-report:' + key + ':' + client.id, sequence: 0 }, async () => {
        const delivery = require('./whatsappDelivery');
        if (client.open) { await delivery.enqueue(client.phone, delivery.textPayload(await build(client.id, 'last_7d'))); return 'SENT'; }
        if (template && client.opted_in) { await delivery.enqueueTemplate(client.phone, template, process.env.WEEKLY_REPORT_TEMPLATE_LANGUAGE || 'he'); return 'TEMPLATE_SENT'; }
        return 'SKIPPED';
      }));
  } catch (error) {
    logger.warn('Weekly report not queued', { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'REPORT_FAILED' });
  }
  await db.query('UPDATE scheduled_reports SET status=$3 WHERE client_id=$1 AND period_key=$2', [client.id, key, status]);
  return status;
}

async function runDue({ now = new Date(), build } = {}) {
  if (!enabled() || !db.configured() || !due(now)) return { status: 'NOT_DUE' };
  const key = periodKey(now);
  const results = [];
  for (const client of await candidates(key)) results.push(await sendOne(client, key, { build }));
  return { status: 'RAN', results };
}

module.exports = { enabled, due, periodKey, israelNow, runDue, sendOne };
