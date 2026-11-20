'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { openDatabase } = require('./helpers/isolatedDatabase');

// The AI extractor/writer is replaced by a fake provider: nothing leaves the machine.
const ai = require('../aiService');
let aiReply = '{}';
ai.registerProvider('propertyfake', async () => ({ text: aiReply, actionPlans: [] }));
const withFakeAi = async (work) => {
  const before = process.env.AI_PROVIDER, fallback = process.env.AI_FALLBACK_PROVIDER;
  process.env.AI_PROVIDER = 'propertyfake'; delete process.env.AI_FALLBACK_PROVIDER;
  try { return await work(); } finally { if (before === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = before; if (fallback !== undefined) process.env.AI_FALLBACK_PROVIDER = fallback; }
};
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), crypto.randomBytes(200)]);
const newClient = async (db, phone) => (await db.query('INSERT INTO clients(phone) VALUES($1) RETURNING id', [phone])).rows[0].id;
const ready = async (props, client, extra = {}) => {
  const p = await props.create(client, { dealType: 'SALE', city: 'גבעתיים', price: 2900000, rooms: 4, licenseNumber: '314159', ...extra });
  await props.setConsent(client, p.id, true);
  return props.activate(client, p.id);
};

test('free text becomes property fields; AI numbers are used only when the text supports them', async () => {
  const props = require('../properties');
  assert.deepEqual(props.localExtract('דירה חדשה: 4 חדרים בגבעתיים 2.9 מיליון'), { rooms: 4, price: 2900000, dealType: 'SALE', city: 'גבעתיים' });
  const rent = props.localExtract('נכס חדש להשכרה ברחוב הרצל 12, רמת גן, 3.5 חד׳ 6,500 ₪ לחודש קומה 2 מעלית חניה');
  assert.equal(rent.dealType, 'RENT'); assert.equal(rent.price, 6500); assert.equal(rent.rooms, 3.5); assert.equal(rent.floor, 2);
  assert.equal(rent.city, 'רמת גן'); assert.equal(rent.address, 'הרצל 12'); assert.deepEqual(rent.features, ['מעלית', 'חניה']);
  const text = 'דירה חדשה בגבעתיים, 4 חדרים, 2.9 מיליון, שכונת בורוכוב';
  const merged = await props.extract(text, { extractor: async () => ({ price: 3500000, sizeSqm: 120, neighbourhood: 'בורוכוב', floor: 3, kind: 'PENTHOUSE' }) });
  assert.equal(merged.price, 2900000, 'the text price wins');
  assert.equal(merged.sizeSqm, undefined, 'an invented size is dropped');
  assert.equal(merged.floor, undefined, 'an invented floor is dropped');
  assert.equal(merged.neighbourhood, 'בורוכוב');
  const broken = await props.extract(text, { extractor: async () => { throw Error('AI_DOWN'); } });
  assert.equal(broken.city, 'גבעתיים');
});

test('ad rules: license always shown, no misleading claims, no discrimination, only real numbers, Housing category abroad', () => {
  const props = require('../properties');
  const p = { license_number: '314159', price: 2900000, rooms: 4, size_sqm: 100, floor: 3, address: '' };
  assert.deepEqual(props.complianceIssues('דירת 4 חדרים בגבעתיים, 2,900,000 ₪. רישיון תיווך מס\' 314159', p), []);
  assert.ok(props.complianceIssues('דירת 4 חדרים בגבעתיים', p).includes('LICENSE_MISSING'));
  assert.ok(props.complianceIssues('מציאה! הזדמנות אחרונה 314159', p).includes('MISLEADING_CLAIM'));
  assert.ok(props.complianceIssues('מתאימה לזוגות בלבד 314159', p).includes('DISCRIMINATING'));
  assert.ok(props.complianceIssues('ללא ערבים 314159', p).includes('DISCRIMINATING'));
  assert.ok(props.complianceIssues('רק 2,500,000 ₪! 314159', p).includes('UNSUPPORTED_NUMBER'));
  const brief = props.campaignBrief({ ...p, property_kind: 'APARTMENT', deal_type: 'SALE', city: 'גבעתיים', neighbourhood: '', features: ['מעלית'], description: '' });
  assert.match(brief, /רישיון תיווך מס' 314159/);
  assert.match(brief, /HOUSING/);
  assert.match(brief, /בלי פילוח או ניסוח שמפלה/);
  assert.equal(props.housingCategoryNeeded(['IL']), false);
  assert.equal(props.housingCategoryNeeded(['IL', 'US']), true);
  assert.equal(props.housingCategoryNeeded(['de']), true);
});

test('WhatsApp intake: extracts fields, asks only what is missing, requires consent, then shows the card and offers', async () => {
  const { db, close } = await openDatabase();
  try {
    const props = require('../properties'), chat = require('../propertyConversation');
    const client = await newClient(db, '972500000921');
    aiReply = JSON.stringify({ city: 'גבעתיים', features: ['מעלית'] });
    await withFakeAi(async () => {
      let r = await chat.handleClient(client, 'דירה חדשה: 4 חדרים בגבעתיים 2.9 מיליון קומה 3 מעלית');
      assert.match(r.text, /רישיון התיווך/, 'only the license is missing');
      assert.equal(r.interactivePayload, undefined);
      const [p] = await props.list(client);
      assert.equal(p.status, 'DRAFT'); assert.equal(p.price, 2900000); assert.equal(p.rooms, 4); assert.equal(p.city, 'גבעתיים'); assert.equal(p.floor, 3);
      r = await chat.handleClient(client, 'הרישיון שלי 314159');
      assert.match(r.text, /הסכים שנפרסם/);
      assert.equal(r.interactivePayload.interactive.action.buttons.length, 2);
      // Confirming before consent is not possible: the consent question comes back.
      r = await chat.handleClient(client, `/property-confirm ${p.id}`);
      assert.match(r.text, /הסכים שנפרסם/);
      assert.equal((await props.get(client, p.id)).status, 'DRAFT');
      r = await chat.handleClient(client, `/property-consent ${p.id} yes`);
      assert.match(r.text, /הנה הנכס/); assert.match(r.text, /רישיון תיווך: 314159/); assert.match(r.text, /2,900,000 ₪/);
      // A correction before confirming.
      r = await chat.handleClient(client, `/property-fix ${p.id}`);
      r = await chat.handleClient(client, 'מחיר 2.8 מיליון');
      assert.match(r.text, /2,800,000 ₪/);
      r = await chat.handleClient(client, `/property-confirm ${p.id}`);
      assert.match(r.text, /נשמר ומשווק/);
      assert.deepEqual(r.interactivePayload.interactive.action.buttons.map((b) => b.reply.title), ['קמפיין לידים', 'פוסטים לנכס', 'אחר כך']);
      const saved = await props.get(client, p.id);
      assert.equal(saved.status, 'ACTIVE'); assert.ok(saved.owner_consent_at);
      const profile = await require('../marketingStore').load(client);
      assert.equal(profile.brokerLicense, '314159', 'the license is kept for the next property');
      assert.equal(profile.propertyIntake, undefined);
      assert.ok(require('../conversationController').acceptsInteractive(profile));
      // The next property only asks the deal type: the license is remembered.
      r = await chat.handleClient(client, 'נכס חדש: 3 חדרים ברמת גן 6,500 ₪');
      assert.match(r.text, /הסכים שנפרסם/, 'rent is read from the price, license reused');
      // Missing deal and rooms are asked with buttons.
      await chat.handleClient(client, 'בטל');
      r = await chat.handleClient(client, 'נכס חדש: משהו יפה בחולון');
      assert.match(r.text, /למכירה או להשכרה/);
      const id = r.interactivePayload.interactive.action.buttons[0] && (await props.list(client, { statuses: ['DRAFT'] }))[0].id;
      r = await chat.handleClient(client, `/property-deal ${id} SALE`);
      assert.match(r.text, /המחיר המבוקש/);
      r = await chat.handleClient(client, '1,950,000');
      assert.match(r.text, /כמה חדרים/);
      assert.equal(r.interactivePayload.interactive.type, 'list');
      // The list: open properties with their status.
      r = await chat.handleClient(client, 'הנכסים שלי');
      assert.match(r.text, /משווק/); assert.match(r.text, /לידים/);
    });
  } finally { await close(); }
});

test('a property photo with a describing caption starts the intake and is stored', async () => {
  const { db, close } = await openDatabase();
  try {
    const props = require('../properties'), chat = require('../propertyConversation');
    const client = await newClient(db, '972500000922');
    await withFakeAi(async () => {
      aiReply = '{}';
      assert.equal(await chat.handlePhoto(client, { type: 'image', caption: 'שקיעה יפה', buffer: PNG, mimeType: 'image/png', mediaId: '1' }), null, 'an unrelated photo is left to the existing flow');
      let r = await chat.handlePhoto(client, { type: 'image', caption: 'דירה חדשה 4 חדרים בגבעתיים 2.9 מיליון', buffer: PNG, mimeType: 'image/png', mediaId: '11' });
      assert.match(r.text, /התמונה נשמרה/);
      const [p] = await props.list(client);
      assert.equal(p.photos, 1);
      r = await chat.handlePhoto(client, { type: 'image', caption: '', buffer: PNG, mimeType: 'image/png', mediaId: '12' });
      assert.match(r.text, /תמונה 2/);
      const ids = await props.photoIds(client, p.id);
      assert.equal(ids.length, 2);
      assert.ok(Buffer.isBuffer((await props.photo(client, p.id, ids[0])).buffer));
      assert.deepEqual((await props.get(client, p.id)).photo_media_ids, ['11', '12']);
    });
  } finally { await close(); }
});

test('consent is required: no market status, no posts and no campaign without it', async () => {
  const { db, close } = await openDatabase();
  try {
    const props = require('../properties');
    const client = await newClient(db, '972500000923');
    const p = await props.create(client, { dealType: 'SALE', city: 'חולון', price: 1500000, rooms: 3, licenseNumber: '314159' });
    await assert.rejects(props.activate(client, p.id), /PROPERTY_CONSENT_REQUIRED/);
    await assert.rejects(db.query("UPDATE properties SET status='ACTIVE' WHERE id=$1", [p.id]), /properties_active_needs_consent|check constraint/);
    let sent = 0;
    const campaign = await props.prepareCampaign(client, p.id, { send: async () => { sent++; return {}; } });
    assert.equal(campaign.blocked, 'PROPERTY_CONSENT_REQUIRED'); assert.equal(sent, 0);
    assert.equal((await props.preparePosts(client, p.id)).blocked, 'PROPERTY_CONSENT_REQUIRED');
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM organic_posts WHERE client_id=$1', [client])).rows[0].n, 0);
    // Without a license the property cannot go on the market either.
    const fresh = await newClient(db, '972500000928');
    const noLicense = await props.create(fresh, { dealType: 'RENT', city: 'חולון', price: 5000, rooms: 3 });
    await props.setConsent(fresh, noLicense.id, true);
    await assert.rejects(props.activate(fresh, noLicense.id), /PROPERTY_INCOMPLETE/);
    // Withdrawing consent takes an active property off the market and stops its posts.
    const active = await ready(props, client);
    await db.query("INSERT INTO organic_posts(id,client_id,publish_on,format,media,topic,caption,property_id,status) VALUES($1,$2,'2030-01-01','POST','PHOTO','t','caption long enough here',$3,'APPROVED')", [crypto.randomUUID(), client, active.id]);
    const withdrawn = await props.setConsent(client, active.id, false);
    assert.equal(withdrawn.status, 'PAUSED');
    assert.equal((await db.query("SELECT status FROM organic_posts WHERE client_id=$1 AND property_id=$2", [client, active.id])).rows[0].status, 'SKIPPED');
  } finally { await close(); }
});

test('campaign and posts for a property: brief through the task flow, license in every post, no misleading text', async () => {
  const { db, close } = await openDatabase();
  try {
    const props = require('../properties');
    const client = await newClient(db, '972500000924');
    const p = await ready(props, client, { features: ['מעלית', 'חניה'] });
    const taskId = crypto.randomUUID();
    let brief;
    const r = await require('../metaConnection').context.run(String(client), () => props.prepareCampaign(client, p.id, { send: async (message) => { brief = message; return { reply: 'הנה טיוטת הקמפיין', task: { id: taskId } }; }, connection: async () => ({ ok: false, reason: 'CONNECTION' }) }));
    assert.match(brief, /^קמפיין לידים ב־Meta לנכס: דירת 4 חדרים בגבעתיים/);
    assert.match(brief, /רישיון תיווך מס' 314159/);
    assert.match(r.reply, /אין חיבור פעיל ל־Meta/, 'the owner is told plainly what is missing');
    assert.equal(r.metaConnected, false);
    assert.equal((await props.get(client, p.id)).campaign_task_id, taskId);
    // Posts: the writer returns a misleading caption for one angle; it is replaced.
    let i = 0;
    const writer = async () => ({ posts: [{ topic: 'x', caption: i++ === 0 ? 'מציאה של פעם בחיים! הזדמנות אחרונה לקנות דירה מדהימה בגבעתיים עכשיו' : 'דירה מקסימה ומוארת בגבעתיים עם מעלית וחניה, מוזמנים לתאם ביקור ולשמוע עוד פרטים' }] });
    const posts = await props.preparePosts(client, p.id, { writer, now: new Date('2026-11-22T08:00:00Z') });
    assert.equal(posts.count, 3);
    const rows = (await db.query('SELECT caption,media,status,purpose FROM organic_posts WHERE client_id=$1 AND property_id=$2 ORDER BY publish_on', [client, p.id])).rows;
    assert.equal(rows.length, 3);
    for (const row of rows) {
      assert.match(row.caption, /314159/);
      assert.deepEqual(props.complianceIssues(row.caption, p), []);
      assert.equal(row.media, 'PHOTO', 'real photos only, never an AI image of a property');
      assert.equal(row.status, 'DRAFT', 'the owner approves posts');
    }
    assert.ok((await db.query('SELECT 1 FROM organic_plans WHERE client_id=$1', [client])).rows.length, 'the content plan delivers them');
    // With the AI writer down, the posts are the plain property posts, never the request text.
    await props.preparePosts(client, p.id, { writer: async () => { throw Error('AI_DOWN'); }, now: new Date('2026-11-22T08:00:00Z') });
    const plainPosts = (await db.query("SELECT caption FROM organic_posts WHERE client_id=$1 AND property_id=$2 AND status='DRAFT'", [client, p.id])).rows;
    assert.equal(plainPosts.length, 3);
    for (const row of plainPosts) { assert.doesNotMatch(row.caption, /נכס של המשרד|לכתוב רק עובדות/); assert.match(row.caption, /314159/); }
  } finally { await close(); }
});

test('sold/rented: posts stop, the linked campaign gets a protective pause for approval, the owner is told', async () => {
  const { db, close } = await openDatabase();
  try {
    const props = require('../properties');
    const client = await newClient(db, '972500000925');
    // Campaign created by the task flow: found through the task's verified approval.
    const p = await ready(props, client);
    const taskId = crypto.randomUUID(), actionId = 'act-' + crypto.randomUUID();
    await db.query("INSERT INTO agent_tasks(id,client_id,request,status,state) VALUES($1,$2,'קמפיין לנכס','COMPLETE',$3)", [taskId, client, JSON.stringify({ steps: [{ status: 'DONE', result: { actionId } }] })]);
    await db.query("INSERT INTO action_plans(id,client_id,intent,payload,status,execution_result) VALUES($1,$2,'CREATE_BUNDLE','{}','VERIFIED',$3)", [actionId, client, JSON.stringify({ id: '120000111', objects: { campaignId: '120000111' } })]);
    await db.query('UPDATE properties SET campaign_task_id=$2 WHERE id=$1', [p.id, taskId]);
    for (const status of ['APPROVED', 'DRAFT', 'SENT']) await db.query("INSERT INTO organic_posts(id,client_id,publish_on,format,media,topic,caption,property_id,status) VALUES($1,$2,'2030-01-01','POST','PHOTO','t','caption long enough here',$3,$4)", [crypto.randomUUID(), client, p.id, status]);
    let plan;
    const r = await props.close(client, p.id, 'SOLD', { connection: async () => ({ ok: true, accountId: 'act_1' }), createApproval: async (x) => { plan = x; return { actionId: 'pause-1', actionPlan: x }; } });
    assert.equal(plan.intent, 'PAUSE_CAMPAIGN');
    assert.equal(plan.target.campaignId, '120000111');
    assert.equal(r.campaignId, '120000111');
    assert.equal(r.stoppedPosts, 2);
    assert.match(r.reply, /נמכר/); assert.match(r.reply, /עצרתי 2 פוסטים/); assert.match(r.reply, /מחכה לאישור שלך/);
    const closed = await props.get(client, p.id);
    assert.equal(closed.status, 'SOLD'); assert.equal(closed.meta_campaign_id, '120000111'); assert.ok(closed.closed_at);
    assert.equal(await props.ownsApproval(client, 'pause-1'), true);
    assert.equal(await props.ownsApproval(client, 'other'), false);
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM organic_posts WHERE client_id=$1 AND property_id=$2 AND status='SENT'", [client, p.id])).rows[0].n, 1, 'history stays');
    assert.equal((await props.preparePosts(client, p.id)).blocked, 'PROPERTY_CLOSED', 'no ads for a property that is not offered');
    assert.equal((await props.close(client, p.id, 'SOLD')).already, true);
    // No Meta connection: nothing is pretended, the owner gets the next step.
    const rented = await ready(props, client, { dealType: 'RENT', price: 7000 });
    await props.linkCampaign(client, rented.id, '120000222');
    let called = false;
    const r2 = await props.close(client, rented.id, 'RENTED', { connection: async () => ({ ok: false, reason: 'CONNECTION' }), createApproval: async () => { called = true; } });
    assert.equal(called, false);
    assert.match(r2.reply, /אין חיבור פעיל ל־Meta/); assert.match(r2.reply, /חבר את Meta/);
    // No campaign at all: said plainly.
    const third = await ready(props, client);
    assert.match((await props.close(client, third.id, 'SOLD')).reply, /לא היה קמפיין מקושר/);
    // By WhatsApp: "נכס נמכר" with a name that matches one property closes it.
    const chat = require('../propertyConversation');
    const fourth = await ready(props, client, { city: 'חולון' });
    const reply = await chat.handleClient(client, 'נכס נמכר חולון');
    assert.match(reply.text, /סימנתי את דירת 4 חדרים בחולון כנמכר/);
    assert.equal((await props.get(client, fourth.id)).status, 'SOLD');
  } finally { await close(); }
});

test('dashboard API: properties are scoped to the session client', async () => {
  const { db, close } = await openDatabase();
  const env = { ...process.env };
  Object.assign(process.env, { APP_PUBLIC_URL: 'https://campaign.example' });
  const app = require('../index');
  const server = await new Promise((resolve, reject) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); s.once('error', reject); });
  const root = 'http://127.0.0.1:' + server.address().port;
  const login = async (clientId) => {
    const token = (await require('../portalStore').createTicket(clientId)).split('#login=')[1];
    const r = await fetch(root + '/app/api/login', { method: 'POST', headers: { Origin: 'https://campaign.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    const cookies = r.headers.getSetCookie();
    return { cookie: cookies.map((s) => s.split(';')[0]).join('; '), csrf: cookies.find((s) => s.startsWith('cb_csrf=')).split(';')[0].split('=')[1] };
  };
  const call = (s, path, body, method = body ? 'POST' : 'GET') => fetch(root + '/app/api/properties' + path, { method, headers: { Cookie: s.cookie, ...(body ? { Origin: 'https://campaign.example', 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
  try {
    const a = await newClient(db, '972500000926'), b = await newClient(db, '972500000927');
    const sa = await login(a), sb = await login(b);
    assert.equal((await fetch(root + '/app/api/properties')).status, 401);
    let r = await call(sa, '', { dealType: 'SALE', city: 'גבעתיים', price: 2900000, rooms: 4, licenseNumber: '314159', features: 'מעלית, חניה', activate: true });
    assert.equal(r.status, 409, 'cannot go on the market without consent');
    const created = await (await call(sa, '', { dealType: 'SALE', city: 'גבעתיים', price: 2900000, rooms: 4, licenseNumber: '314159', features: 'מעלית, חניה', consent: true, activate: true })).json();
    assert.equal(created.status, 'ACTIVE'); assert.equal(created.consent, true); assert.deepEqual(created.features, ['מעלית', 'חניה']);
    assert.equal((await (await call(sa, '')).json()).properties.length, 2);
    assert.equal((await (await call(sb, '')).json()).properties.length, 0, 'the other client sees nothing');
    { const x = await call(sb, '/' + created.id, { price: 1 }, 'PATCH'); assert.equal(x.status, 404, await x.text()); }
    assert.equal((await call(sb, '/' + created.id + '/close', { outcome: 'SOLD' })).status, 404);
    assert.equal((await call(sb, '/' + created.id + '/photos', { imageBase64: PNG.toString('base64'), mimeType: 'image/png' })).status, 404);
    r = await call(sa, '/' + created.id + '/photos', { imageBase64: PNG.toString('base64'), mimeType: 'image/png' });
    assert.equal(r.status, 200);
    const photoId = (await r.json()).id;
    const image = await fetch(root + '/app/api/properties/' + created.id + '/photos/' + photoId, { headers: { Cookie: sa.cookie } });
    assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal((await fetch(root + '/app/api/properties/' + created.id + '/photos/' + photoId, { headers: { Cookie: sb.cookie } })).status, 404);
    // A lead of another client cannot be linked.
    const otherLead = (await require('../crmService').create(b, { name: 'ליד', phone: '0501234567' })).id;
    assert.equal((await call(sa, '/' + created.id + '/leads', { leadId: otherLead })).status, 409);
    const ownLead = (await require('../crmService').create(a, { name: 'ליד', phone: '0501234568' })).id;
    assert.equal((await call(sa, '/' + created.id + '/leads', { leadId: ownLead })).status, 200);
    const listed = (await (await call(sa, '')).json()).properties.find((x) => x.id === created.id);
    assert.equal(listed.leads, 1); assert.equal(listed.photos, 1); assert.equal(listed.coverPhotoId, photoId);
    r = await call(sa, '/' + created.id + '/close', { outcome: 'SOLD' });
    assert.equal(r.status, 200); assert.match((await r.json()).reply, /לא היה קמפיין מקושר/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await close();
    for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
    Object.assign(process.env, env);
  }
});
