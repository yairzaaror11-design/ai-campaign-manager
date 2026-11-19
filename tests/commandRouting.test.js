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

test('alerts and reports name a command the bot actually understands', () => {
  assert.match(require('../leadAlert').alertText({ name: 'x' }, 'r'), /הלידים שלי/);
  const f = { leads: 0, untouched: 0, staleUntouched: 0, contacted: 0, meetings: 0, won: 0, lost: 0, revenue: 0 };
  const r = require('../businessReport');
  assert.match(r.format({ days: 7, funnel: f, spend: null, metrics: r.metrics(f, null), campaigns: [], nextSteps: ['x'] }), /הלידים שלי/);
});
