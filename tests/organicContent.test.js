'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('./helpers/isolatedDatabase');

// Sunday 22 Nov 2026, 10:00 in Israel.
const SUNDAY = new Date('2026-11-22T08:00:00Z');

test('three-month organic calendar: slots, AI writer with fallback, approvals and edits', async () => {
  const { db, close } = await openDatabase();
  try {
    const o = require('../organicContent');
    const id = (await db.query("INSERT INTO clients(phone) VALUES('972500000461') RETURNING id")).rows[0].id;
    assert.equal(o.slots('2026-11-22', 3).length, 39, 'three posts a week for 13 weeks');
    assert.ok(o.slots('2026-11-22', 5).every((d) => ![5, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay())), 'no Friday or Saturday posts');
    // The writer returns a good first post, a post with a link (rejected) and then fails.
    let calls = 0;
    const writer = async (input) => { calls++; if (calls > 1) throw Error('AI_DOWN'); return { posts: input.slots.map((s, i) => ({ topic: 'נושא ' + i, caption: i === 1 ? 'בקרו ב https://x.y עכשיו וקבלו הנחה גדולה במיוחד לכולם' : 'פוסט חם ואישי על העסק שלנו, עם רעיון אחד ברור וקריאה לשלוח הודעה #עסק', visual: 'תמונה' })) }; };
    await assert.rejects(o.create(id, { perWeek: 9 }), /INVALID_POSTS_PER_WEEK/);
    const r = await o.create(id, { perWeek: 3, media: 'MIXED', writer, now: SUNDAY });
    assert.equal(r.count, 39); assert.equal(r.startsOn, '2026-11-23');
    assert.equal(calls, 3, 'written in three monthly chunks');
    const all = (await db.query('SELECT * FROM organic_posts WHERE client_id=$1 ORDER BY publish_on', [id])).rows;
    assert.equal(all.length, 39);
    assert.equal(all[0].topic, 'נושא 0');
    assert.doesNotMatch(all[1].caption, /https?:/, 'a link is replaced by the fallback post');
    assert.deepEqual([...new Set(all.map((x) => x.media))].sort(), ['AI_GRAPHIC', 'AI_VIDEO', 'PHOTO']);
    assert.ok(all.filter((x) => x.media === 'AI_VIDEO').every((x) => x.format === 'REEL'));
    let view = await o.overview(id, { now: SUNDAY });
    assert.equal(view.waiting, 39); assert.equal(view.plan.media_mode, 'MIXED');
    await o.updatePost(id, all[0].id, { action: 'edit', caption: 'טקסט חדש' });
    await o.updatePost(id, all[1].id, { action: 'skip' });
    await assert.rejects(o.updatePost(id, all[1].id, { action: 'approve' }), /POST_NOT_EDITABLE/);
    await assert.rejects(o.updatePost(id, "'; drop", { action: 'skip' }), /INVALID_POST/);
    assert.equal(await o.approveAll(id, { now: SUNDAY }), 38);
    view = await o.overview(id, { now: SUNDAY });
    assert.equal(view.waiting, 0);
    assert.equal(view.posts[0].caption, 'טקסט חדש');
    // Extending adds another quarter right after the current one, without touching it.
    const more = await o.create(id, { perWeek: 3, media: 'MIXED', extend: true, writer: async () => { throw Error('X'); }, now: SUNDAY });
    assert.equal(more.startsOn, '2027-02-22');
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM organic_posts WHERE client_id=$1', [id])).rows[0].n, 78);
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM organic_posts WHERE client_id=$1 AND status='APPROVED'", [id])).rows[0].n, 38, 'approved posts stay approved');
  } finally { await close(); }
});

test('WhatsApp: setup choice, calendar, approve all, pause, photo shoot with details', async () => {
  const { db, close } = await openDatabase();
  const provider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = 'none'; // no AI in tests: posts come from the fallback writer
  try {
    const o = require('../organicContent');
    const id = (await db.query("INSERT INTO clients(phone) VALUES('972500000462') RETURNING id")).rows[0].id;
    assert.equal(await o.handle(id, 'מה שלומך'), null);
    let r = await o.handle(id, 'תוכן שוטף');
    assert.equal(r.decisionKey, 'organic_setup'); assert.match(r.reply, /איך תרצה את התמונות/);
    assert.match((await o.handle(id, 'אשר את כל התוכן')).reply, /עוד אין לוח תוכן/);
    r = await o.handle(id, 'תוכן שוטף עם גרפיקות AI');
    assert.equal(r.decisionKey, 'organic_review');
    assert.match(r.reply, /39 פוסטים, 3 בשבוע \(גרפיקה AI\)/);
    assert.match(r.reply, /שום דבר לא נשלח בלי אישור/);
    assert.match((await o.handle(id, 'תוכן שוטף')).reply, /התוכן השוטף שלך/, 'with a plan, the same words show its status');
    assert.match((await o.handle(id, 'אשר את כל התוכן')).reply, /אישרתי \d+ פוסטים/);
    assert.match((await o.handle(id, 'עצור תוכן שוטף')).reply, /עצרתי/);
    assert.equal((await db.query('SELECT status FROM organic_plans WHERE client_id=$1', [id])).rows[0].status, 'PAUSED');
    assert.match((await o.handle(id, 'המשך תוכן שוטף')).reply, /חזרנו/);
    // Photo shoot: ask, then the next message is the details.
    assert.match((await o.handle(id, 'אני רוצה יום צילום')).reply, /כתובת העסק/);
    assert.match((await o.handle(id, 'הרצל 5 תל אביב, ראשון בבוקר, את הצוות')).reply, /קיבלתי/);
    const shoot = (await db.query('SELECT status,details FROM photo_shoot_requests WHERE client_id=$1', [id])).rows;
    assert.equal(shoot.length, 1); assert.equal(shoot[0].status, 'REQUESTED'); assert.match(shoot[0].details, /הרצל 5/);
    assert.equal(await o.handle(id, 'עוד הודעה רגילה לגמרי'), null, 'details are captured only once');
    await o.handle(id, 'יום צילום');
    assert.match((await o.handle(id, 'בטל')).reply, /ביטלתי/);
  } finally { process.env.AI_PROVIDER = provider; if (provider === undefined) delete process.env.AI_PROVIDER; await close(); }
});

test('background: approved posts are delivered on their day inside the WhatsApp window, with retries', async () => {
  const { db, close } = await openDatabase();
  try {
    const o = require('../organicContent');
    const id = (await db.query("INSERT INTO clients(phone) VALUES('972500000463') RETURNING id")).rows[0].id;
    await o.create(id, { perWeek: 3, media: 'AI_GRAPHIC', writer: async () => { throw Error('X'); }, now: new Date('2026-11-21T08:00:00Z') });
    await o.approveAll(id, { now: new Date('2026-11-21T08:00:00Z') });
    const sent = [];
    // No inbound message in 24 hours: WhatsApp would refuse, so nothing is sent yet.
    let r = await o.runDue({ now: SUNDAY, send: async (post) => sent.push(post.id) });
    assert.deepEqual(r.results, []);
    await db.query("INSERT INTO whatsapp_contacts(phone,last_inbound_at) VALUES('972500000463',NOW())");
    let fail = true;
    r = await o.runDue({ now: SUNDAY, send: async (post) => { if (fail) { fail = false; throw Error('GRAPHIC_RATE_LIMIT'); } sent.push(post.id); } });
    assert.deepEqual(r.results, ['FAILED', 'SENT'], 'one retry within the same run');
    const today = (await db.query("SELECT status,attempts FROM organic_posts WHERE client_id=$1 AND publish_on='2026-11-22'", [id])).rows[0];
    assert.equal(today.status, 'SENT'); assert.equal(today.attempts, 2);
    assert.equal((await o.runDue({ now: SUNDAY, send: async () => sent.push('x') })).results.length, 0, 'sent once only');
    assert.equal((await o.runDue({ now: new Date('2026-11-21T08:00:00Z') })).status, 'NOT_DUE', 'no messages on Saturday');
    // The real delivery: without AI graphics it still sends the ready text, and says so.
    await db.query("UPDATE whatsapp_contacts SET last_inbound_at=NOW() WHERE phone='972500000463'");
    r = await o.runDue({ now: new Date('2026-11-24T08:00:00Z') });
    assert.deepEqual(r.results, ['SENT']);
    const out = (await db.query("SELECT payload FROM whatsapp_outbox WHERE client_id=$1 ORDER BY created_at DESC LIMIT 1", [id])).rows[0].payload;
    assert.match(out.text.body, /מוכן לפרסום/); assert.match(out.text.body, /לא הספקתי להכין תמונה/);
  } finally { await close(); }
});
