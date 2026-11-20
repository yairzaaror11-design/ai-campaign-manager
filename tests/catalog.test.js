'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { openDatabase } = require('./helpers/isolatedDatabase');

// The AI extractor/writer is replaced by a fake provider: nothing leaves the machine.
const ai = require('../aiService');
let aiReply = '{}';
ai.registerProvider('catalogfake', async () => ({ text: aiReply, actionPlans: [] }));
const withFakeAi = async (work) => {
  const before = process.env.AI_PROVIDER, fallback = process.env.AI_FALLBACK_PROVIDER;
  process.env.AI_PROVIDER = 'catalogfake'; delete process.env.AI_FALLBACK_PROVIDER;
  try { return await work(); } finally { if (before === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = before; if (fallback !== undefined) process.env.AI_FALLBACK_PROVIDER = fallback; }
};
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), crypto.randomBytes(200)]);
const V = require('../verticalProfiles');
const newClient = async (db, phone, vertical) => {
  const id = (await db.query('INSERT INTO clients(phone) VALUES($1) RETURNING id', [phone])).rows[0].id;
  if (vertical) await V.choose(id, vertical);
  return id;
};
const property = async (catalog, client, extra = {}) => {
  const i = await catalog.create(client, { price: 2900000, licenseNumber: '314159', ...extra, attributes: { dealType: 'SALE', city: 'גבעתיים', rooms: 4, ...(extra.attributes || {}) } }, { vertical: 'real_estate' });
  await catalog.setConsent(client, i.id, true);
  return catalog.activate(client, i.id);
};

test('vertical profiles: inference from the business card and per-vertical reading of free text', () => {
  assert.equal(V.infer('משרד תיווך נדל"ן'), 'real_estate');
  assert.equal(V.infer('קוסמטיקאית בחולון'), 'services');
  assert.equal(V.infer('סטודיו לפילאטיס'), 'fitness');
  assert.equal(V.infer('חנות בגדים אונליין'), 'retail');
  assert.equal(V.infer('משהו אחר'), null);
  const catalog = require('../catalog');
  assert.deepEqual(catalog.localExtract(V.get('real_estate'), 'דירה חדשה: 4 חדרים בגבעתיים 2.9 מיליון'), { attributes: { rooms: 4, dealType: 'SALE', city: 'גבעתיים' }, price: 2900000 });
  assert.deepEqual(catalog.localExtract(V.get('services'), 'שירות חדש: טיפול פנים 60 דקות 350 ש"ח'), { attributes: { durationMinutes: 60 }, price: 350, title: 'טיפול פנים' });
  assert.deepEqual(catalog.localExtract(V.get('retail'), 'מוצר חדש: שמלת קיץ 249 ש"ח במלאי 12'), { attributes: { stock: 12 }, price: 249, title: 'שמלת קיץ' });
  // Only the real-estate profile carries the license, owner consent and Housing rules.
  assert.equal(V.get('real_estate').consentRequired, true); assert.ok(V.get('real_estate').license); assert.equal(V.get('real_estate').housingCategory, true);
  for (const k of ['services', 'retail', 'fitness', 'generic']) { assert.equal(V.get(k).consentRequired, false); assert.equal(V.get(k).license, undefined); assert.equal(V.get(k).housingCategory, false); }
});

test('AI numbers are used only when the text supports them; invalid values are dropped', async () => {
  const catalog = require('../catalog');
  const text = 'דירה חדשה בגבעתיים, 4 חדרים, 2.9 מיליון, שכונת בורוכוב';
  const merged = await catalog.extract(V.get('real_estate'), text, { extractor: async () => ({ price: 3500000, attributes: { sizeSqm: 120, neighbourhood: 'בורוכוב', floor: 3 }, kind: 'PENTHOUSE' }) });
  assert.equal(merged.price, 2900000, 'the text price wins');
  assert.equal(merged.attributes.sizeSqm, undefined); assert.equal(merged.attributes.floor, undefined);
  assert.equal(merged.attributes.neighbourhood, 'בורוכוב');
  const svc = await catalog.extract(V.get('services'), 'שירות חדש: עיסוי שוודי 250', { extractor: async () => ({ attributes: { durationMinutes: 90 } }) });
  assert.equal(svc.attributes.durationMinutes, undefined, 'an invented duration is dropped');
  assert.equal(svc.price, 250);
});

test('ad rules: license only for real estate, no misleading or discriminating text, only real numbers, Housing abroad', () => {
  const catalog = require('../catalog');
  const re = { vertical: 'real_estate', kind: 'APARTMENT', title: 'דירת 4 חדרים בגבעתיים', price: 2900000, description: '', attributes: { licenseNumber: '314159', rooms: 4, dealType: 'SALE', city: 'גבעתיים' } };
  assert.deepEqual(catalog.complianceIssues('דירת 4 חדרים בגבעתיים, 2,900,000 ₪. רישיון תיווך מס\' 314159', re), []);
  assert.ok(catalog.complianceIssues('דירת 4 חדרים בגבעתיים', re).includes('LICENSE_MISSING'));
  assert.ok(catalog.complianceIssues('מציאה! הזדמנות אחרונה 314159', re).includes('MISLEADING_CLAIM'));
  assert.ok(catalog.complianceIssues('מתאימה לזוגות בלבד 314159', re).includes('DISCRIMINATING'));
  assert.ok(catalog.complianceIssues('רק 2,500,000 ₪! 314159', re).includes('UNSUPPORTED_NUMBER'));
  const brief = catalog.campaignBrief(re);
  assert.match(brief, /רישיון תיווך מס' 314159/); assert.match(brief, /HOUSING/);
  assert.equal(catalog.housingCategoryNeeded(re, ['IL', 'US']), true);
  const svc = { vertical: 'services', kind: 'SERVICE', title: 'טיפול פנים', price: 350, description: '', attributes: { durationMinutes: 60 } };
  assert.deepEqual(catalog.complianceIssues('טיפול פנים של 60 דקות ב־350 ₪', svc), [], 'no license needed outside real estate');
  assert.ok(catalog.complianceIssues('תוצאות מובטחות! טיפול פנים', svc).includes('MISLEADING_CLAIM'));
  const svcBrief = catalog.campaignBrief(svc);
  assert.doesNotMatch(svcBrief, /HOUSING|רישיון/);
  assert.match(svcBrief, /בלי פילוח או ניסוח שמפלה/);
  assert.equal(catalog.housingCategoryNeeded(svc, ['US']), false);
});

test('real estate WhatsApp intake: asks only what is missing, requires consent, shows the card and offers', async () => {
  const { db, close } = await openDatabase();
  try {
    const catalog = require('../catalog'), chat = require('../catalogConversation');
    const client = await newClient(db, '972500000931', 'real_estate');
    await withFakeAi(async () => {
      aiReply = JSON.stringify({ attributes: { city: 'גבעתיים', features: ['מעלית'] } });
      let r = await chat.handleClient(client, 'דירה חדשה: 4 חדרים בגבעתיים 2.9 מיליון קומה 3 מעלית');
      assert.match(r.text, /רישיון התיווך/, 'only the license is missing');
      const [p] = await catalog.list(client);
      assert.equal(p.vertical, 'real_estate'); assert.equal(p.status, 'DRAFT'); assert.equal(p.price, 2900000);
      assert.equal(p.attributes.rooms, 4); assert.equal(p.attributes.floor, 3); assert.equal(p.title, 'דירת 4 חדרים בגבעתיים');
      r = await chat.handleClient(client, 'הרישיון שלי 314159');
      assert.match(r.text, /הסכים שנפרסם/);
      r = await chat.handleClient(client, `/catalog-confirm ${p.id}`);
      assert.match(r.text, /הסכים שנפרסם/, 'confirming before consent brings the consent question back');
      r = await chat.handleClient(client, `/catalog-consent ${p.id} yes`);
      assert.match(r.text, /הנה הנכס/); assert.match(r.text, /רישיון תיווך: 314159/); assert.match(r.text, /2,900,000 ₪/);
      await chat.handleClient(client, `/catalog-fix ${p.id}`);
      r = await chat.handleClient(client, 'מחיר 2.8 מיליון');
      assert.match(r.text, /2,800,000 ₪/);
      r = await chat.handleClient(client, `/catalog-confirm ${p.id}`);
      assert.match(r.text, /נשמר ומשווק/);
      assert.deepEqual(r.interactivePayload.interactive.action.buttons.map((b) => b.reply.title), ['קמפיין לידים', 'פוסטים', 'אחר כך']);
      assert.equal((await catalog.get(client, p.id)).status, 'ACTIVE');
      const profile = await require('../marketingStore').load(client);
      assert.equal(profile.brokerLicense, '314159');
      assert.ok(require('../conversationController').acceptsInteractive(profile));
      // Missing deal type and rooms are asked with buttons.
      r = await chat.handleClient(client, 'נכס חדש: משהו יפה בחולון');
      assert.match(r.text, /למכירה או להשכרה/);
      const id = (await catalog.list(client, { statuses: ['DRAFT'] }))[0].id;
      r = await chat.handleClient(client, `/catalog-set ${id} dealType SALE`);
      assert.match(r.text, /כמה חדרים/); assert.equal(r.interactivePayload.interactive.type, 'list');
      r = await chat.handleClient(client, `/catalog-set ${id} rooms 3.5`);
      assert.match(r.text, /המחיר המבוקש/);
      r = await chat.handleClient(client, '1,950,000');
      assert.match(r.text, /הסכים שנפרסם/, 'the license is reused');
      r = await chat.handleClient(client, 'הנכסים שלי');
      assert.match(r.text, /^🏷️ נכסים שלך/); assert.match(r.text, /משווק/);
    });
  } finally { await close(); }
});

test('services WhatsApp intake: no consent or license, asks the name and price only', async () => {
  const { db, close } = await openDatabase();
  try {
    const catalog = require('../catalog'), chat = require('../catalogConversation');
    const client = await newClient(db, '972500000932', 'services');
    await withFakeAi(async () => {
      aiReply = '{}';
      let r = await chat.handleClient(client, 'שירות חדש: טיפול פנים 60 דקות');
      assert.match(r.text, /כמה עולה השירות/);
      r = await chat.handleClient(client, '350');
      assert.match(r.text, /הנה השירות/); assert.doesNotMatch(r.text, /הסכמה|רישיון/);
      assert.match(r.text, /טיפול פנים/); assert.match(r.text, /60 דקות/);
      const [s] = await catalog.list(client);
      assert.equal(s.vertical, 'services'); assert.equal(s.consent_required, false);
      r = await chat.handleClient(client, `/catalog-confirm ${s.id}`);
      assert.match(r.text, /טיפול פנים נשמר ומשווק/);
      assert.equal((await catalog.get(client, s.id)).status, 'ACTIVE');
      r = await chat.handleClient(client, 'השירותים שלי');
      assert.match(r.text, /שירותים שלך/);
      // Ending a service: posts stop, the owner is told.
      await db.query("INSERT INTO organic_posts(id,client_id,publish_on,format,media,topic,caption,catalog_item_id,status) VALUES($1,$2,'2030-01-01','POST','AI_GRAPHIC','t','caption long enough here',$3,'APPROVED')", [crypto.randomUUID(), client, s.id]);
      r = await chat.handleClient(client, 'שירות הופסק טיפול פנים');
      assert.match(r.text, /סימנתי את טיפול פנים כהופסק/); assert.match(r.text, /עצרתי 1 פוסטים/);
      assert.equal((await catalog.get(client, s.id)).status, 'ENDED');
    });
  } finally { await close(); }
});

test('unknown business type: asked once with buttons, then the item continues from the same text', async () => {
  const { db, close } = await openDatabase();
  try {
    const catalog = require('../catalog'), chat = require('../catalogConversation');
    const client = await newClient(db, '972500000933');
    await withFakeAi(async () => {
      aiReply = '{}';
      let r = await chat.handleClient(client, 'פריט חדש: סדנת קרמיקה 180 ש"ח');
      assert.match(r.text, /מה העסק מוכר/);
      assert.equal(r.interactivePayload.interactive.type, 'list');
      r = await chat.handleClient(client, '/catalog-vertical services');
      assert.match(r.text, /הנה השירות/); assert.match(r.text, /סדנת קרמיקה/); assert.match(r.text, /180 ₪/);
      assert.equal((await require('../marketingStore').load(client)).businessVertical, 'services');
      assert.equal((await catalog.list(client))[0].vertical, 'services');
      // A word that names a vertical decides it without asking.
      const other = await newClient(db, '972500000934');
      r = await chat.handleClient(other, 'מוצר חדש: כוס קרמיקה 60 ש"ח');
      assert.match(r.text, /הנה המוצר/);
      assert.equal((await require('../marketingStore').load(other)).businessVertical, 'retail');
    });
  } finally { await close(); }
});

test('a photo with a describing caption starts the intake and is stored', async () => {
  const { db, close } = await openDatabase();
  try {
    const catalog = require('../catalog'), chat = require('../catalogConversation');
    const client = await newClient(db, '972500000935', 'real_estate');
    await withFakeAi(async () => {
      aiReply = '{}';
      assert.equal(await chat.handlePhoto(client, { type: 'image', caption: 'שקיעה יפה', buffer: PNG, mimeType: 'image/png', mediaId: '1' }), null, 'an unrelated photo is left to the existing flow');
      let r = await chat.handlePhoto(client, { type: 'image', caption: 'דירה חדשה 4 חדרים בגבעתיים 2.9 מיליון', buffer: PNG, mimeType: 'image/png', mediaId: '11' });
      assert.match(r.text, /התמונה נשמרה/);
      r = await chat.handlePhoto(client, { type: 'image', caption: '', buffer: PNG, mimeType: 'image/png', mediaId: '12' });
      assert.match(r.text, /תמונה 2/);
      const [p] = await catalog.list(client);
      assert.equal(p.photos, 2);
      assert.deepEqual(p.photo_media_ids, ['11', '12']);
      assert.ok(Buffer.isBuffer((await catalog.photo(client, p.id, p.cover_photo_id)).buffer));
    });
  } finally { await close(); }
});

test('consent is required for real estate only: no market status, posts or campaign without it', async () => {
  const { db, close } = await openDatabase();
  try {
    const catalog = require('../catalog');
    const client = await newClient(db, '972500000936', 'real_estate');
    const p = await catalog.create(client, { price: 1500000, licenseNumber: '314159', attributes: { dealType: 'SALE', city: 'חולון', rooms: 3 } });
    await assert.rejects(catalog.activate(client, p.id), /ITEM_CONSENT_REQUIRED/);
    await assert.rejects(db.query("UPDATE catalog_items SET status='ACTIVE' WHERE id=$1", [p.id]), /catalog_items_active_needs_consent|check constraint/);
    let sent = 0;
    assert.equal((await catalog.prepareCampaign(client, p.id, { send: async () => { sent++; return {}; } })).blocked, 'ITEM_CONSENT_REQUIRED');
    assert.equal(sent, 0);
    assert.equal((await catalog.preparePosts(client, p.id)).blocked, 'ITEM_CONSENT_REQUIRED');
    const active = await property(catalog, client);
    await db.query("INSERT INTO organic_posts(id,client_id,publish_on,format,media,topic,caption,catalog_item_id,status) VALUES($1,$2,'2030-01-01','POST','PHOTO','t','caption long enough here',$3,'APPROVED')", [crypto.randomUUID(), client, active.id]);
    assert.equal((await catalog.setConsent(client, active.id, false)).status, 'PAUSED', 'withdrawn consent takes it off the market');
    assert.equal((await db.query('SELECT status FROM organic_posts WHERE client_id=$1 AND catalog_item_id=$2', [client, active.id])).rows[0].status, 'SKIPPED');
    // A service needs no consent at all.
    const svcClient = await newClient(db, '972500000937', 'services');
    const s = await catalog.create(svcClient, { title: 'ייעוץ', price: 400 });
    assert.equal((await catalog.activate(svcClient, s.id)).status, 'ACTIVE');
  } finally { await close(); }
});

test('campaign and posts per item: brief through the task flow, license in real-estate posts, no misleading text', async () => {
  const { db, close } = await openDatabase();
  try {
    const catalog = require('../catalog');
    const client = await newClient(db, '972500000938', 'real_estate');
    const p = await property(catalog, client, { attributes: { features: ['מעלית', 'חניה'] } });
    const taskId = crypto.randomUUID();
    let brief;
    const r = await require('../metaConnection').context.run(String(client), () => catalog.prepareCampaign(client, p.id, { send: async (m) => { brief = m; return { reply: 'הנה טיוטת הקמפיין', task: { id: taskId } }; }, connection: async () => ({ ok: false, reason: 'CONNECTION' }) }));
    assert.match(brief, /^קמפיין לידים ב־Meta לנכס: דירת 4 חדרים בגבעתיים/); assert.match(brief, /רישיון תיווך מס' 314159/);
    assert.match(r.reply, /אין חיבור פעיל ל־Meta/);
    assert.equal((await catalog.get(client, p.id)).campaign_task_id, taskId);
    let n = 0;
    const writer = async () => ({ posts: [{ topic: 'x', caption: n++ === 0 ? 'מציאה של פעם בחיים! הזדמנות אחרונה לקנות דירה מדהימה בגבעתיים עכשיו' : 'דירה מקסימה ומוארת בגבעתיים עם מעלית וחניה, מוזמנים לתאם ביקור ולשמוע עוד פרטים' }] });
    assert.equal((await catalog.preparePosts(client, p.id, { writer, now: new Date('2026-11-22T08:00:00Z') })).count, 3);
    const rows = (await db.query("SELECT caption,media,status FROM organic_posts WHERE client_id=$1 AND catalog_item_id=$2 AND status='DRAFT'", [client, p.id])).rows;
    assert.equal(rows.length, 3);
    for (const row of rows) { assert.match(row.caption, /314159/); assert.deepEqual(catalog.complianceIssues(row.caption, p), []); assert.equal(row.media, 'PHOTO'); }
    // With the writer down, posts are plain item posts, never the request text.
    await catalog.preparePosts(client, p.id, { writer: async () => { throw Error('AI_DOWN'); }, now: new Date('2026-11-22T08:00:00Z') });
    for (const row of (await db.query("SELECT caption FROM organic_posts WHERE client_id=$1 AND catalog_item_id=$2 AND status='DRAFT'", [client, p.id])).rows) assert.doesNotMatch(row.caption, /מהעסק:|לכתוב רק עובדות/);
    // A service: no license line, AI graphics allowed when there are no photos.
    const sc = await newClient(db, '972500000939', 'services');
    const s = await catalog.activate(sc, (await catalog.create(sc, { title: 'טיפול פנים', price: 350, attributes: { durationMinutes: 60 } })).id);
    let svcBrief;
    await require('../metaConnection').context.run(String(sc), () => catalog.prepareCampaign(sc, s.id, { send: async (m) => { svcBrief = m; return { reply: 'ok' }; }, connection: async () => ({ ok: true }) }));
    assert.match(svcBrief, /^קמפיין לידים ב־Meta לשירות: טיפול פנים/); assert.doesNotMatch(svcBrief, /HOUSING|רישיון/);
    await catalog.preparePosts(sc, s.id, { writer: async () => { throw Error('AI_DOWN'); } });
    const svcPosts = (await db.query('SELECT caption,media FROM organic_posts WHERE client_id=$1 AND catalog_item_id=$2', [sc, s.id])).rows;
    assert.equal(svcPosts.length, 3);
    assert.ok(svcPosts.every((x) => x.media === 'AI_GRAPHIC' && !/רישיון/.test(x.caption)));
  } finally { await close(); }
});

test('sold/rented: posts stop, the linked campaign gets a protective pause for approval, the owner is told', async () => {
  const { db, close } = await openDatabase();
  try {
    const catalog = require('../catalog');
    const client = await newClient(db, '972500000940', 'real_estate');
    const p = await property(catalog, client);
    const taskId = crypto.randomUUID(), actionId = 'act-' + crypto.randomUUID();
    await db.query("INSERT INTO agent_tasks(id,client_id,request,status,state) VALUES($1,$2,'קמפיין','COMPLETE',$3)", [taskId, client, JSON.stringify({ steps: [{ status: 'DONE', result: { actionId } }] })]);
    await db.query("INSERT INTO action_plans(id,client_id,intent,payload,status,execution_result) VALUES($1,$2,'CREATE_BUNDLE','{}','VERIFIED',$3)", [actionId, client, JSON.stringify({ id: '120000111', objects: { campaignId: '120000111' } })]);
    await db.query('UPDATE catalog_items SET campaign_task_id=$2 WHERE id=$1', [p.id, taskId]);
    for (const status of ['APPROVED', 'DRAFT', 'SENT']) await db.query("INSERT INTO organic_posts(id,client_id,publish_on,format,media,topic,caption,catalog_item_id,status) VALUES($1,$2,'2030-01-01','POST','PHOTO','t','caption long enough here',$3,$4)", [crypto.randomUUID(), client, p.id, status]);
    let plan;
    const r = await catalog.close(client, p.id, 'SOLD', { connection: async () => ({ ok: true, accountId: 'act_1' }), createApproval: async (x) => { plan = x; return { actionId: 'pause-1', actionPlan: x }; } });
    assert.equal(plan.intent, 'PAUSE_CAMPAIGN'); assert.equal(plan.target.campaignId, '120000111');
    assert.equal(r.stoppedPosts, 2);
    assert.match(r.reply, /נמכר/); assert.match(r.reply, /מחכה לאישור שלך/);
    const closed = await catalog.get(client, p.id);
    assert.equal(closed.status, 'SOLD_OUT'); assert.equal(closed.closed_reason, 'SOLD'); assert.equal(catalog.statusLabel(closed), 'נמכר');
    assert.equal(await catalog.ownsApproval(client, 'pause-1'), true);
    assert.equal(await catalog.ownsApproval(client, 'other'), false);
    assert.equal((await catalog.preparePosts(client, p.id)).blocked, 'ITEM_CLOSED');
    // No Meta connection: nothing is pretended.
    const rented = await property(catalog, client, { price: 7000, attributes: { dealType: 'RENT' } });
    await catalog.linkCampaign(client, rented.id, '120000222');
    let called = false;
    const r2 = await catalog.close(client, rented.id, 'RENTED', { connection: async () => ({ ok: false }), createApproval: async () => { called = true; } });
    assert.equal(called, false); assert.match(r2.reply, /אין חיבור פעיל ל־Meta/);
    assert.equal(catalog.statusLabel(await catalog.get(client, rented.id)), 'הושכר');
    // By WhatsApp, by name.
    const fourth = await property(catalog, client, { attributes: { city: 'חולון' } });
    const reply = await require('../catalogConversation').handleClient(client, 'נכס נמכר חולון');
    assert.match(reply.text, /סימנתי את דירת 4 חדרים בחולון כנמכר/);
    assert.equal((await catalog.get(client, fourth.id)).status, 'SOLD_OUT');
  } finally { await close(); }
});

test('dashboard API: catalog is scoped to the session client and shaped by its vertical', async () => {
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
  const call = (s, path, body, method = body ? 'POST' : 'GET') => fetch(root + '/app/api/catalog' + path, { method, headers: { Cookie: s.cookie, ...(body ? { Origin: 'https://campaign.example', 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
  try {
    const a = await newClient(db, '972500000941', 'real_estate'), b = await newClient(db, '972500000942');
    const sa = await login(a), sb = await login(b);
    assert.equal((await fetch(root + '/app/api/catalog')).status, 401);
    const va = await (await call(sa, '')).json();
    assert.equal(va.vertical.label, 'נכסים'); assert.equal(va.vertical.consentRequired, true); assert.ok(va.vertical.fields.some((f) => f.key === 'rooms'));
    const vb = await (await call(sb, '')).json();
    assert.equal(vb.vertical.known, false); assert.equal(vb.vertical.label, 'מה אני מוכר');
    const chosen = await (await call(sb, '/vertical', { vertical: 'services' })).json();
    assert.equal(chosen.label, 'שירותים');
    assert.equal((await (await fetch(root + '/app/api/dashboard', { headers: { Cookie: sb.cookie } })).json()).catalog.label, 'שירותים');
    const body = { price: 2900000, licenseNumber: '314159', attributes: { dealType: 'SALE', city: 'גבעתיים', rooms: 4, features: ['מעלית'] } };
    assert.equal((await call(sa, '', { ...body, activate: true })).status, 409, 'cannot go on the market without consent');
    const created = await (await call(sa, '', { ...body, consent: true, activate: true })).json();
    assert.equal(created.status, 'ACTIVE'); assert.equal(created.title, 'דירת 4 חדרים בגבעתיים');
    const svc = await (await call(sb, '', { title: 'טיפול פנים', price: 350, attributes: { durationMinutes: 60 }, activate: true })).json();
    assert.equal(svc.status, 'ACTIVE', 'no consent needed for a service'); assert.equal(svc.vertical, 'services');
    assert.equal((await (await call(sb, '')).json()).items.length, 1, 'the other client sees only its own');
    assert.equal((await call(sb, '/' + created.id, { price: 1 }, 'PATCH')).status, 404);
    assert.equal((await call(sb, '/' + created.id + '/close', { outcome: 'SOLD' })).status, 404);
    assert.equal((await call(sb, '/' + created.id + '/photos', { imageBase64: PNG.toString('base64'), mimeType: 'image/png' })).status, 404);
    const up = await call(sa, '/' + created.id + '/photos', { imageBase64: PNG.toString('base64'), mimeType: 'image/png' });
    assert.equal(up.status, 200);
    const photoId = (await up.json()).id;
    assert.equal((await fetch(root + '/app/api/catalog/' + created.id + '/photos/' + photoId, { headers: { Cookie: sa.cookie } })).status, 200);
    assert.equal((await fetch(root + '/app/api/catalog/' + created.id + '/photos/' + photoId, { headers: { Cookie: sb.cookie } })).status, 404);
    const otherLead = (await require('../crmService').create(b, { name: 'ליד', phone: '0501234567' })).id;
    assert.equal((await call(sa, '/' + created.id + '/leads', { leadId: otherLead })).status, 409);
    const ownLead = (await require('../crmService').create(a, { name: 'ליד', phone: '0501234568' })).id;
    assert.equal((await call(sa, '/' + created.id + '/leads', { leadId: ownLead })).status, 200);
    const listed = (await (await call(sa, '')).json()).items.find((x) => x.id === created.id);
    assert.equal(listed.leads, 1); assert.equal(listed.photos, 1);
    const closed = await call(sb, '/' + svc.id + '/close', { outcome: 'ENDED' });
    assert.equal(closed.status, 200); assert.match((await closed.json()).reply, /הופסק/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await close();
    for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
    Object.assign(process.env, env);
  }
});
