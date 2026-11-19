'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { openDatabase } = require('./helpers/isolatedDatabase');
const seasonal = require('../seasonalPrompts'), competitors = require('../competitorAds');

test('occasions are found about three weeks ahead from the Hebrew calendar', () => {
  assert.deepEqual(seasonal.upcoming(new Date('2026-11-14T09:00:00Z')).map((o) => o.key), ['hanukkah']);
  assert.deepEqual(seasonal.upcoming(new Date('2027-03-29T09:00:00Z')).map((o) => o.key), ['passover']);
  assert.deepEqual(seasonal.upcoming(new Date('2027-03-25T09:00:00Z')), [], 'not too early');
  assert.equal(seasonal.blackFriday(2026).toISOString().slice(0, 10), '2026-11-27');
  assert.match(seasonal.message({ name: 'פסח', emoji: '🍷', days: 21 }), /בעוד כ־3 שבועות פסח/);
});
test('each owner gets one holiday prompt with buttons, only once', async () => {
  const { db, close } = await openDatabase();
  try {
    const id = (await db.query("INSERT INTO clients(phone,meta_ad_account_id) VALUES('972500000401','act_5') RETURNING id")).rows[0].id;
    await db.query("INSERT INTO whatsapp_contacts(phone,last_inbound_at) VALUES('972500000401',NOW())");
    const now = new Date('2026-11-17T09:00:00Z'); // Tuesday, Hanukkah in 18 days
    const first = await seasonal.runDue({ now });
    assert.equal(first.occasion, 'hanukkah'); assert.ok(first.results.includes('SENT'));
    await require('../marketingStore').update(id, null, (p) => { delete p.ui; return { handled: false, changed: true }; });
    assert.ok(!(await seasonal.runDue({ now })).results.includes('SENT'));
    const sent = (await db.query('SELECT payload FROM whatsapp_outbox WHERE client_id=$1', [id])).rows;
    assert.equal(sent.length, 1); assert.match(JSON.stringify(sent[0].payload), /חנוכה/); assert.match(JSON.stringify(sent[0].payload), /תכין קמפיין לחג/);
  } finally { await close(); }
});
test('competitor ads command links to the Israeli Ad Library search', () => {
  const m = 'מודעות מתחרים שיפוצים ברחובות'.match(competitors.PATTERN);
  assert.equal(m[1], 'שיפוצים ברחובות');
  const r = competitors.reply(m[1]);
  assert.match(r, /facebook\.com\/ads\/library\/.*country=IL/); assert.match(r, /q=%D7/);
  assert.match(competitors.reply(''), /על איזה תחום/);
  assert.ok(require('../conversationController').passesThrough('מה המתחרים מפרסמים?'));
});
