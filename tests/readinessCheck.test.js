'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('./helpers/isolatedDatabase');
const rc = require('../readinessCheck');

const none = { total: 0, handled: 0, stale: 0, won: 0, won_with_amount: 0 };

test('a business with nothing known gets specific blockers, not a generic "missing assets"', () => {
  const list = rc.findings({ f: {}, leads: none, meta: null, media: false });
  const texts = list.map((x) => x.text).join('\n');
  assert.match(texts, /לא ברור מה העסק מוכר/);
  assert.match(texts, /חשבון מטא לא מחובר/);
  assert.ok(list.every((x) => x.fix && x.fix.length > 5), 'every finding says exactly what to do');
});

test('unhandled leads block scaling before more budget is spent', () => {
  const list = rc.findings({ f: { product: 'x', offer: 'x', advantage: 'x', audience: 'x', geography: 'x', leadDestination: 'x', leadOwner: 'x', proof: 'x' },
    leads: { total: 10, handled: 4, stale: 5, won: 0, won_with_amount: 0 }, meta: { pages: [{ id: '1' }], pixels: [] }, media: true });
  assert.equal(list[0].level, 'BLOCKER');
  assert.match(list.find((x) => x.level === 'BLOCKER').text, /רק 4 מתוך 10/);
  assert.ok(list.some((x) => /אין עסקאות שסומנו כנסגרו/.test(x.text)), 'no sales data is stated, not guessed');
});

test('a ready business passes and the report says what it is based on', async () => {
  const { db, close } = await openDatabase();
  try {
    const client = (await db.query("INSERT INTO clients(phone) VALUES('972500000121') RETURNING id")).rows[0].id;
    const result = await rc.run(client, { inventory: async () => null });
    assert.equal(result.ready, false);
    const text = rc.format(result);
    assert.match(text, /בדיקת מוכנות/);
    assert.match(text, /מבוססת רק על מה שנמסר/);
    const good = rc.findings({ f: { product: 'x', offer: 'x', advantage: 'x', audience: 'x', geography: 'x', leadDestination: 'x', leadOwner: 'x', proof: 'x', materials: 'x' },
      leads: { total: 5, handled: 5, stale: 0, won: 2, won_with_amount: 2 }, meta: { pages: [{ id: '1' }], pixels: [{ id: 'p' }] }, media: true });
    assert.deepEqual(good, []);
    assert.match(rc.format({ ready: true, findings: [] }), /לא מצאתי פערים/);
  } finally { await close(); }
});
