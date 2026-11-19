'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('./helpers/isolatedDatabase');

// Tuesday 2026-11-17 11:00 Israel time (09:00 UTC); Saturday 2026-11-21 11:00; Sunday 2026-11-22 10:00.
const TUESDAY = new Date('2026-11-17T09:00:00Z');
const SATURDAY = new Date('2026-11-21T09:00:00Z');
const SUNDAY = new Date('2026-11-22T08:00:00Z');

async function owner(db, phone, { windowOpen = true } = {}) {
  const id = (await db.query('INSERT INTO clients(phone) VALUES($1) RETURNING id', [phone])).rows[0].id;
  await db.query(`INSERT INTO whatsapp_contacts(phone,last_inbound_at) VALUES($1,${windowOpen ? 'NOW()' : "NOW()-INTERVAL '3 days'"})`, [phone]);
  return id;
}
async function lead(db, client, name, status, hoursAgo) {
  return (await db.query(`INSERT INTO crm_leads(id,client_id,name,source,status,created_at,updated_at)
    VALUES(gen_random_uuid(),$1,$2,'meta_lead_ads',$3,NOW()-make_interval(hours=>$4::int),NOW()-make_interval(hours=>$4::int)) RETURNING id`,
    [client, name, status, hoursAgo])).rows[0].id;
}
const outbox = async (db, client) => (await db.query('SELECT payload FROM whatsapp_outbox WHERE client_id=$1 ORDER BY delivery_order', [client])).rows.map((r) => r.payload);

test('check-ins only run in Israeli business hours', () => {
  const { businessHours } = require('../leadCheckins');
  assert.equal(businessHours(TUESDAY), true);
  assert.equal(businessHours(SATURDAY), false);
  assert.equal(businessHours(new Date('2026-11-17T19:30:00Z')), false, '21:30 Israel time');
});

test('SCORPIO asks about an untouched lead once, with status buttons, and does not nag', async () => {
  const { db, close } = await openDatabase();
  try {
    const checkins = require('../leadCheckins');
    const client = await owner(db, '972500000111');
    const dana = await lead(db, client, 'דנה כהן', 'NEW', 3);
    await lead(db, client, 'יוסי', 'NEW', 5);
    await lead(db, client, 'טרי', 'NEW', 1); // not due yet
    const first = await checkins.runDue({ now: TUESDAY });
    assert.deepEqual(first.results, ['ASKED']);
    const sent = await outbox(db, client);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'interactive');
    assert.match(JSON.stringify(sent[0]), /יוסי השאיר\/ה פרטים לפני 5 שעות/, 'oldest lead first');
    assert.match(JSON.stringify(sent[0]), /נקבעה פגישה/);
    // The owner has an open status decision now, and the quiet window applies.
    assert.deepEqual((await checkins.runDue({ now: TUESDAY })).results, []);
    await db.query("UPDATE lead_checkins SET sent_at=NOW()-INTERVAL '4 hours'");
    const profile = require('../marketingStore');
    await profile.update(client, null, (p) => { delete p.crmFocus; delete p.ui; return { handled: false, changed: true }; });
    assert.deepEqual((await checkins.runDue({ now: TUESDAY })).results, ['ASKED']);
    assert.match(JSON.stringify((await outbox(db, client)).at(-1)), /דנה כהן/);
    assert.ok(dana);
  } finally { await close(); }
});

test('later stages ask about meetings and deals; closed window and weekends stay quiet', async () => {
  const { db, close } = await openDatabase();
  try {
    const checkins = require('../leadCheckins');
    const a = await owner(db, '972500000112');
    await lead(db, a, 'רונית', 'APPOINTMENT', 50);
    assert.deepEqual((await checkins.runDue({ now: SATURDAY })).status, 'NOT_DUE');
    await checkins.runDue({ now: TUESDAY });
    assert.match(JSON.stringify((await outbox(db, a))[0]), /איך הייתה הפגישה עם רונית\? נסגרה עסקה\?/);
    const b = await owner(db, '972500000113', { windowOpen: false });
    await lead(db, b, 'משה', 'NEW', 5);
    await checkins.runDue({ now: TUESDAY });
    assert.equal((await outbox(db, b)).length, 0, 'no free-form message outside the WhatsApp window');
  } finally { await close(); }
});

test('the weekly report goes out once on Sunday morning to active clients', async () => {
  const { db, close } = await openDatabase();
  const prior = process.env.WEEKLY_REPORTS_ENABLED;
  process.env.WEEKLY_REPORTS_ENABLED = 'true';
  try {
    const reports = require('../scheduledReports');
    assert.equal(reports.due(TUESDAY), false);
    assert.equal(reports.due(SUNDAY), true);
    const active = await owner(db, '972500000114');
    await lead(db, active, 'ליד', 'NEW', 30);
    const idle = await owner(db, '972500000115');
    const build = async () => 'דוח בדיקה';
    const run = await reports.runDue({ now: SUNDAY, build });
    assert.deepEqual(run.results, ['SENT']);
    assert.equal((await outbox(db, active))[0].text.body, 'דוח בדיקה');
    assert.equal((await outbox(db, idle)).length, 0);
    assert.deepEqual((await reports.runDue({ now: SUNDAY, build })).results, [], 'once per week');
  } finally {
    if (prior === undefined) delete process.env.WEEKLY_REPORTS_ENABLED; else process.env.WEEKLY_REPORTS_ENABLED = prior;
    await close();
  }
});
