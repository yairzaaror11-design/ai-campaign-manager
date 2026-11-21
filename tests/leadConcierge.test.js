'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('./helpers/isolatedDatabase');
const lc = require('../leadConcierge');

process.env.LEAD_CONCIERGE_ENABLED = 'true';
process.env.WHATSAPP_SEND_ENABLED = 'true';
process.env.LEAD_FIRST_MESSAGE_AI = 'false';

let seq = 0;
const now = () => String(Math.floor(Date.now() / 1000));
const text = (from, body) => ({ id: `wamid.lc${++seq}.${Date.now()}`, from, timestamp: now(), type: 'text', text: { body } });
const quick = (from, body) => ({ id: `wamid.lc${++seq}.${Date.now()}`, from, timestamp: now(), type: 'button', button: { text: body, payload: body } });

async function setup(db, n, { optIn = true, availability = null, template = true, vertical = 'real_estate' } = {}) {
  const owner = '9725000006' + n, leadPhone = '05200006' + n, wa = '9725200006' + n;
  const clientId = (await db.query("INSERT INTO clients(phone,display_name) VALUES($1,'יוסי כהן') RETURNING id", [owner])).rows[0].id;
  await db.query('INSERT INTO whatsapp_contacts(phone,last_inbound_at) VALUES($1,NOW())', [owner]);
  await lc.saveSettings(clientId, { vertical, ...(optIn ? { enabled: true } : {}), ...(availability ? { availability } : {}) });
  if (template) { process.env.WA_TEMPLATE_LEAD_FIRST_CONTACT = 'lead_first_contact'; process.env.WHATSAPP_APPROVED_TEMPLATES = 'lead_first_contact,viewing_reminder'; }
  else delete process.env.WA_TEMPLATE_LEAD_FIRST_CONTACT;
  const lead = await require('../crmService').create(clientId, { name: 'דנה לוי', phone: leadPhone, source: 'meta_lead_ads', sourceEventId: 'lc-' + n + '-' + Date.now() });
  return { owner, wa, clientId, lead };
}
const outbox = async (db, clientId, recipient) => (await db.query('SELECT payload,status,id FROM whatsapp_outbox WHERE client_id=$1 AND recipient=$2 ORDER BY delivery_order', [clientId, recipient])).rows;
const conversation = async (db, clientId, leadId) => (await db.query('SELECT * FROM lead_conversations WHERE client_id=$1 AND lead_id=$2', [clientId, leadId])).rows[0];
async function tap(db, clientId, leadId, from, title) {
  const conv = await conversation(db, clientId, leadId);
  const i = conv.ui.choices.findIndex((c) => c.title === title);
  assert.ok(i >= 0, `choice ${title} offered (have: ${conv.ui.choices.map((c) => c.title).join(' | ')})`);
  return { id: `wamid.lc${++seq}.${Date.now()}`, from, timestamp: now(), type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: `lc:${conv.ui.nonce}:${i}`, title } } };
}
const route = (m) => require('../messageHandler').handleIncomingMessage(m, {});
const bodyOf = (p) => p.text?.body || p.interactive?.body?.text || '';

test('qualification asks at most 4 questions, understands typed answers and scores the lead', () => {
  assert.equal(lc.nextQuestion({}, 0), 'intent');
  assert.equal(lc.nextQuestion({ intent: { value: 'BUY' } }, 1), 'budget');
  assert.equal(lc.nextQuestion({ intent: { value: 'BUY' }, budget: {}, area: {} }, 3), 'timing');
  assert.equal(lc.nextQuestion({ intent: { value: 'BUY' }, budget: {}, area: {} }, 4), null, 'never more than 4');
  assert.equal(lc.nextQuestion({ intent: { value: 'BUY', source: 'property' }, area: {}, budget: {}, timing: {} }, 2), 'mortgage', 'known facts free a slot for the mortgage');
  assert.equal(lc.nextQuestion({ intent: { value: 'RENT' }, budget: {}, area: {}, timing: {} }, 3), null, 'renters are not asked about a mortgage');
  assert.equal(lc.nextQuestion({ intent: { value: 'SELL' } }, 1), null);
  assert.equal(lc.matchAnswer('intent', 'אנחנו רוצים לקנות', []).value, 'BUY');
  assert.equal(lc.matchAnswer('timing', 'כמה שיותר מהר', []).value, 'NOW');
  assert.equal(lc.matchAnswer('mortgage', 'כן יש', []).value, 'APPROVED');
  assert.equal(lc.matchAnswer('area', 'גבעתיים', [], { free: true }).value, 'גבעתיים');
  assert.equal(lc.matchAnswer('area', 'גבעתיים', []), null, 'typed text only where the question allows it');
  assert.equal(lc.matchAnswer('area', 'כמה זה עולה?', [], { free: true }), null);
  assert.equal(lc.matchAnswer('intent', '2', [{ title: 'קנייה', value: 'BUY' }, { title: 'שכירות', value: 'RENT' }]).value, 'RENT');
  assert.equal(lc.score({ intent: { value: 'BUY' }, budget: { value: '2.5–3.5 מיליון' }, timing: { value: 'NOW', points: 3 }, mortgage: { value: 'APPROVED', points: 2 } }), 'HOT');
  assert.equal(lc.score({ intent: { value: 'BUY' }, budget: { value: 'x' }, timing: { value: '3-6', points: 1 } }), 'WARM');
  assert.equal(lc.score({ intent: { value: 'BUY' }, timing: { value: 'BROWSING', points: -2 } }), 'COLD');
  assert.equal(lc.score({ need: { value: 'שיפוץ מטבח' }, timing: { value: 'NOW', points: 3 }, budget: { value: '40,000' } }), 'HOT', 'any business type');
});

test('availability is parsed from Hebrew and turns into 3 free slots in Israel time', () => {
  const a = lc.parseAvailability('א-ה 10:00-18:00');
  assert.deepEqual(a, [{ days: [0, 1, 2, 3, 4], start: '10:00', end: '18:00' }]);
  assert.deepEqual(lc.parseAvailability('ראשון עד חמישי 16-20'), [{ days: [0, 1, 2, 3, 4], start: '16:00', end: '20:00' }]);
  assert.equal(lc.parseAvailability('מחר בבוקר'), null);
  assert.equal(lc.availabilityText(a), 'א׳–ה׳ 10:00–18:00');
  // Sunday 15.11.2026 08:00 Israel (UTC+2) → first slots 11:00 Sun, then Mon, Tue at 10:00.
  const from = lc.zonedToUtc(2026, 11, 15, 8, 0);
  assert.equal(from.toISOString(), '2026-11-15T06:00:00.000Z');
  const slots = lc.freeSlots(a, 60, [], { now: from });
  assert.equal(slots.length, 3);
  assert.deepEqual(slots.map((s) => lc.slotLabel(s)), ['יום א׳ 15.11 · 11:00', 'יום ב׳ 16.11 · 10:00', 'יום ג׳ 17.11 · 10:00']);
  const busy = lc.freeSlots(a, 60, [slots[0]], { now: from });
  assert.ok(!busy.some((s) => s.getTime() === slots[0].getTime()), 'a booked slot is never offered again');
  assert.equal(lc.zonedToUtc(2026, 7, 1, 10, 0).toISOString(), '2026-07-01T07:00:00.000Z', 'summer time');
});

test('every business type gets its own short question set and meeting word', () => {
  const profiles = require('../conciergeProfiles');
  assert.equal(profiles.detect({ businessType: 'משרד תיווך נדל״ן' }), 'real_estate');
  assert.equal(profiles.detect({ businessType: 'סטודיו לפילאטיס' }), 'fitness');
  assert.equal(profiles.detect({ businessType: 'חנות בגדים אונליין' }), 'retail');
  assert.equal(profiles.detect({ businessType: 'שיפוצים כלליים' }), 'services');
  assert.equal(profiles.detect({}), 'default');
  assert.equal(lc.nextQuestion({}, 0, 'services'), 'need');
  assert.equal(lc.nextQuestion({ need: {}, area: {}, timing: {} }, 3, 'services'), 'budget');
  assert.equal(lc.nextQuestion({ product: {}, quantity: {}, delivery: {} }, 3, 'retail'), null);
  assert.equal(lc.nextQuestion({}, 0, 'default'), 'need');
  for (const key of profiles.KEYS) {
    const p = profiles.PROFILES[key];
    assert.ok(p.questions.length >= 3, key);
    for (const q of p.questions) {
      const opts = typeof q.options === 'function' ? q.options({}) : q.options;
      assert.ok(opts.length >= 1 && opts.length <= 10, key + ':' + q.key);
      assert.ok(opts.every(([t]) => t.length <= (opts.length <= 3 ? 20 : 24)), 'WhatsApp button/list title limits: ' + key + ':' + q.key);
    }
  }
  assert.equal(profiles.get('retail').meeting, null, 'shops do not book meetings');
  assert.equal(profiles.get('fitness').meeting.noun, 'אימון ניסיון');
});

test('template configuration and property data are read defensively', () => {
  delete process.env.WHATSAPP_APPROVED_TEMPLATES;
  assert.equal(lc.templateConfig('').reason, 'NO_TEMPLATE');
  assert.equal(lc.templateConfig('lead_first_contact').reason, 'TEMPLATE_NOT_APPROVED');
  process.env.WHATSAPP_APPROVED_TEMPLATES = 'lead_first_contact';
  assert.equal(lc.templateConfig('lead_first_contact').name, 'lead_first_contact');
  assert.deepEqual(lc.propertySubject({ title: 'דירת 4 חדרים בגבעתיים', city: 'גבעתיים', deal_type: 'SALE' }), { subject: 'דירת 4 חדרים בגבעתיים', area: 'גבעתיים', intent: 'BUY', vertical: 'real_estate' });
  assert.equal(lc.propertySubject({ property_kind: 'GARDEN', neighbourhood: 'בורוכוב', city: 'גבעתיים', deal_type: 'RENT' }).subject, 'דירת גן בבורוכוב');
  assert.equal(lc.propertySubject({ name: 'נעלי ריצה', price: 300 }, 'catalog_items').vertical, null, 'a catalog item keeps the business type');
  assert.equal(lc.propertySubject({ city: 'רמת גן', deal_type: 'rent' }).subject, 'הנכס ברמת גן');
  assert.equal(lc.propertySubject(null), null);
});

test('owner opt-in: an undecided business gets today\'s alert plus one button question', async () => {
  const { db, close } = await openDatabase();
  try {
    const { owner, wa, clientId, lead } = await setup(db, '41', { optIn: false });
    const result = await lc.onNewLead(clientId, lead, {});
    assert.equal(result.status, 'QUEUED', 'the regular owner alert still goes out');
    assert.equal((await outbox(db, clientId, wa)).length, 0, 'nothing is sent to the lead before the owner opts in');
    const toOwner = (await outbox(db, clientId, owner)).map((r) => r.payload);
    assert.match(toOwner[0].text.body, /wa\.me\/972520000641/);
    const question = toOwner.at(-1);
    assert.equal(question.type, 'interactive');
    assert.match(question.interactive.body.text, /^שהסוכן יענה ראשון ללידים בשם המשרד\?/);
    assert.deepEqual(question.interactive.action.buttons.map((b) => b.reply.title), ['כן, שיענה', 'לא כרגע']);
    assert.ok((await lc.settings(clientId)).asked_at);
    const yes = await lc.handleOwnerText(owner, '/lc-optin yes');
    assert.match(yes.reply, /הסוכן עונה ראשון/);
    assert.equal(yes.decisionKey, 'lead_concierge_hours', 'then asks for viewing hours once');
    assert.equal((await lc.settings(clientId)).enabled, true);
    const hours = await lc.handleOwnerText(owner, 'זמינות א-ה 10:00-18:00');
    assert.match(hours.reply, /א׳–ה׳ 10:00–18:00/);
    assert.equal(await lc.handleOwnerText(owner, 'זמינות המוצר במלאי'), null, 'unrelated owner text is left alone');
    const off = await lc.handleOwnerText(owner, 'כבה מענה ללידים');
    assert.match(off.reply, /הודעה מוכנה/);
    assert.equal((await lc.settings(clientId)).enabled, false);
  } finally { await close(); }
});

test('no approved template: falls back to the owner alert and records why', async () => {
  const { db, close } = await openDatabase();
  try {
    const { owner, wa, clientId, lead } = await setup(db, '42', { template: false });
    const result = await lc.onNewLead(clientId, lead, {});
    assert.equal(result.conciergeFallback, 'NO_TEMPLATE');
    assert.equal((await outbox(db, clientId, wa)).length, 0);
    assert.match((await outbox(db, clientId, owner))[0].payload.text.body, /הודעה אישית מוכנה/);
    const ev = (await db.query("SELECT detail FROM lead_events WHERE client_id=$1 AND lead_id=$2 AND kind='CONCIERGE_FALLBACK'", [clientId, lead.id])).rows;
    assert.deepEqual(ev.map((e) => e.detail), ['NO_TEMPLATE']);
    assert.equal(await conversation(db, clientId, lead.id), undefined);
  } finally { await close(); }
});

test('first contact goes out as the approved template, and a failed send falls back to the owner', async () => {
  const { db, close } = await openDatabase();
  try {
    const { owner, wa, clientId, lead } = await setup(db, '43');
    const result = await lc.onNewLead(clientId, lead, {});
    assert.equal(result.status, 'CONCIERGE');
    const [first] = await outbox(db, clientId, wa);
    assert.equal(first.payload.type, 'template');
    assert.equal(first.payload.template.name, 'lead_first_contact');
    assert.deepEqual(first.payload.template.components[0].parameters.map((p) => p.text), ['דנה', 'יוסי', 'חיפוש נכס']);
    assert.equal((await db.query('SELECT opted_in FROM whatsapp_contacts WHERE phone=$1', [wa])).rows[0].opted_in, true);
    const conv = await conversation(db, clientId, lead.id);
    assert.equal(conv.status, 'CONTACTED');
    assert.equal((await db.query('SELECT status FROM crm_leads WHERE id=$1', [lead.id])).rows[0].status, 'CONTACTED');
    const logged = (await db.query("SELECT body FROM lead_messages WHERE conversation_id=$1 AND direction='OUT'", [conv.id])).rows;
    assert.match(logged[0].body, /^שלום דנה, כאן יוסי 👋[\s\S]*כתבו ״הסר״/, 'the owner sees the exact text sent in his name');
    assert.match((await outbox(db, clientId, owner))[0].payload.interactive.body.text, /הסוכן כבר שלח לליד הודעה בשמך/);
    // Meta rejects the template → the next background run falls back.
    await db.query("UPDATE whatsapp_outbox SET status='FAILED' WHERE id=$1", [first.id]);
    await lc.runDue();
    const after = await conversation(db, clientId, lead.id);
    assert.equal(after.status, 'FALLBACK');
    assert.equal(after.fallback_reason, 'SEND_FAILED');
    assert.ok((await outbox(db, clientId, owner)).some((r) => /wa\.me\/972520000643/.test(r.payload.text?.body || '')), 'owner gets the one-tap message');
  } finally { await close(); }
});

test('routing: lead replies go to the lead conversation, owner messages and strangers do not', async () => {
  const { db, close } = await openDatabase();
  try {
    const { owner, wa, clientId, lead } = await setup(db, '44');
    await lc.onNewLead(clientId, lead, {});
    assert.equal(await lc.routeInbound(text(owner, 'הלידים שלי')), false, 'the owner always reaches his own agent');
    assert.equal(await lc.routeInbound(text('972520000699', 'שלום')), false, 'a stranger is not a lead');
    await route(quick(wa, 'כן, אפשר'));
    assert.equal((await db.query('SELECT 1 FROM clients WHERE phone=$1', [wa])).rows.length, 0, 'a lead never becomes a SCORPIO client');
    const conv = await conversation(db, clientId, lead.id);
    assert.equal(conv.status, 'QUALIFYING');
    assert.equal(conv.ui.key, 'intent');
    const toLead = await outbox(db, clientId, wa);
    assert.equal(toLead.at(-1).payload.type, 'interactive');
    assert.match(bodyOf(toLead.at(-1).payload), /לקנות או לשכור/);
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM lead_messages WHERE conversation_id=$1 AND direction='IN'", [conv.id])).rows[0].n, 1);
  } finally { await close(); }
});

test('qualification, booking a viewing, the owner card, the reminder and the outcome question', async () => {
  const { db, close } = await openDatabase();
  try {
    const { owner, wa, clientId, lead } = await setup(db, '45', { availability: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' }] });
    await lc.onNewLead(clientId, lead, {});
    await route(text(wa, 'כן'));
    await route(await tap(db, clientId, lead.id, wa, 'קנייה'));
    await route(await tap(db, clientId, lead.id, wa, '2.5–3.5 מיליון'));
    await route(text(wa, 'גבעתיים'));
    await route(await tap(db, clientId, lead.id, wa, 'מיידי (עד חודש)'));
    let conv = await conversation(db, clientId, lead.id);
    assert.equal(conv.ui.asked, 4);
    assert.equal(conv.status, 'SCHEDULING', 'after 4 questions it offers viewing times');
    assert.equal(conv.score, 'HOT');
    assert.deepEqual(Object.keys(conv.answers).sort(), ['area', 'budget', 'intent', 'timing']);
    assert.equal(conv.ui.choices.length, 4, '3 slots and "another time"');
    assert.equal(conv.ui.choices.at(-1).title, 'מועד אחר');
    const slot = conv.ui.choices[0];
    await route(await tap(db, clientId, lead.id, wa, slot.title));
    conv = await conversation(db, clientId, lead.id);
    assert.equal(conv.status, 'BOOKED');
    const viewing = (await db.query('SELECT * FROM lead_viewings WHERE client_id=$1 AND lead_id=$2', [clientId, lead.id])).rows[0];
    assert.equal(new Date(viewing.starts_at).toISOString(), slot.value);
    assert.equal((await db.query('SELECT status FROM crm_leads WHERE id=$1', [lead.id])).rows[0].status, 'APPOINTMENT');
    const card = (await outbox(db, clientId, owner)).map((r) => bodyOf(r.payload)).find((b) => b.startsWith('📅 צפייה נקבעה'));
    assert.match(card, /דנה לוי, תקציב 2\.5–3\.5 מיליון, בגבעתיים, מיידי — צפייה ביום/);
    assert.match(bodyOf((await outbox(db, clientId, wa)).at(-1).payload), /קבענו צפייה/);
    // The same slot cannot be booked twice.
    await assert.rejects(db.query("INSERT INTO lead_viewings(id,client_id,lead_id,starts_at) VALUES(gen_random_uuid(),$1,$2,$3)", [clientId, lead.id, viewing.starts_at]));
    // Reminder: 2 hours before.
    await db.query("UPDATE lead_viewings SET starts_at=NOW()+INTERVAL '90 minutes' WHERE id=$1", [viewing.id]);
    await lc.runDue();
    assert.match(bodyOf((await outbox(db, clientId, wa)).at(-1).payload), /^תזכורת מיוסי: מחכים לכם היום בשעה/);
    assert.equal((await db.query('SELECT reminder_status FROM lead_viewings WHERE id=$1', [viewing.id])).rows[0].reminder_status, 'SENT_TEXT');
    await lc.runDue();
    assert.equal((await outbox(db, clientId, wa)).filter((r) => /^תזכורת/.test(bodyOf(r.payload))).length, 1, 'one reminder only');
    // After the viewing: one button question to the owner.
    await db.query("UPDATE lead_viewings SET starts_at=NOW()-INTERVAL '2 hours' WHERE id=$1", [viewing.id]);
    await lc.runDue();
    const ask = (await outbox(db, clientId, owner)).at(-1).payload;
    assert.match(ask.interactive.body.text, /^צפייה עם דנה לוי ביום .+: איך היה\?$/);
    assert.deepEqual(ask.interactive.action.buttons.map((b) => b.reply.title), ['הגיע', 'לא הגיע', 'מתקדמים']);
    const done = await lc.handleOwnerText(owner, 'מתקדמים');
    assert.match(done.reply, /מעולה/);
    assert.equal((await db.query('SELECT status FROM lead_viewings WHERE id=$1', [viewing.id])).rows[0].status, 'PROGRESSING');
  } finally { await close(); }
});

test('no availability: the lead is told the office will call, and the owner gets the summary', async () => {
  const { db, close } = await openDatabase();
  try {
    const { owner, wa, clientId, lead } = await setup(db, '46');
    await lc.onNewLead(clientId, lead, {});
    await route(text(wa, 'כן'));
    await route(text(wa, 'לשכור'));
    await route(await tap(db, clientId, lead.id, wa, '6,000–8,000 ₪'));
    await route(await tap(db, clientId, lead.id, wa, 'גמיש'));
    await route(text(wa, 'רק בודקים'));
    const conv = await conversation(db, clientId, lead.id);
    assert.equal(conv.status, 'DONE');
    assert.equal(conv.score, 'COLD', 'just browsing');
    assert.match(bodyOf((await outbox(db, clientId, wa)).at(-1).payload), /נחזור אליכם בהקדם לתאם צפייה/);
    assert.ok((await outbox(db, clientId, owner)).some((r) => /דנה לוי, שכירות, תקציב 6,000–8,000 ₪, אזור גמיש, רק בודקים/.test(bodyOf(r.payload))));
  } finally { await close(); }
});

test('safety: no prices or promises, honest about being a bot, distress hands off to the owner', async () => {
  const { db, close } = await openDatabase();
  try {
    const { owner, wa, clientId, lead } = await setup(db, '47');
    await lc.onNewLead(clientId, lead, {});
    await route(text(wa, 'כמה עולה הדירה?'));
    const priceReply = bodyOf((await outbox(db, clientId, wa))[1].payload);
    assert.match(priceReply, /נענה לכם אישית/);
    assert.doesNotMatch(priceReply, /\d/, 'never names a number');
    assert.ok((await outbox(db, clientId, owner)).some((r) => /שאל\/ה: ״כמה עולה הדירה\?״/.test(bodyOf(r.payload))));
    await route(text(wa, 'כן'));
    await route(text(wa, 'אתה בוט?'));
    const botReplies = (await outbox(db, clientId, wa)).map((r) => bodyOf(r.payload));
    assert.ok(botReplies.some((b) => /בוט\) של יוסי, לא אדם/.test(b)));
    assert.match(botReplies.at(-1), /לקנות או לשכור/, 'and continues with the open question');
    await route(text(wa, 'זו הטרדה, אני אגיש תלונה'));
    const conv = await conversation(db, clientId, lead.id);
    assert.equal(conv.status, 'OWNER');
    assert.equal(conv.handoff_reason, 'DISTRESS');
    const sent = (await outbox(db, clientId, wa)).length;
    await route(text(wa, 'שלום?'));
    assert.equal((await outbox(db, clientId, wa)).length, sent, 'the agent stays silent after a hand-off');
    assert.ok((await outbox(db, clientId, owner)).some((r) => /כתב\/ה: ״שלום\?״/.test(bodyOf(r.payload))), 'the owner still sees it');
  } finally { await close(); }
});

test('owner takeover stops the agent, and "הסר" stops all contact for good', async () => {
  const { db, close } = await openDatabase();
  try {
    const { owner, wa, clientId, lead } = await setup(db, '48');
    await lc.onNewLead(clientId, lead, {});
    await route(text(wa, 'כן'));
    const r = await lc.handleOwnerText(owner, '/lc-takeover ' + lead.id);
    assert.match(r.reply, /אתה ממשיך/);
    assert.equal((await conversation(db, clientId, lead.id)).status, 'OWNER');
    assert.match(bodyOf((await outbox(db, clientId, wa)).at(-1).payload), /נמשיך איתכם אישית/);
    const sent = (await outbox(db, clientId, wa)).length;
    await route(text(wa, 'קנייה'));
    assert.equal((await outbox(db, clientId, wa)).length, sent);
    assert.equal((await lc.takeover(clientId, lead.id)).status, 'ALREADY');
    // Opt-out works in any state.
    await route(text(wa, 'הסר'));
    assert.equal((await conversation(db, clientId, lead.id)).status, 'OPTED_OUT');
    assert.match(bodyOf((await outbox(db, clientId, wa)).at(-1).payload), /^הוסרתם/);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM lead_optouts WHERE client_id=$1 AND wa_phone=$2', [clientId, wa])).rows[0].n, 1);
    const again = await require('../crmService').create(clientId, { name: 'דנה לוי', phone: '0520000648', source: 'meta_lead_ads', sourceEventId: 'lc-48-again' });
    const result = await lc.onNewLead(clientId, again, {});
    assert.equal(result.conciergeFallback, 'OPTED_OUT', 'never contacted again by this business');
    // Dashboard data: answers, transcript, takeover state.
    const view = await lc.overview(clientId);
    assert.equal(view.conversations.find((c) => c.lead_id === lead.id).status, 'OPTED_OUT');
    const t = await lc.transcript(clientId, lead.id);
    assert.ok(t.messages.some((m) => m.direction === 'OUT' && /^שלום דנה/.test(m.body)));
    assert.ok(t.messages.some((m) => m.direction === 'IN' && m.body === 'הסר'));
  } finally { await close(); }
});

test('a service business: generic questions, a meeting instead of a viewing', async () => {
  const { db, close } = await openDatabase();
  try {
    const { owner, wa, clientId, lead } = await setup(db, '49', { vertical: 'services', availability: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' }] });
    await lc.onNewLead(clientId, lead, {});
    const [first] = await outbox(db, clientId, wa);
    assert.equal(first.payload.template.components[0].parameters[2].text, 'הפנייה שלכם');
    await route(text(wa, 'כן'));
    assert.match(bodyOf((await outbox(db, clientId, wa)).at(-1).payload), /במה אפשר לעזור/);
    await route(text(wa, 'שיפוץ מטבח'));
    await route(text(wa, 'רמת גן'));
    await route(await tap(db, clientId, lead.id, wa, 'כמה שיותר מהר'));
    await route(text(wa, 'בערך 40,000'));
    let conv = await conversation(db, clientId, lead.id);
    assert.equal(conv.status, 'SCHEDULING');
    assert.equal(conv.score, 'HOT');
    assert.match(conv.ui.body, /להגיע לפגישה\?$/);
    await route(await tap(db, clientId, lead.id, wa, conv.ui.choices[1].title));
    assert.match(bodyOf((await outbox(db, clientId, wa)).at(-1).payload), /^מעולה! קבענו פגישה ליום/);
    const card = (await outbox(db, clientId, owner)).map((r) => bodyOf(r.payload)).find((b) => b.startsWith('📅 פגישה נקבעה'));
    assert.match(card, /דנה לוי, שיפוץ מטבח, ברמת גן, מיידי, תקציב בערך 40,000 — פגישה ביום/);
  } finally { await close(); }
});

test('a shop: product questions and no meeting booking, the owner gets the summary', async () => {
  const { db, close } = await openDatabase();
  try {
    const { owner, wa, clientId, lead } = await setup(db, '50', { vertical: 'retail', availability: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' }] });
    await lc.onNewLead(clientId, lead, {});
    await route(text(wa, 'כן'));
    await route(text(wa, 'נעלי ריצה'));
    await route(await tap(db, clientId, lead.id, wa, '2–5'));
    await route(await tap(db, clientId, lead.id, wa, 'משלוח'));
    const conv = await conversation(db, clientId, lead.id);
    assert.equal(conv.status, 'DONE');
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM lead_viewings WHERE client_id=$1', [clientId])).rows[0].n, 0);
    assert.equal(bodyOf((await outbox(db, clientId, wa)).at(-1).payload), 'תודה רבה! נחזור אליכם בהקדם.');
    assert.ok((await outbox(db, clientId, owner)).some((r) => /דנה לוי, נעלי ריצה, כמות: 2–5, משלוח/.test(bodyOf(r.payload))));
  } finally { await close(); }
});
