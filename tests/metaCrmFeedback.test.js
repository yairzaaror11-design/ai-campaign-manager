'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { openDatabase } = require('./helpers/isolatedDatabase');
const feedback = require('../metaCrmFeedback');

test('payload keeps the 17-digit lead id exact and adds the sale value only for a sale', () => {
  const row = { stage: 'WON', meta_lead_id: '12345678901234567', event_time: '2026-11-19T10:00:00Z' };
  const body = feedback.payload(row, { revenue_minor: 250000, currency: 'ILS' });
  assert.match(body, /"lead_id":12345678901234567\b/);
  const parsed = JSON.parse(body)[0];
  assert.equal(parsed.event_name, 'Converted'); assert.equal(parsed.action_source, 'system_generated');
  assert.deepEqual(parsed.custom_data, { event_source: 'crm', lead_event_source: 'SCORPIO AI', value: 2500, currency: 'ILS' });
  assert.equal(JSON.parse(feedback.payload({ ...row, stage: 'CONTACTED' }, { revenue_minor: 5, currency: 'ILS' }))[0].custom_data.value, undefined);
});

test('Meta leads report each stage once; manual leads and LOST are never sent', async () => {
  process.env.META_APP_ID = process.env.META_APP_ID || '123';
  process.env.META_APP_SECRET = process.env.META_APP_SECRET || 'secret';
  process.env.META_TOKEN_ENCRYPTION_KEY = process.env.META_TOKEN_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64');
  process.env.META_CRM_FEEDBACK_ENABLED = 'true';
  process.env.APP_PUBLIC_URL = process.env.APP_PUBLIC_URL || 'https://example.test/';
  process.env.META_LOGIN_CONFIG_ID = process.env.META_LOGIN_CONFIG_ID || '1';
  const { db, close } = await openDatabase();
  const meta = require('../metaConnection'), crm = require('../crmService');
  const post = axios.post, get = axios.get; const sent = [];
  axios.get = async (url) => { if (!/act_88\/adspixels$/.test(url)) throw Error("unexpected " + url); return { data: { data: [{ id: '5550001' }] } }; };
  axios.post = async (url, body) => { sent.push({ url, data: body.get('data') }); return { data: { events_received: 1 } }; };
  try {
    const id = (await db.query("INSERT INTO clients(phone,meta_ad_account_id) VALUES('972500000417','act_88') RETURNING id")).rows[0].id;
    await db.query("INSERT INTO meta_connections(client_id,meta_user_id,token_ciphertext,app_id,expires_at) VALUES($1,'10401',$2,$3,NOW()+INTERVAL '1 hour')", [id, meta.encrypt('t', id), process.env.META_APP_ID]);
    const lead = await crm.create(id, { name: 'דנה', phone: '0501234567', source: 'meta_lead_ads', sourceEventId: '98765432109876543' });
    const manual = await crm.create(id, { name: 'יוסי', phone: '0501234568' });
    let v = (await crm.update(id, lead.id, { status: 'CONTACTED', version: lead.version })).version;
    v = (await crm.update(id, lead.id, { status: 'WON', version: v })).version;
    await crm.update(id, lead.id, { status: 'WON', version: v, revenueMinor: 120000, currency: 'ILS' });
    await crm.update(id, manual.id, { status: 'WON', version: manual.version });
    const rows = (await db.query('SELECT stage FROM meta_crm_events ORDER BY stage')).rows.map((r) => r.stage);
    assert.deepEqual(rows, ['CONTACTED', 'NEW', 'WON'], 'one event per stage, Meta leads only');
    assert.equal(await feedback.runDue(), 2, 'the sale waits for the amount');
    assert.ok(sent.every((s) => s.url.endsWith('/5550001/events')));
    assert.deepEqual(sent.map((s) => JSON.parse(s.data)[0].event_name).sort(), ['Contacted', 'Lead']);
    await db.query("UPDATE meta_crm_events SET available_at=NOW() WHERE stage='WON'");
    assert.equal(await feedback.runDue(), 1);
    const sale = JSON.parse(sent.at(-1).data)[0];
    assert.equal(sale.event_name, 'Converted'); assert.equal(sale.custom_data.value, 1200);
    assert.ok(!sent.some((s) => /0501234567|דנה/.test(s.data)), 'no personal details leave the system');
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM meta_crm_events WHERE status='SENT'")).rows[0].n, 3);
    assert.equal(await feedback.runDue(), 0, 'nothing is sent twice');
  } finally { axios.post = post; axios.get = get; delete process.env.META_CRM_FEEDBACK_ENABLED; await close(); }
});
