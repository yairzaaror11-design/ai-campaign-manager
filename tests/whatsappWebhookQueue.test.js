'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeDatabase, query, closeDatabase } = require('../db');
const {
  extractInboundEvents,
  enqueueInboundEvents,
  claimNextInboundEvent
} = require('../whatsappInboundStore');
const { runOne } = require('../whatsappWebhookWorker');

const enabled = Boolean(process.env.TEST_DATABASE_URL);

test('WhatsApp inbound events are deduplicated, durably claimed, and never auto-replayed after uncertain processing', { skip: !enabled }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DB_SSL = 'false';
  await initializeDatabase();

  const eventId = 'wamid.' + randomUUID();
  const failedId = 'wamid.' + randomUUID();
  const rapidIds = [randomUUID(),randomUUID(),randomUUID()];
  const body = {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          contacts: [{ wa_id: '972555000001', profile: { name: 'Test' } }],
          messages: [{ id: eventId, from: '972555000001', type: 'text', text: { body: 'hello' } }]
        }
      }]
    }]
  };

  try {
    const events = extractInboundEvents(body);
    assert.equal(events.length, 1);
    assert.equal(events[0].payload.contact.profile.name, 'Test');
    assert.throws(() => extractInboundEvents({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: { messages: [{ from: '1' }] } }] }]
    }), { code: 'INVALID_WHATSAPP_EVENT' });

    const first = await enqueueInboundEvents(events);
    const duplicate = await enqueueInboundEvents(events);
    assert.deepEqual(first, { inserted: 1 });
    assert.deepEqual(duplicate, { inserted: 0 });

    const claimed = await Promise.all([
      claimNextInboundEvent(),
      claimNextInboundEvent()
    ]);
    const active = claimed.filter(Boolean);
    assert.equal(active.length, 1);
    assert.equal(active[0].event_id, eventId);

    const seen = [];
    const run = await runOne({ handler: async message => seen.push(message.id) });
    assert.equal(run.status, 'IDLE');

    await query(
      `UPDATE whatsapp_inbound_events
       SET status = 'PENDING', locked_until = NULL
       WHERE event_id = $1`,
      [eventId]
    );
    const processed = await runOne({ handler: async message => seen.push(message.id) });
    assert.equal(processed.status, 'DONE');
    assert.deepEqual(seen, [eventId]);
    const again = await runOne({ handler: async message => seen.push(message.id) });
    assert.equal(again.status, 'IDLE');
    assert.deepEqual(seen, [eventId]);

    await enqueueInboundEvents([{
      eventId: failedId,
      payload: { message: { id: failedId, from: '972555000001' }, contact: {} }
    }]);
    const failed = await runOne({ handler: async () => { throw new Error('private payload omitted'); } });
    assert.equal(failed.status, 'MANUAL_REVIEW');

    // Independent PostgreSQL transactions race for the same sender; only its oldest event may run.
    await enqueueInboundEvents(rapidIds.map((id,i)=>({eventId:id,payload:{message:{id,from:i<2?'972555000003':'972555000004'},contact:{}}})));
    const racing=(await Promise.all([claimNextInboundEvent(),claimNextInboundEvent(),claimNextInboundEvent()])).filter(Boolean);
    assert.equal(racing.filter(r=>r.payload.message.from==='972555000003').length,1);
    assert.ok(racing.some(r=>r.event_id===rapidIds[0]));assert.ok(!racing.some(r=>r.event_id===rapidIds[1]));
    await query("UPDATE whatsapp_inbound_events SET status='DONE' WHERE event_id=ANY($1::text[])",[racing.map(r=>r.event_id)]);
    assert.equal((await claimNextInboundEvent()).event_id,rapidIds[1]);

    const rows = await query(
      `SELECT event_id, status, payload, last_error
       FROM whatsapp_inbound_events WHERE event_id = ANY($1::text[])`,
      [[eventId, failedId]]
    );
    const byId = new Map(rows.rows.map(row => [row.event_id, row]));
    assert.equal(byId.get(eventId).status, 'DONE');
    assert.deepEqual(byId.get(eventId).payload, {});
    assert.equal(byId.get(failedId).status, 'MANUAL_REVIEW');
    assert.deepEqual(byId.get(failedId).payload, {});
    assert.equal(byId.get(failedId).last_error, 'HANDLER_FAILED');
  } finally {
    await query(
      'DELETE FROM whatsapp_inbound_events WHERE event_id = ANY($1::text[])',
      [[eventId, failedId,...rapidIds]]
    );
    await closeDatabase();
  }
});
