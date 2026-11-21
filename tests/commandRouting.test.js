'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('report, readiness and video commands bypass the task planner', () => {
  const { passesThrough } = require('../conversationController');
  for (const m of ['דוח עסקי', 'דוח עסקי 30', '/business-report 14', 'בדיקת מוכנות', '/readiness', '/report last_7d', '/meta-connect']) assert.equal(passesThrough(m), true, m);
  for (const m of ['תכין לי קמפיין לידים', 'דוח עסקי על המתחרים שלי', 'מה דעתך על הדוח?']) assert.equal(passesThrough(m), false, m);
  const prior = { v: process.env.VIDEO_ENABLED, c: process.env.HF_CREDENTIALS };
  try {
    process.env.VIDEO_ENABLED = 'true'; process.env.HF_CREDENTIALS = 'a:b';
    assert.equal(passesThrough('תכין לי סרטון למבצע'), true);
    process.env.VIDEO_ENABLED = 'false';
    assert.equal(passesThrough('תכין לי סרטון למבצע'), false, 'disabled video stays with the planner');
  } finally {
    for (const [k, v] of [['VIDEO_ENABLED', prior.v], ['HF_CREDENTIALS', prior.c]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('alerts and reports suggest a natural request the bot actually understands, never a command', () => {
  const profile = require('../agentProfile'), { LEADS } = require('../crmConversation');
  const alert = require('../leadAlert').alertText({ name: 'x' }, 'r');
  assert.match(alert, /לראות את הלידים/); assert.ok(!profile.COMMAND.test(alert));
  const f = { leads: 0, untouched: 0, staleUntouched: 0, contacted: 0, meetings: 0, won: 0, lost: 0, revenue: 0 };
  const r = require('../businessReport');
  const report = r.format({ days: 7, funnel: f, spend: null, metrics: r.metrics(f, null), campaigns: [], nextSteps: ['x'] });
  assert.match(report, /לראות אותם|לראות את הלידים/); assert.ok(!profile.COMMAND.test(report));
  // What the owner naturally says back is understood, and the old exact words still work.
  for (const m of ['הלידים שלי', 'הפניות שלי', 'תראה לי את הלידים', 'מה עם הלידים?', 'אני רוצה לראות את הלידים', 'אני רוצה לעדכן את הפניות']) assert.ok(LEADS.test(m), m);
  assert.ok(!LEADS.test('תכין לי קמפיין לידים'));
});

test('asking to switch the ad account opens the verified account menu', () => {
  const analysis = require('../conversationAnalysis');
  for (const m of ['תחליף חשבון מודעות', 'אני רוצה לבחור חשבון אחר', 'להחליף את חשבון הפרסום']) assert.equal(analysis.localAnalysis(m).intent, 'select_account', m);
  assert.notEqual(analysis.localAnalysis('תחליף את הכותרת').intent, 'select_account');
  const read = require('../readConversation');
  assert.deepEqual(read.request('החשבונות שלי'), { type: 'list' });
  for (const m of ['תציג לי את כל החשבונות', 'תראה לי את החשבונות שלי', 'אני רוצה לראות את החשבונות']) assert.deepEqual(read.request(m), { type: 'list' }, m);
  assert.deepEqual(read.request('אפשר לעבור לחשבון יאיר דיגיטל'), { type: 'select', query: 'יאיר דיגיטל' });
  assert.deepEqual(read.request('תעבור לחשבון יאיר דיגיטל'), { type: 'select', query: 'יאיר דיגיטל' });
  for (const m of ['תחליף חשבון מודעות', 'תחליף חשבון פרסום', 'החלף חשבון אחר']) assert.deepEqual(read.request(m), { type: 'list' }, m);
});
