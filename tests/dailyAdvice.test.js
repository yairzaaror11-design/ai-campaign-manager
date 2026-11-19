'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('./helpers/isolatedDatabase');
const advice = require('../dailyAdvice');

const TUESDAY_10 = new Date('2026-11-17T08:00:00Z'); // Tuesday 10:00 Israel
const camp = (id, name, x = {}) => ({ id, name, status: 'ACTIVE', ageDays: 20, dailyBudget: 0, spend7: 0, leads7: 0, impressions7: 8000, ctr7: 1.2, frequency7: 1.5, spend30: 0, ctr30: 1.2, won30: 0, revenue30: 0, ...x });
const crm = (x = {}) => ({ leads90: 0, won90: 0, wonWithRevenue90: 0, revenue90: 0, wonNoAmount: 0, waitingCount: 0, waitingNames: [], ...x });

test('sends only on business mornings, Sunday to Thursday 09:00–11:00 Israel time', () => {
  assert.equal(advice.morning(TUESDAY_10), true);
  assert.equal(advice.morning(new Date('2026-11-17T10:30:00Z')), false, '12:30 is too late');
  assert.equal(advice.morning(new Date('2026-11-17T06:30:00Z')), false, '08:30 is too early');
  assert.equal(advice.morning(new Date('2026-11-20T08:00:00Z')), false, 'Friday');
  assert.equal(advice.morning(new Date('2026-11-21T08:00:00Z')), false, 'Saturday');
  assert.equal(advice.israelTime(TUESDAY_10).day, '2026-11-17');
});

test('a quiet account gets no advice at all (no spam)', () => {
  assert.deepEqual(advice.candidates({}), []);
  assert.deepEqual(advice.candidates({ cpl30: 40, campaigns: [camp('1', 'יציב', { spend7: 200, leads7: 5, dailyBudget: 30 })], crm: crm({ waitingCount: 1 }) }), []);
  assert.deepEqual(advice.candidates({ cpl30: 40, campaigns: [camp('1', 'חדש', { ageDays: 1, spend7: 500 })] }), [], 'still learning');
});

test('pauses a campaign spending without leads, through an approval, with the real numbers', () => {
  const [a] = advice.candidates({ cpl30: 40, campaigns: [camp('11', 'דירות', { spend7: 320 })] });
  assert.equal(a.kind, 'PAUSE_WASTE');
  assert.match(a.why, /320 ₪/); assert.match(a.why, /40 ₪/);
  assert.deepEqual(a.action.steps.map((s) => [s.intent, s.campaignId]), [['PAUSE_CAMPAIGN', '11']]);
  assert.equal(advice.candidates({ cpl30: 40, guardRecent: ['WASTE:11'], campaigns: [camp('11', 'דירות', { spend7: 320 })] }).length, 0, 'the campaign guard already flagged it');
});

test('moves budget by cost per lead, lowering the expensive campaign first', () => {
  const [a] = advice.candidates({ cpl30: 40, campaigns: [
    camp('1', 'יקר', { dailyBudget: 100, spend7: 500, leads7: 5 }),
    camp('2', 'זול', { dailyBudget: 50, spend7: 250, leads7: 10 })
  ] });
  assert.equal(a.kind, 'SHIFT_BUDGET');
  assert.match(a.title, /20 ₪ ביום מ"יקר" ל"זול"/);
  assert.match(a.why, /ליד עולה 25 ₪/); assert.match(a.why, /100 ₪/);
  assert.match(a.impactText, /בערך 1–3 לידים נוספים בשבוע/);
  assert.deepEqual(a.action.steps.map((s) => [s.campaignId, s.dailyBudget]), [['1', 80], ['2', 70]]);
});

test('with real sales in the CRM, ranks by cost per sale and revenue, not by leads', () => {
  const data = { cpl30: 40, crm: crm({ leads90: 40, won90: 5, wonWithRevenue90: 5, revenue90: 10000 }), campaigns: [
    // more leads and a cheaper lead, but almost no sales
    camp('1', 'הרבה לידים', { dailyBudget: 100, spend7: 500, leads7: 25, spend30: 2000, won30: 1, revenue30: 1500 }),
    camp('2', 'מוכר', { dailyBudget: 50, spend7: 250, leads7: 5, spend30: 1000, won30: 4, revenue30: 8000 }),
    camp('3', 'בזבוז', { spend7: 300 })
  ] };
  const list = advice.candidates(data);
  assert.deepEqual(list.map((x) => x.kind), ['SHIFT_BUDGET', 'PAUSE_WASTE'], 'biggest revenue impact first');
  assert.match(list[0].title, /מ"הרבה לידים" ל"מוכר"/);
  assert.match(list[0].why, /מכירה עולה לך 250 ₪ \(4 מכירות בחודש, 8,000 ₪ הכנסות\)/);
  assert.match(list[0].why, /עלות למכירה היא 2,000 ₪/);
  assert.match(list[0].impactText, /מכירות נוספות בחודש/); assert.match(list[0].impactText, /הכנסות נוספות בשבוע/);
});

test('suggests a fresh creative when the ad wears out', () => {
  const [a] = advice.candidates({ cpl30: 60, campaigns: [camp('5', 'שיפוצים', { spend7: 200, leads7: 4, frequency7: 4.2, ctr7: 0.6, ctr30: 1.4 })] });
  assert.equal(a.kind, 'REFRESH_CREATIVE'); assert.equal(a.action.type, 'TEXT');
  assert.match(a.why, /4\.2 פעמים/); assert.match(a.why, /57%/); assert.match(a.action.text, /שיפוצים/);
});

test('follow-up and missing revenue advice come from the CRM, with cautious estimates', () => {
  const list = advice.candidates({ crm: crm({ leads90: 30, won90: 5, wonWithRevenue90: 3, revenue90: 6000, wonNoAmount: 2, waitingCount: 4, waitingNames: ['דנה לוי', 'יוסי'] }) });
  assert.deepEqual(list.map((x) => x.kind), ['FOLLOW_UP_LEADS', 'ADD_REVENUE']);
  assert.match(list[0].why, /דנה, יוסי ועוד 2/); assert.match(list[0].why, /1 מכל 6 לידים קונה, בממוצע ב־2,000 ₪/);
  assert.equal(list[0].action.text, 'הלידים שלי');
  assert.match(list[1].why, /עלות למכירה והחזר על הפרסום/);
});

test('the message stays short, has what/why/impact and three valid buttons', () => {
  const [a] = advice.candidates({ cpl30: 40, campaigns: [camp('11', 'דירות'.repeat(20), { spend7: 320 })] });
  const text = advice.message(a);
  assert.ok(text.length < 1024);
  assert.match(text, /ההמלצה של היום/); assert.match(text, /למה:/); assert.match(text, /מה זה ייתן:/); assert.match(text, /בלי אישור שלך/);
  const b = advice.buttons(a, 7);
  assert.deepEqual(b.map((x) => x.text), ['/advice-yes 7', '/advice-later 7', '/advice-dash 7']);
  assert.ok(b.every((x) => x.title.length <= 20));
  require('../conversationUi').payload(text, b, 'a'.repeat(24));
});

test('one advice per morning, "לא עכשיו" is respected for 3 days, approvals go through the approval engine', async () => {
  process.env.META_APP_ID = process.env.META_APP_ID || '123';
  process.env.META_TOKEN_ENCRYPTION_KEY = process.env.META_TOKEN_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64');
  const { db, close } = await openDatabase();
  const PHONE = '972500000881';
  const inbound = (work, owner = id) => require('../metaConnection').context.run(String(owner), () => require('../whatsappDelivery').messageContext.run({ eventId: 'advice-test-' + Math.random(), sequence: 0 }, work));
  const clearUi = () => require('../marketingStore').update(id, null, (p) => { delete p.ui; return { handled: false, changed: true }; });
  const sent = async () => (await db.query('SELECT payload FROM whatsapp_outbox WHERE client_id=$1 ORDER BY id', [id])).rows.map((r) => JSON.stringify(r.payload));
  let id;
  try {
    id = (await db.query('INSERT INTO clients(phone) VALUES($1) RETURNING id', [PHONE])).rows[0].id;
    await db.query('INSERT INTO whatsapp_contacts(phone,last_inbound_at) VALUES($1,NOW())', [PHONE]);
    const data = { cpl30: 40, campaigns: [camp('1', 'יקר', { dailyBudget: 100, spend7: 500, leads7: 5 }), camp('2', 'זול', { dailyBudget: 50, spend7: 250, leads7: 10 })], crm: crm({ waitingCount: 3, waitingNames: ['דנה'] }) };
    const only = [id], loader = async () => data;

    assert.equal((await advice.runDue({ now: new Date('2026-11-20T08:00:00Z'), loader, onlyClientIds: only })).status, 'NOT_DUE', 'no advice on Friday');
    const first = await advice.runDue({ now: TUESDAY_10, loader, onlyClientIds: only });
    assert.deepEqual(first.results, ['SENT']);
    const again = await advice.runDue({ now: TUESDAY_10, loader, onlyClientIds: only });
    assert.deepEqual(again.results, [], 'already advised today');
    let out = (await sent()).filter((x) => /ההמלצה של היום/.test(x));
    assert.equal(out.length, 1); assert.match(out[0], /להעביר 20 ₪ ביום/); assert.match(out[0], /לא עכשיו/); assert.match(out[0], /דשבורד ביצועים/);

    const row = (await db.query('SELECT * FROM daily_advice WHERE client_id=$1', [id])).rows[0];
    assert.equal(row.kind, 'SHIFT_BUDGET');
    const card = await require('../dashboardFeed').today(id);
    assert.ok(card.some((x) => x.kind === 'DAILY_ADVICE' && /ההמלצה של היום: להעביר/.test(x.text)), 'shown on the dashboard today card');

    // "Not now": no repeat of the same advice for 3 days; the next best one is offered instead.
    await inbound(() => advice.handleReply(PHONE, '/advice-later ' + row.id));
    assert.equal((await db.query('SELECT status FROM daily_advice WHERE id=$1', [row.id])).rows[0].status, 'DISMISSED');
    assert.ok(!(await require('../dashboardFeed').today(id)).some((x) => x.kind === 'DAILY_ADVICE'));
    await clearUi();
    const wed = await advice.runDue({ now: new Date('2026-11-18T08:00:00Z'), loader, onlyClientIds: only });
    assert.deepEqual(wed.results, ['SENT']);
    const second = (await db.query("SELECT * FROM daily_advice WHERE client_id=$1 AND day='2026-11-18'", [id])).rows[0];
    assert.equal(second.kind, 'FOLLOW_UP_LEADS', 'the dismissed budget move is not repeated');

    // Approving a CRM advice continues in the normal conversation.
    assert.deepEqual(await inbound(() => advice.handleReply(PHONE, '/advice-yes ' + second.id)), { handled: true, route: 'הלידים שלי' });
    assert.equal(await advice.handleReply(PHONE, 'סתם טקסט'), null);
    const other = (await db.query("INSERT INTO clients(phone) VALUES('972500000882') RETURNING id")).rows[0].id;
    assert.deepEqual(await inbound(() => advice.handleReply('972500000882', '/advice-yes ' + second.id), other), { handled: true }, 'another owner cannot use it');
    assert.match(JSON.stringify((await db.query('SELECT payload FROM whatsapp_outbox WHERE client_id=$1', [other])).rows[0].payload), /כבר לא זמינה/);

    // Approving a Meta advice raises approvals step by step, never executes on its own.
    const plans = [];
    const approve = async (clientId, plan) => {
      plans.push(plan);
      const full = { ...plan, target: { ...plan.target, accountId: 'act_1' }, parameters: { ...plan.parameters, dailyBudgetMinor: Number(plan.parameters.dailyBudget || 0) * 100, currency: 'ILS' } };
      await db.query("INSERT INTO action_plans(id,client_id,intent,payload,status,plan_hash,account_id,connection_generation) VALUES($1,$2,$3,$4::jsonb,'PROPOSED','h','act_1',0)", [plan.id, clientId, plan.intent, JSON.stringify(full)]);
      return { actionId: plan.id, actionPlan: full, expiresAt: new Date(Date.now() + 600000) };
    };
    await db.query("UPDATE daily_advice SET status='SENT' WHERE id=$1", [row.id]);
    assert.deepEqual(await inbound(() => advice.handleReply(PHONE, '/advice-yes ' + row.id, { approve })), { handled: true });
    assert.deepEqual(plans.map((p) => [p.intent, p.target.campaignId, p.parameters.dailyBudget]), [['CHANGE_BUDGET', '1', '80']], 'lower the expensive campaign first');
    assert.equal(await advice.ownsApproval(id, plans[0].id), true);
    assert.equal(await advice.ownsApproval(id, 'NOTMINE1'), false);
    assert.equal((await advice.continueShifts({ approve, onlyClientIds: only })).length, 0, 'step 2 waits until step 1 is verified');
    await db.query("UPDATE action_plans SET status='VERIFIED' WHERE id=$1", [plans[0].id]);
    assert.deepEqual(await advice.continueShifts({ approve, onlyClientIds: only }), ['PROPOSED']);
    assert.deepEqual(plans.map((p) => [p.target.campaignId, p.parameters.dailyBudget]), [['1', '80'], ['2', '70']]);
    assert.deepEqual(await advice.continueShifts({ approve, onlyClientIds: only }), [], 'never raised twice');
    out = await sent();
    assert.ok(out.some((x) => /שלב 1 מתוך 2/.test(x)));
    assert.ok(out.some((x) => /עכשיו השלב הבא/.test(x)));
  } finally { await close(); }
});
