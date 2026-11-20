'use strict';
// Plain-Hebrew WhatsApp notes to the support operators (SUPPORT_OPERATOR_CLIENT_IDS).
// Each alert has a key, so a failure is reported once and again only after
// OPS_ALERT_REPEAT_MINUTES (default 360), and recovery is reported once.
// Inside the operator's 24h WhatsApp window a free-text note is sent; outside it
// the approved OPS_ALERT_TEMPLATE is used when set. Every alert is also logged.
const db = require('./db');
const { logger } = require('./logger');

function operatorIds() {
  return [...new Set(String(process.env.SUPPORT_OPERATOR_CLIENT_IDS || '').split(',').map((x) => x.trim()).filter((x) => /^[1-9]\d*$/.test(x)))];
}
function repeatMs() {
  const n = Number(process.env.OPS_ALERT_REPEAT_MINUTES || 360);
  return (Number.isFinite(n) && n >= 5 && n <= 10080 ? n : 360) * 60000;
}

// Queues the note for every operator. Returns how many were queued.
async function send(text, eventId, { deliver } = {}) {
  let queued = 0;
  for (const id of operatorIds()) {
    try {
      const op = (await db.query(`SELECT c.phone, COALESCE(w.last_inbound_at>NOW()-INTERVAL '24 hours',false) AS open
        FROM clients c LEFT JOIN whatsapp_contacts w ON w.phone=c.phone WHERE c.id=$1`, [id])).rows[0];
      if (!op?.phone) continue;
      const template = process.env.OPS_ALERT_TEMPLATE;
      if (!op.open && !template) continue;
      await require('./metaConnection').context.run(String(id), () => require('./whatsappDelivery').messageContext.run({ eventId: `ops:${eventId}:${id}`, sequence: 0, humanSupportNotice: true }, async () => {
        const delivery = require('./whatsappDelivery');
        if (deliver) await deliver(op.phone, text, op.open);
        else if (op.open) await delivery.enqueue(op.phone, delivery.textPayload(text));
        else await delivery.enqueueTemplate(op.phone, template, 'he');
      }));
      queued++;
    } catch (error) {
      logger.warn('Operator alert not queued', { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'ALERT_FAILED' });
    }
  }
  return queued;
}

// Reports a failing condition. Repeats only after the repeat window.
async function fail(key, text, options = {}) {
  logger.error('Operator alert', { key });
  const row = (await db.query(`INSERT INTO ops_alerts(key,status,detail) VALUES($1,'FAILING',$2)
    ON CONFLICT(key) DO UPDATE SET status='FAILING',detail=EXCLUDED.detail,
      first_seen_at=CASE WHEN ops_alerts.status='FAILING' THEN ops_alerts.first_seen_at ELSE NOW() END
    RETURNING last_sent_at, status`, [key, String(text).slice(0, 500)])).rows[0];
  if (row.last_sent_at && Date.now() - new Date(row.last_sent_at).getTime() < repeatMs()) return { sent: 0, throttled: true };
  const sent = await send(text, `${key}:${Date.now()}`, options);
  await db.query('UPDATE ops_alerts SET last_sent_at=NOW() WHERE key=$1', [key]);
  return { sent };
}

// Clears a failing condition; tells the operators once that it recovered.
async function recover(key, text, options = {}) {
  const r = await db.query("UPDATE ops_alerts SET status='OK',last_sent_at=NULL WHERE key=$1 AND status='FAILING' RETURNING key", [key]);
  if (!r.rows.length || !text) return { sent: 0 };
  return { sent: await send(text, `${key}:ok:${Date.now()}`, options) };
}

// One-time notice (e.g. a customer passed 80% of the AI budget this month).
async function once(key, text, options = {}) {
  const r = await db.query("INSERT INTO ops_alerts(key,status,detail,last_sent_at) VALUES($1,'SENT',$2,NOW()) ON CONFLICT(key) DO NOTHING RETURNING key", [key, String(text).slice(0, 500)]);
  if (!r.rows.length) return { sent: 0, already: true };
  logger.warn('Operator notice', { key });
  return { sent: await send(text, key, options) };
}

module.exports = { operatorIds, send, fail, recover, once };
