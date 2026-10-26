'use strict';
const { query, transaction } = require('./db');

function extractInboundEvents(body) {
  const events = [];
  if (body?.object !== 'whatsapp_business_account') return events;

  for (const entry of Array.isArray(body.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (change?.field !== 'messages') continue;
      const value = change.value || {};
      if (process.env.WHATSAPP_PHONE_NUMBER_ID && value.metadata?.phone_number_id!==process.env.WHATSAPP_PHONE_NUMBER_ID) {
        const error=Error('Wrong WhatsApp receiver');error.code='INVALID_WHATSAPP_EVENT';throw error;
      }
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const messages = Array.isArray(value.messages) ? value.messages : [];

      for (const message of messages) {
        if (!message || typeof message.id !== 'string' || !message.id.trim() ||
            message.id.length > 512 || typeof message.from !== 'string' ||
            !message.from.trim()) {
          const error = new Error('Invalid WhatsApp inbound message');
          error.code = 'INVALID_WHATSAPP_EVENT';
          throw error;
        }
        const contact = contacts.find(item => String(item?.wa_id || '') === message.from) || {};
        events.push({
          eventId: message.id,
          payload: {
            message,
            contact: { profile: { name: String(contact?.profile?.name || '').slice(0, 200) } }
          }
        });
      }
    }
  }
  return events;
}

async function enqueueInboundEvents(events, suppliedTx = null) {
  if (!Array.isArray(events) || events.length === 0) return { inserted: 0 };
  const work = async tx => {
    let inserted = 0;
    for (const event of events) {
      const result = await tx(
        `INSERT INTO whatsapp_inbound_events (event_id, payload)
         VALUES ($1, $2::jsonb)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [event.eventId, JSON.stringify(event.payload)]
      );
      inserted += result.rowCount;
    }
    return { inserted };
  };
  return suppliedTx ? work(suppliedTx) : transaction(work);
}

async function claimNextInboundEvent() {
  return transaction(async tx => {
    const selected = await tx(
      `SELECT e.event_id,e.payload FROM whatsapp_inbound_events e
       WHERE e.status='PENDING' AND e.available_at<=NOW()
       AND NOT EXISTS(SELECT 1 FROM whatsapp_inbound_events busy WHERE busy.status='PROCESSING' AND busy.payload->'message'->>'from'=e.payload->'message'->>'from')
       ORDER BY e.ingest_order
       FOR UPDATE SKIP LOCKED
       LIMIT 20`
    );
    for(const candidate of selected.rows){
    const sender=String(candidate.payload?.message?.from||'');
    const lock=await tx('SELECT pg_try_advisory_xact_lock(hashtextextended($1,874223007)) AS locked',[sender]);
    if(!lock.rows[0]?.locked)continue;
    const busy=await tx("SELECT event_id FROM whatsapp_inbound_events WHERE status='PROCESSING' AND payload->'message'->>'from'=$1 LIMIT 1",[sender]);
    if(busy.rows.length)continue;
    const eventId = candidate.event_id;
    const claimed = await tx(
      `UPDATE whatsapp_inbound_events
       SET status = 'PROCESSING', attempts = attempts + 1,
           locked_until = NOW() + INTERVAL '5 minutes', updated_at = NOW()
       WHERE event_id = $1 AND status = 'PENDING'
       RETURNING event_id, payload`,
      [eventId]
    );
    return claimed.rows[0] || null;
    }
    return null;
  });
}

async function markInboundDone(eventId) {
  await query(
    `UPDATE whatsapp_inbound_events
     SET status = 'DONE', payload = '{}'::jsonb, last_error = NULL,
         locked_until = NULL, updated_at = NOW()
     WHERE event_id = $1 AND status = 'PROCESSING'`,
    [eventId]
  );
}

async function markInboundForReview(eventId, reason = 'HANDLER_FAILED') {
  await query(
    `UPDATE whatsapp_inbound_events
     SET status = 'MANUAL_REVIEW', payload = '{}'::jsonb, last_error = $2,
         locked_until = NULL, updated_at = NOW()
     WHERE event_id = $1 AND status = 'PROCESSING'`,
    [eventId, String(reason).slice(0, 80)]
  );
}

async function markExpiredInboundForReview() {
  const result = await query(
    `UPDATE whatsapp_inbound_events
     SET status = 'MANUAL_REVIEW', payload = '{}'::jsonb,
         last_error = 'PROCESSING_OUTCOME_UNKNOWN', locked_until = NULL,
         updated_at = NOW()
     WHERE status = 'PROCESSING' AND locked_until <= NOW()`
  );
  return result.rowCount;
}

module.exports = {
  extractInboundEvents,
  enqueueInboundEvents,
  claimNextInboundEvent,
  markInboundDone,
  markInboundForReview,
  markExpiredInboundForReview
};
