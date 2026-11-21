'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('./helpers/isolatedDatabase');
const speed = require('../leadSpeed');

test('Meta form answers become short readable pairs, contact fields excluded', () => {
  const answers = speed.formAnswers([
    { name: 'full_name', values: ['יוסי לוי'] },
    { name: 'phone_number', values: ['0521234567'] },
    { name: 'what_treatment_are_you_interested_in?', values: ['הלבנת שיניים'] },
    { name: 'empty', values: [''] }
  ]);
  assert.deepEqual(answers, [{ question: 'what treatment are you interested in', answer: 'הלבנת שיניים' }]);
  assert.match(speed.answersNote(answers), /^תשובות מהטופס:\n• what treatment/);
  assert.equal(speed.answersNote([]), '');
});

test('drafted messages may not invent prices, numbers or links', () => {
  const source = { facts: { offer: 'בדיקה ראשונה ב־99 ₪' }, answers: [] };
  assert.ok(speed.safeMessage('היי יוסי, כאן דנה ממרפאת סמייל 😊 ראיתי שהתעניינת בהלבנה. מתי נוח לדבר?', source));
  assert.ok(speed.safeMessage('היי יוסי, הבדיקה הראשונה אצלנו ב־99 ₪. מתי נוח לך?', source), 'a price from the facts is fine');
  assert.equal(speed.safeMessage('היי יוסי, הלבנה אצלנו רק 450 ₪! מתי נוח?', source), null);
  assert.equal(speed.safeMessage('היי יוסי, 20% הנחה למצטרפים היום!', { facts: {}, answers: [] }), null);
  assert.equal(speed.safeMessage('היי יוסי, הנה הקישור https://x.co לקביעת תור', source), null);
  assert.equal(speed.safeMessage('היי', source), null, 'too short');
});

test('response times read naturally in Hebrew', () => {
  assert.equal(speed.duration(0.4), 'פחות מדקה');
  assert.equal(speed.duration(7), '7 דקות');
  assert.equal(speed.duration(60), 'שעה');
  assert.equal(speed.duration(150), '2.5 שעות');
  assert.equal(speed.duration(48 * 60), 'יומיים');
  assert.equal(speed.duration(null), '—');
});

test('the first message uses the business facts, and falls back to a template when the writer fails', async () => {
  const { db, close } = await openDatabase();
  try {
    const client = (await db.query("INSERT INTO clients(phone,display_name) VALUES('972500000561','דנה כהן') RETURNING id")).rows[0].id;
    const lead = { id: '00000000-0000-4000-8000-000000000561', name: 'יוסי לוי' };
    let seen;
    const good = await speed.firstMessage(client, lead, {
      answers: [{ question: 'treatment', answer: 'הלבנה' }],
      writer: async (input) => { seen = input; return { message: 'היי יוסי, כאן דנה 😊 ראיתי שהתעניינת בהלבנה. מתי נוח לך לדבר כמה דקות?' }; }
    });
    assert.equal(good.ai, true);
    assert.match(good.text, /הלבנה/);
    assert.equal(seen.lead.firstName, 'יוסי');
    assert.equal(seen.ownerName, 'דנה');
    assert.equal(seen.lead.phone, undefined, 'the AI never sees the lead phone');
    const invented = await speed.firstMessage(client, lead, { writer: async () => ({ message: 'היי יוסי, הלבנה אצלנו ב־300 ₪ בלבד! מתי נוח?' }) });
    assert.equal(invented.ai, false);
    assert.equal(invented.text, 'היי יוסי, כאן דנה 😊 ראיתי שהשארת פרטים, תודה! מתי נוח לך לדבר כמה דקות?');
    const broken = await speed.firstMessage(client, lead, { writer: async () => { throw Error('AI_DOWN'); } });
    assert.equal(broken.ai, false);
  } finally { await close(); }
});

test('the alert carries the ready message and one-tap buttons, and "התקשרתי" measures the response time', async () => {
  const { db, close } = await openDatabase();
  try {
    const phone = '972500000562';
    const client = (await db.query("INSERT INTO clients(phone) VALUES($1) RETURNING id", [phone])).rows[0].id;
    await db.query('INSERT INTO whatsapp_contacts(phone,last_inbound_at) VALUES($1,NOW())', [phone]);
    const crm = require('../crmService');
    const lead = await crm.create(client, { name: 'יוסי לוי', phone: '0521234567', source: 'meta_lead_ads', sourceEventId: 'speed-562' });
    await db.query("UPDATE crm_leads SET created_at=NOW()-INTERVAL '6 minutes' WHERE id=$1", [lead.id]);
    const ready = 'היי יוסי, כאן מהמרפאה 😊 ראיתי שהתעניינת בהלבנה. מתי נוח לך לדבר?';
    const result = await require('../leadAlert').notifyOwner(client, lead, { answers: [{ question: 'treatment', answer: 'הלבנה' }], writer: async () => ({ message: ready }) });
    assert.equal(result.status, 'QUEUED');
    const out = (await db.query('SELECT payload FROM whatsapp_outbox WHERE client_id=$1 ORDER BY created_at, id', [client])).rows.map((r) => r.payload);
    assert.equal(out.length, 2, 'alert text, then the buttons');
    assert.match(out[0].text.body, /wa\.me\/972521234567\?text=/);
    assert.ok(out[0].text.body.includes(encodeURIComponent(ready)));
    assert.match(out[0].text.body, /treatment: הלבנה/);
    assert.equal(out[1].interactive.action.buttons.length, 2);
    assert.equal((await db.query('SELECT ready_message FROM crm_leads WHERE id=$1', [lead.id])).rows[0].ready_message, ready);

    // The button choice routes to /lead-contacted <id>.
    const p = await require('../marketingStore').load(client);
    assert.equal(p.ui.decisionKey, 'lead_contact');
    assert.equal(p.ui.choices[0].text, '/lead-contacted ' + lead.id);
    assert.equal(require('../conversationController').acceptsInteractive(p), true);
    const reply = await speed.handleReply(phone, p.ui.choices[0].text);
    assert.equal(reply.status, 'CONTACTED');
    assert.match(reply.reply, /תוך 6 דקות/);
    const row = (await db.query('SELECT status, first_contact_at FROM crm_leads WHERE id=$1', [lead.id])).rows[0];
    assert.equal(row.status, 'CONTACTED');
    assert.ok(row.first_contact_at);
    assert.equal((await speed.handleReply(phone, '/lead-contacted ' + lead.id)).status, 'ALREADY');

    // A later stage keeps the first contact time.
    const current = (await db.query('SELECT version FROM crm_leads WHERE id=$1', [lead.id])).rows[0].version;
    await crm.update(client, lead.id, { status: 'APPOINTMENT', version: current });
    const after = (await db.query('SELECT first_contact_at FROM crm_leads WHERE id=$1', [lead.id])).rows[0].first_contact_at;
    assert.equal(after.getTime(), row.first_contact_at.getTime());

    const stats = await speed.stats(client, 30);
    assert.equal(stats.leads, 1);
    assert.ok(stats.avgMinutes >= 5.9 && stats.avgMinutes < 7);
    assert.equal(stats.label, '6 דקות');
    assert.equal(stats.fastShare, 1);
    const report = require('../businessReport');
    const built = await report.build(client, 'last_7d', { spendFor: async () => null });
    assert.equal(built.speed.leads, 1);
    assert.match(report.format(built), /זמן תגובה ממוצע: 6 דקות/);
  } finally { await close(); }
});

test('plain "התקשרתי" marks the last alerted lead; an open decision keeps its own buttons', async () => {
  const { db, close } = await openDatabase();
  try {
    const phone = '972500000563';
    const client = (await db.query("INSERT INTO clients(phone) VALUES($1) RETURNING id", [phone])).rows[0].id;
    await db.query('INSERT INTO whatsapp_contacts(phone,last_inbound_at) VALUES($1,NOW())', [phone]);
    const store = require('../marketingStore');
    await store.update(client, null, (p) => { p.ui = { nonce: 'a'.repeat(24), decisionKey: 'action_approval', choices: [], expiresAt: Date.now() + 60000 }; return { handled: false, changed: true }; });
    const lead = await require('../crmService').create(client, { name: 'רותם', phone: '0527654321', source: 'meta_lead_ads', sourceEventId: 'speed-563' });
    await require('../leadAlert').notifyOwner(client, lead, { writer: async () => null });
    const out = (await db.query('SELECT payload FROM whatsapp_outbox WHERE client_id=$1', [client])).rows;
    assert.equal(out.length, 1, 'no buttons while an approval is open');
    assert.match(out[0].payload.text.body, /אחרי שחזרת אליו, רק תעדכן אותי/);
    const p = await store.load(client);
    assert.equal(p.ui.decisionKey, 'action_approval', 'the approval menu is untouched');
    assert.equal(p.leadSpeedLast, lead.id);
    assert.equal((await speed.handleReply(phone, 'התקשרתי')).status, 'CONTACTED');
    assert.equal((await store.load(client)).leadSpeedLast, undefined);
    assert.equal(await speed.handleReply(phone, 'מה שלומך'), null, 'other text is not ours');
    // Manually added leads are not part of the speed metric.
    const manual = await require('../crmService').create(client, { name: 'ידני', phone: '0520000000', source: 'manual' });
    await require('../crmService').update(client, manual.id, { status: 'CONTACTED', version: manual.version });
    assert.equal((await speed.stats(client, 30)).leads, 1);
  } finally { await close(); }
});
