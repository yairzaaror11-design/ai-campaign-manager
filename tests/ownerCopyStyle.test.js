'use strict';
// The bot talks like a human account manager: no owner-facing text may tell the owner to type an
// exact command ("כתוב: X", "כתבו ״X״"), and owner copy is singular (no כתבו/שלחו/לחצו).
// Scans every string literal in the top-level *.js files (not tests, not public).
const test = require('node:test'), assert = require('node:assert/strict');
const profile = require('../agentProfile');
const { literals, violations } = require('./helpers/ownerCopyScan');

test('the command detector catches quoted and unquoted "type X" instructions', () => {
  assert.ok(profile.check('לפירוט מלא כתבו: דשבורד ביצועים').includes('COMMAND'));
  assert.ok(profile.check('לעדכון לידים כתוב: הלידים שלי').includes('COMMAND'));
  assert.ok(profile.check('כתוב "עצור את כל הפעולות האוטומטיות"').includes('COMMAND'));
  assert.ok(profile.check('כתוב לי ״תסגור אותה״').includes('COMMAND'));
  assert.deepEqual(profile.check('אם תרצה לראות את כל הפרטים, רק תבקש ממני את הדשבורד.'), []);
});

test('the literal scanner reads quotes, templates and skips regexes and comments', () => {
  assert.deepEqual(literals('const a=\'x\'; // "no"\nconst b=`t${1+"in"}u`; const r=/"q"/g; /* "c" */'), ['x', 'in', 'tXu']);
});

test('the natural phrasing the bot now suggests is understood, and the old exact phrases still work', () => {
  const wa = require('../workAgreement');
  for (const t of ['עצור את כל הפעולות האוטומטיות', 'תעצור את כל האוטומציות', 'תפסיק את הפעולות האוטומטיות']) assert.ok(wa.PAUSE.test(t), t);
  for (const t of ['חדש את הפעולות האוטומטיות', 'תחדש את האוטומציות', 'תחזיר את כל הפעולות האוטומטיות']) assert.ok(wa.RESUME.test(t), t);
  assert.ok(!wa.PAUSE.test('תעצור את הקמפיין'));
  const support = require('../humanSupport');
  for (const t of ['המשך עם הבוט', 'אני רוצה לחזור לסוכן', 'תחזור']) assert.ok(support.resumeRequested(t), t);
  const router = require('../conversationRouter');
  for (const t of ['נמשיך', 'המשך במשימה', 'אפשר להמשיך', 'תמשיך במשימה']) assert.ok(router.resume(t), t);
  for (const t of ['מאשר את התוכן', 'אני מאשר את התוכן']) assert.ok(router.exactControl(t), t);
  const meta = require('../metaConversation');
  for (const t of ['חבר הרשאת יצירת קמפיינים', 'תחבר הרשאה ליצירת קמפיינים']) assert.ok(meta.MANAGE.test(t), t);
  for (const t of ['תן הרשאה', 'אני רוצה לתת את ההרשאה']) assert.ok(meta.GRANT.test(t), t);
});

test('no owner-facing string tells the owner to type a command or uses plural imperatives', () => {
  assert.deepEqual(violations(), []);
});

