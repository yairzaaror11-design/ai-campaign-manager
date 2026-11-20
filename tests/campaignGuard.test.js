'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('./helpers/isolatedDatabase');
const guard = require('../campaignGuard');

const NOW = new Date('2026-11-17T09:00:00Z'); // Tuesday 11:00 Israel
const old = new Date(NOW - 10 * 864e5).toISOString(), fresh = new Date(NOW - 24 * 36e5).toISOString();
const row = (spend, leads, extra = {}) => ({ spend: String(spend), impressions: '8000', ctr: '1.2', frequency: '1.5', actions: leads ? [{ action_type: 'lead', value: String(leads) }] : [], ...extra });
const account = { account_status: 1, currency: 'ILS', spend30: 1000, leads30: 25 }; // 40 ₪ per lead

test('flags money spent without leads, after learning, with a pause proposal', () => {
  const f = guard.evaluate({ account, now: NOW, campaigns: [{ id: '1', name: 'דירות', effective_status: 'ACTIVE', created_time: old, d7: row(160, 0), d3: row(60, 0), d30: row(160, 0) }] });
  assert.equal(f[0].kind, 'WASTE'); assert.equal(f[0].pause, true); assert.match(f[0].text, /160 ₪/); assert.match(f[0].text, /40 ₪/);
});
test('does not judge during the learning period or on too little data', () => {
  assert.equal(guard.evaluate({ account, now: NOW, campaigns: [{ id: '1', effective_status: 'ACTIVE', created_time: fresh, d7: row(500, 0) }] }).length, 0);
  assert.equal(guard.evaluate({ account, now: NOW, campaigns: [{ id: '1', effective_status: 'ACTIVE', created_time: old, d7: row(90, 0) }] }).length, 0, 'below 2.5x average CPL');
  assert.equal(guard.evaluate({ account, now: NOW, campaigns: [{ id: '1', effective_status: 'ACTIVE', created_time: old, d7: row(160, 0), crmLeads7: 2 }] }).length, 0, 'CRM leads count');
});
test('suggests scaling a clear winner with the expected extra leads', () => {
  const f = guard.evaluate({ account, now: NOW, campaigns: [{ id: '2', name: 'מרפאה', effective_status: 'ACTIVE', created_time: old, daily_budget: '5000', d7: row(200, 10), d3: row(90, 5), d30: row(600, 20) }] });
  assert.equal(f[0].kind, 'WINNER'); assert.match(f[0].text, /20 ₪ לפנייה/); assert.match(f[0].text, /300 ₪ בחודש/); assert.match(f[0].choices[0].text, /20%/);
});
test('detects creative fatigue only when frequency is high and clicks drop', () => {
  const tired = { id: '3', name: 'שיפוצים', effective_status: 'ACTIVE', created_time: old, d7: row(200, 4, { frequency: '4.2' }), d3: row(90, 1, { ctr: '0.6' }), d30: row(700, 16, { ctr: '1.4' }) };
  assert.equal(guard.evaluate({ account, now: NOW, campaigns: [tired] })[0].kind, 'FATIGUE');
  assert.equal(guard.evaluate({ account, now: NOW, campaigns: [{ ...tired, d7: row(200, 4, { frequency: '2' }) }] }).length, 0);
});
test('account and delivery problems come first', () => {
  assert.equal(guard.evaluate({ account: { ...account, account_status: 3 }, campaigns: [] })[0].kind, 'ACCOUNT');
  const f = guard.evaluate({ account, now: NOW, campaigns: [{ id: '4', name: 'x', effective_status: 'DISAPPROVED' }, { id: '1', effective_status: 'ACTIVE', created_time: old, d7: row(400, 0) }] });
  assert.deepEqual(f.map((x) => x.kind), ['DELIVERY', 'WASTE']);
});

test('runs once a day per owner, sends one message, and never repeats an alert within 3 days', async () => {
  process.env.META_APP_ID = process.env.META_APP_ID || '123';
  process.env.META_TOKEN_ENCRYPTION_KEY = process.env.META_TOKEN_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64');
  const { db, close } = await openDatabase();
  const meta = require('../metaConnection');
  try {
    const id = (await db.query("INSERT INTO clients(phone,meta_ad_account_id) VALUES('972500000301','act_77') RETURNING id")).rows[0].id;
    await db.query("INSERT INTO whatsapp_contacts(phone,last_inbound_at) VALUES('972500000301',NOW())");
    await db.query("INSERT INTO meta_connections(client_id,meta_user_id,token_ciphertext,app_id,expires_at) VALUES($1,'10301',$2,$3,NOW()+INTERVAL '1 hour')", [id, meta.encrypt('t', id), process.env.META_APP_ID]);
    const data = { account, accountId: 'act_77', campaigns: [{ id: '9', name: 'בדיקה', effective_status: 'DISAPPROVED' }] };
    const first = await guard.runDue({ now: NOW, loader: async (cid) => (String(cid) === String(id) ? data : null) });
    assert.ok(first.results.includes('ALERTED'));
    const again = await guard.runDue({ now: NOW, loader: async (cid) => (String(cid) === String(id) ? data : null) });
    assert.ok(!again.results.includes('ALERTED'), 'already reviewed today');
    await db.query('DELETE FROM campaign_guard_runs WHERE client_id=$1', [id]);
    await require('../marketingStore').update(id, null, (p) => { delete p.ui; return { handled: false, changed: true }; });
    const next = await guard.runDue({ now: NOW, loader: async (cid) => (String(cid) === String(id) ? data : null) });
    assert.ok(next.results.includes('QUIET'), 'same alert is not repeated within 3 days');
    const sent = (await db.query('SELECT payload FROM whatsapp_outbox WHERE client_id=$1', [id])).rows.map((r) => JSON.stringify(r.payload));
    assert.equal(sent.length, 1); assert.match(sent[0], /נדחה/);
  } finally { await close(); }
});
