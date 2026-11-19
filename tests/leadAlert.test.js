'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('./helpers/isolatedDatabase');
const alert = require('../leadAlert');

test('Israeli numbers become one-tap WhatsApp links with a ready reply', () => {
  assert.equal(alert.waNumber('052-123-4567'), '972521234567');
  assert.equal(alert.waNumber('+972 52 123 4567'), '972521234567');
  assert.equal(alert.waNumber('12'), null);
  const reply = alert.suggestedReply({ name: 'דנה כהן' }, 'מספרת שירן');
  assert.equal(reply, 'היי דנה, כאן ממספרת שירן. ראינו שהשארת פרטים, תודה! מתי נוח לך לדבר כמה דקות?');
  const text = alert.alertText({ name: 'דנה כהן', phone: '0521234567' }, reply);
  assert.match(text, /ליד חדש/);
  assert.match(text, /https:\/\/wa\.me\/972521234567\?text=/);
  assert.ok(!alert.alertText({ name: 'x' }, reply).includes('wa.me'), 'no link without a phone');
});

test('the owner is alerted once per lead inside the WhatsApp window', async () => {
  const { db, close } = await openDatabase();
  try {
    const client = (await db.query("INSERT INTO clients(phone) VALUES('972500000091') RETURNING id")).rows[0].id;
    await db.query("INSERT INTO whatsapp_contacts(phone,last_inbound_at) VALUES('972500000091',NOW())");
    const lead = { id: '11111111-1111-1111-1111-111111111111', name: 'דנה כהן', phone: '0521234567' };
    assert.equal((await alert.notifyOwner(client, lead)).status, 'QUEUED');
    await alert.notifyOwner(client, lead);
    const rows = (await db.query('SELECT payload FROM whatsapp_outbox WHERE client_id=$1', [client])).rows;
    assert.equal(rows.length, 1, 'a repeated alert for the same lead is deduplicated');
    assert.match(rows[0].payload.text.body, /wa\.me\/972521234567/);
  } finally { await close(); }
});

test('outside the window the owner gets the approved template, or nothing', async () => {
  const { db, close } = await openDatabase();
  const before = { t: process.env.LEAD_ALERT_TEMPLATE, a: process.env.WHATSAPP_APPROVED_TEMPLATES };
  try {
    const client = (await db.query("INSERT INTO clients(phone) VALUES('972500000092') RETURNING id")).rows[0].id;
    await db.query("INSERT INTO whatsapp_contacts(phone,last_inbound_at) VALUES('972500000092',NOW()-INTERVAL '3 days')");
    delete process.env.LEAD_ALERT_TEMPLATE;
    assert.equal((await alert.notifyOwner(client, { id: '22222222-2222-2222-2222-222222222222', name: 'א' })).status, 'WINDOW_CLOSED');
    process.env.LEAD_ALERT_TEMPLATE = 'new_lead_alert';
    process.env.WHATSAPP_APPROVED_TEMPLATES = 'new_lead_alert';
    assert.equal((await alert.notifyOwner(client, { id: '33333333-3333-3333-3333-333333333333', name: 'ב' })).status, 'TEMPLATE_QUEUED');
    const row = (await db.query('SELECT payload FROM whatsapp_outbox WHERE client_id=$1', [client])).rows[0];
    assert.equal(row.payload.template.name, 'new_lead_alert');
  } finally {
    for (const [k, v] of [['LEAD_ALERT_TEMPLATE', before.t], ['WHATSAPP_APPROVED_TEMPLATES', before.a]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await close();
  }
});

test('alerts can be switched off and never throw', async () => {
  const prior = process.env.LEAD_ALERTS_ENABLED;
  process.env.LEAD_ALERTS_ENABLED = 'false';
  try { assert.equal((await alert.notifyOwner(1, { id: 'x' })).status, 'SKIPPED'); }
  finally { if (prior === undefined) delete process.env.LEAD_ALERTS_ENABLED; else process.env.LEAD_ALERTS_ENABLED = prior; }
});
