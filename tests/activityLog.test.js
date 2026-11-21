'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('./helpers/isolatedDatabase');

test('activity log: what SCORPIO did and why, on WhatsApp and in the dashboard', async () => {
  const { db, close } = await openDatabase();
  try {
    const log = require('../activityLog');
    const id = (await db.query("INSERT INTO clients(phone) VALUES('972500000875') RETURNING id")).rows[0].id;
    assert.equal(await log.handle(id, 'שלום'), null);
    assert.match((await log.handle(id, 'מה עשית השבוע?')).reply, /לא עשיתי שום פעולה/);
    const plan = { id: 'ACT000000001', intent: 'PAUSE_CAMPAIGN', summary: 'הקמפיין הוציא ₪300 בלי לידים', target: { accountId: 'act_1', campaignName: 'יישור שיניים' }, parameters: {} };
    await db.query("INSERT INTO action_plans(id,client_id,intent,payload,status) VALUES($1,$2,'PAUSE_CAMPAIGN',$3::jsonb,'VERIFIED')", [plan.id, id, JSON.stringify(plan)]);
    const items = await log.list(id);
    assert.equal(items.length, 1);
    assert.equal(items[0].what, 'השהיית קמפיין: יישור שיניים');
    assert.equal(items[0].status, 'בוצע ✅');
    const r = await log.handle(id, 'יומן פעולות');
    assert.match(r.reply, /השהיית קמפיין: יישור שיניים · בוצע ✅/);
    assert.match(r.reply, /למה: הקמפיין הוציא ₪300 בלי לידים/);
  } finally { await close(); }
});

test('approval cards say what it will cost before anything spends', () => {
  const { formatActionPlan } = require('../actionPlan');
  const text = formatActionPlan({ intent: 'ACTIVATE_BUNDLE', target: { accountId: 'act_1' }, parameters: { currency: 'ILS', adSets: [{ dailyBudget: 70 }] } });
  assert.match(text, /כמה זה יעלה: עד 70 ₪ ליום · בערך 2,100 ₪ לחודש/);
  assert.doesNotMatch(formatActionPlan({ intent: 'PAUSE_CAMPAIGN', target: { accountId: 'act_1' }, parameters: {} }), /כמה זה יעלה/);
});
