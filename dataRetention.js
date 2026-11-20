'use strict';
// Retention rules that need more than a DELETE (see docs/OPERATIONS.md, "Data retention"):
// - An inactive marketing profile is deleted only after the owner was warned
//   at least 7 days earlier. The warning has a "keep my data" button.
// - The audit record (who approved what, when) is kept AUDIT_RETENTION_DAYS
//   (default 7 years); conversation content still goes after DATA_RETENTION_DAYS.
const db = require('./db');
const { logger } = require('./logger');

const NOTICE_DAYS = 7;
const KEEP_BUTTON_ID = 'retention:keep';
const KEEP_TEXT = 'שמור את המידע שלי';
const KEEP_PATTERN = /^(?:שמור|שמרו|תשמור|תשמרו)\s+את\s+(?:המידע|הנתונים)\s+שלי[.!]?$/u;

function auditRetentionDays() {
  const n = Number(process.env.AUDIT_RETENTION_DAYS || 2557);
  if (!Number.isInteger(n) || n < 365 || n > 3650) throw Error('INVALID_AUDIT_RETENTION_DAYS');
  return n;
}

function noticeText(days) {
  return `🗂️ שמנו לב שלא עבדנו יחד על השיווק כבר הרבה זמן.\nלפי מדיניות הפרטיות, בעוד ${NOTICE_DAYS} ימים נמחק את פרטי השיווק ששמרנו על העסק (קהל, מסרים והעדפות) – כי לא נעשה בהם שימוש ${days} ימים.\nרוצים שנשמור אותם? לחצו על הכפתור או כתבו "${KEEP_TEXT}".`;
}
function buttonPayload(text) {
  return { type: 'interactive', interactive: { type: 'button', body: { text }, action: { buttons: [{ type: 'reply', reply: { id: KEEP_BUTTON_ID, title: 'שמרו את המידע שלי' } }] } } };
}

// Default delivery: a button inside the 24h window, the approved template outside it.
async function deliver(client, text) {
  const delivery = require('./whatsappDelivery');
  return require('./metaConnection').context.run(String(client.id), () => delivery.messageContext.run({ eventId: `retention:${client.id}:${new Date().toISOString().slice(0, 10)}`, sequence: 0, humanSupportNotice: true }, async () => {
    if (client.window_open) { await delivery.enqueue(client.phone, buttonPayload(text)); return 'CHAT'; }
    const template = process.env.DATA_RETENTION_TEMPLATE;
    if (template) { await delivery.enqueueTemplate(client.phone, template, 'he'); return 'TEMPLATE'; }
    return 'UNREACHABLE';
  }));
}

// Warns owners whose profile will reach the retention age within 7 days.
// The notice time is recorded first, so the deletion clock starts even when the
// owner cannot be reached; deletion then waits at least 7 days after it.
async function warnDue({ send = deliver, limit = 50 } = {}) {
  if (!db.configured()) return { status: 'NOT_CONFIGURED' };
  const days = require('./maintenance').retentionDays();
  const due = (await db.query(`UPDATE marketing_profiles m SET retention_notice_at=NOW()
      FROM clients c LEFT JOIN whatsapp_contacts w ON w.phone=c.phone
     WHERE c.id=m.client_id AND m.client_id IN (
       SELECT client_id FROM marketing_profiles
        WHERE updated_at < NOW()-(GREATEST($1::integer-${NOTICE_DAYS},0)*INTERVAL '1 day')
          AND (retention_notice_at IS NULL OR retention_notice_at < updated_at)
        ORDER BY updated_at LIMIT $2)
     RETURNING c.id, c.phone, COALESCE(w.last_inbound_at>NOW()-INTERVAL '24 hours',false) AS window_open`, [days, limit])).rows;
  const results = [];
  for (const client of due) {
    let channel = 'FAILED';
    try { channel = await send(client, noticeText(days)); } catch (error) {
      logger.warn('Retention notice not queued', { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'NOTICE_FAILED' });
    }
    await db.query("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'RETENTION_NOTICE',$2)", [client.id, channel]);
    results.push(channel);
  }
  return { status: 'RAN', results };
}

// "Keep my data": marks the profile active again and clears the notice.
async function keep(clientId) {
  const r = await db.query('UPDATE marketing_profiles SET updated_at=NOW(), retention_notice_at=NULL WHERE client_id=$1 RETURNING client_id', [clientId]);
  await db.query("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'RETENTION_KEEP',$2)", [clientId, r.rows.length ? 'KEPT' : 'NO_PROFILE']);
  return r.rows.length > 0;
}

async function handleText(from, text) {
  if (!KEEP_PATTERN.test(String(text || '').trim()) || !db.configured()) return null;
  const tenant = require('./metaConnection').context.getStore();
  const clientId = /^[1-9]\d*$/.test(String(tenant || '')) ? String(tenant)
    : (await db.query('SELECT id FROM clients WHERE phone=$1', [require('./auth').normalizePhone(from)])).rows[0]?.id;
  if (!clientId) return null;
  const kept = await keep(clientId);
  return { reply: kept ? 'שמרתי ✅ פרטי השיווק של העסק נשארים אצלנו, ואפשר להמשיך מאיפה שעצרנו.' : 'אין כרגע פרטי שיווק שממתינים למחיקה, הכול שמור.' };
}

// SQL used by maintenance.maintain() inside its transaction.
async function deleteExpired(tx, days) {
  await tx(`DELETE FROM marketing_profiles WHERE updated_at<NOW()-($1::integer*INTERVAL '1 day')
    AND retention_notice_at IS NOT NULL AND retention_notice_at>=updated_at
    AND retention_notice_at<=NOW()-INTERVAL '${NOTICE_DAYS} days'`, [days]);
}

module.exports = { warnDue, keep, handleText, deleteExpired, auditRetentionDays, noticeText, buttonPayload, NOTICE_DAYS, KEEP_BUTTON_ID, KEEP_TEXT };
