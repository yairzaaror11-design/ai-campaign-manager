'use strict';
// Spend safety: no Advantage+ creative enhancements, the owner's daily spend cap,
// and the midday guard that proposes (never performs) a pause.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const axios = require('axios');
const { openDatabase } = require('./helpers/isolatedDatabase');
const guard = require('../campaignGuard');
const spendCap = require('../spendCap');

const env = { ...process.env };
function setEnv() {
  Object.assign(process.env, { APP_PUBLIC_URL: 'https://test.example', META_APP_ID: process.env.META_APP_ID || '123', META_APP_SECRET: 'test', META_LOGIN_CONFIG_ID: '456', META_TOKEN_ENCRYPTION_KEY: process.env.META_TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64'), APPROVAL_HMAC_KEY: process.env.APPROVAL_HMAC_KEY || crypto.randomBytes(32).toString('hex'), READ_ONLY: 'false', META_WRITES_ENABLED: 'true', WHATSAPP_SEND_ENABLED: 'false' });
}
function restoreEnv() { for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k]; Object.assign(process.env, env); }

async function ownerWithMeta(db, phone, account) {
  const meta = require('../metaConnection');
  const id = (await db.query('INSERT INTO clients(phone,meta_ad_account_id) VALUES($1,$2) RETURNING id', [phone, 'act_' + account])).rows[0].id;
  await db.query("INSERT INTO meta_connections(client_id,meta_user_id,token_ciphertext,app_id,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 hour')", [id, 'u' + phone, meta.encrypt('test-token', id), process.env.META_APP_ID]);
  await db.query('INSERT INTO whatsapp_contacts(phone,last_inbound_at) VALUES($1,NOW()) ON CONFLICT(phone) DO UPDATE SET last_inbound_at=NOW()', [phone]);
  return id;
}
// A tiny fake Graph API for one ad account, recording every write.
function fakeMeta(account, extraReads = {}) {
  const objects = new Map(), posts = [];
  let next = 5000;
  const get = axios.get, post = axios.post;
  axios.get = async (url) => {
    if (url.endsWith('/me/permissions')) return { data: { data: [{ permission: 'ads_read', status: 'granted' }, { permission: 'ads_management', status: 'granted' }] } };
    if (url.endsWith('/act_' + account)) return { data: { id: 'act_' + account, name: 'עסק בדיקה', currency: 'ILS', timezone_name: 'Asia/Jerusalem', account_status: 1 } };
    if (url.endsWith('/me/accounts')) return { data: { data: [{ id: '12', name: 'עמוד' }] } };
    const key = url.split('/').at(-1);
    if (extraReads[key]) return { data: extraReads[key] };
    if (objects.has(key)) return { data: objects.get(key) };
    throw Error('UNEXPECTED_READ ' + url);
  };
  axios.post = async (url, body) => {
    const p = Object.fromEntries(body.entries()), key = url.split('/').at(-1);
    posts.push({ path: url.split('/').slice(-2).join('/'), body: p });
    if (objects.has(key)) { objects.set(key, { ...objects.get(key), ...p }); return { data: { id: key } }; }
    const id = String(++next);
    objects.set(id, { ...p, id, account_id: String(account), creative: p.creative ? { id: JSON.parse(p.creative).creative_id } : undefined });
    return { data: { id } };
  };
  return { posts, restore: () => { axios.get = get; axios.post = post; } };
}
const bundle = (account, dailyBudget, extra = {}) => require('../actionPlan').createActionPlan({ intent: 'CREATE_BUNDLE', summary: 'יצירה מושהית', target: { accountId: 'act_' + account }, parameters: { name: 'בדיקה', objective: 'OUTCOME_TRAFFIC', dailyBudget, pageId: '12', link: 'https://example.com', message: 'נוסח', headline: 'כותרת', imageHash: 'img', adSets: [{ name: 'קהל', dailyBudget, targeting: { geo_locations: { countries: ['IL'] }, age_min: 18 }, billingEvent: 'IMPRESSIONS', optimizationGoal: 'LINK_CLICKS', startTime: '2026-12-01T10:00:00Z' }], ...extra } });

test('every creative SCORPIO creates opts out of Advantage+ creative enhancements', async () => {
  const { NO_ENHANCEMENTS, ENHANCEMENT_FEATURES } = require('../metaWrite');
  assert.deepEqual(NO_ENHANCEMENTS.creative_features_spec.standard_enhancements, { enroll_status: 'OPT_OUT' });
  assert.ok(ENHANCEMENT_FEATURES.every((k) => NO_ENHANCEMENTS.creative_features_spec[k].enroll_status === 'OPT_OUT'));
  setEnv();
  const { db, close } = await openDatabase();
  const fake = fakeMeta(70901);
  try {
    const id = await ownerWithMeta(db, '972500000901', 70901);
    const approval = await require('../approvalEngine').createApprovalForClient(id, bundle(70901, 100, { variants: [{ headline: 'כותרת ב', message: 'נוסח ב' }] }));
    const result = await require('../metaConnection').context.run(String(id), () => require('../dashboardApprovals').approve(id, approval.actionId));
    assert.equal(result.ok, true, result.reply);
    const creatives = fake.posts.filter((p) => p.path.endsWith('/adcreatives'));
    assert.equal(creatives.length, 2, 'main ad and the variant');
    for (const c of creatives) {
      const spec = JSON.parse(c.body.degrees_of_freedom_spec).creative_features_spec;
      for (const k of ['standard_enhancements', 'image_touchups', 'text_optimizations', 'adapt_to_placement', 'product_extensions']) assert.equal(spec[k].enroll_status, 'OPT_OUT', k);
      assert.ok(JSON.parse(c.body.object_story_spec).link_data, 'creative content unchanged');
    }
    assert.ok(fake.posts.filter((p) => p.body.status).every((p) => p.body.status === 'PAUSED'), 'nothing activated');
  } finally { fake.restore(); await close(); restoreEnv(); }
});

test('the owner sets, sees and removes a daily spend cap in plain Hebrew', () => {
  assert.deepEqual(spendCap.parse('תקרה יומית 150'), { op: 'set', amount: 150 });
  assert.deepEqual(spendCap.parse('תקרת הוצאה 150 ש"ח ליום'), { op: 'set', amount: 150 });
  assert.deepEqual(spendCap.parse('תקרת הוצאה יומית של 1,200 שקל'), { op: 'set', amount: 1200 });
  assert.deepEqual(spendCap.parse('מה התקרה היומית?'), { op: 'show' });
  assert.deepEqual(spendCap.parse('בטל את התקרה'), { op: 'clear' });
  assert.equal(spendCap.parse('תקרת זכוכית בעסק'), null);
  assert.equal(spendCap.parse('אני רוצה קמפיין של 150 ליום'), null);
});

test('no approval is offered for a plan above the daily cap, with a clear way to raise it', async () => {
  setEnv();
  const { db, close } = await openDatabase();
  const fake = fakeMeta(70902);
  try {
    const id = await ownerWithMeta(db, '972500000902', 70902);
    assert.match((await spendCap.handle(id, 'מה התקרה?')).reply, /עוד לא קבעת/);
    assert.match((await spendCap.handle(id, 'תקרה יומית 80')).reply, /80 ₪/);
    assert.equal(await spendCap.get(id), 80);
    await assert.rejects(require('../approvalEngine').createApprovalForClient(id, bundle(70902, 100)), (e) => {
      assert.equal(e.message, 'SPEND_CAP_EXCEEDED');
      assert.match(e.reply, /100 ₪/); assert.match(e.reply, /80 ₪/); assert.match(e.reply, /תקרה יומית 100/);
      return true;
    });
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM approvals WHERE client_id=$1', [id])).rows[0].n, 0);
    assert.ok((await require('../approvalEngine').createApprovalForClient(id, bundle(70902, 80))).actionId, 'at the cap is fine');
    await spendCap.handle(id, 'תקרה יומית 120');
    assert.ok((await require('../approvalEngine').createApprovalForClient(id, bundle(70902, 100))).actionId, 'raised cap allows it');
    assert.match((await spendCap.handle(id, 'בטל תקרה')).reply, /ביטלתי/);
    assert.equal(await spendCap.get(id), null);
    assert.equal(fake.posts.length, 0, 'nothing sent to Meta');
    // Resuming and budget changes count too.
    assert.equal(spendCap.planDailyMinor({ intent: 'RESUME_CAMPAIGN', review: { currentDailyBudgetMinor: '25000' } }), 25000);
    assert.equal(spendCap.planDailyMinor({ intent: 'ACTIVATE_BUNDLE', review: { adSets: [{ daily_budget: '5000' }, { daily_budget: '7000' }] } }), 12000);
    assert.equal(spendCap.planDailyMinor({ intent: 'PAUSE_CAMPAIGN' }), 0);
  } finally { fake.restore(); await close(); restoreEnv(); }
});

const MIDDAY = new Date('2026-11-17T11:00:00Z'); // Tuesday 13:00 Israel
const MORNING = new Date('2026-11-17T08:00:00Z'); // 10:00 Israel
const account = { account_status: 1, currency: 'ILS', spend30: 1000, leads30: 25 }; // 40 ₪ per lead
const today = (spend, leads) => ({ spend: String(spend), actions: leads ? [{ action_type: 'lead', value: String(leads) }] : [] });

test('midday: money burning without leads, and a cost per lead far above normal, get a pause proposal', () => {
  const burn = guard.evaluateToday({ account, now: MIDDAY, campaigns: [{ id: '1', name: 'דירות', effective_status: 'ACTIVE', dailyBudget: 100, today: today(80, 0) }] });
  assert.equal(burn[0].kind, 'BURN_NO_LEADS'); assert.equal(burn[0].pause, true); assert.match(burn[0].text, /80 ₪/); assert.match(burn[0].text, /לא עצרתי כלום בלי אישור שלך/);
  assert.equal(guard.evaluateToday({ account, now: MORNING, campaigns: [{ id: '1', effective_status: 'ACTIVE', dailyBudget: 100, today: today(80, 0) }] }).length, 0, 'not before midday');
  assert.equal(guard.evaluateToday({ account, now: MIDDAY, campaigns: [{ id: '1', effective_status: 'ACTIVE', dailyBudget: 100, today: today(60, 0) }] }).length, 0, 'under 75%');
  assert.equal(guard.evaluateToday({ account, now: MIDDAY, campaigns: [{ id: '1', effective_status: 'ACTIVE', dailyBudget: 100, today: today(80, 0), crmLeadsToday: 1 }] }).length, 0, 'CRM lead counts');
  const pricey = guard.evaluateToday({ account, now: MIDDAY, campaigns: [{ id: '2', name: 'מרפאה', effective_status: 'ACTIVE', dailyBudget: 300, today: today(250, 1) }] });
  assert.equal(pricey[0].kind, 'HIGH_CPL'); assert.equal(pricey[0].pause, true); assert.match(pricey[0].text, /עלות לליד 250 ₪/); assert.match(pricey[0].text, /40 ₪/);
  assert.equal(guard.evaluateToday({ account, now: MIDDAY, campaigns: [{ id: '2', effective_status: 'ACTIVE', dailyBudget: 300, today: today(100, 1) }] }).length, 0, 'within 3x');
});

test('the guard alerts when today\'s spend across campaigns passes the owner\'s cap', () => {
  const campaigns = [{ id: '1', name: 'א', effective_status: 'ACTIVE', dailyBudget: 200, today: today(90, 3) }, { id: '2', name: 'ב', effective_status: 'ACTIVE', dailyBudget: 200, today: today(80, 2) }];
  const f = guard.evaluateToday({ account, now: MORNING, campaigns, cap: 150 });
  assert.equal(f.length, 1); assert.equal(f[0].kind, 'SPEND_CAP'); assert.match(f[0].text, /170 ₪/); assert.match(f[0].text, /150 ₪/); assert.equal(f[0].pause, undefined);
  assert.equal(guard.evaluateToday({ account, now: MORNING, campaigns, cap: 200 }).length, 0);
  assert.equal(guard.evaluateToday({ account, now: MORNING, campaigns }).length, 0, 'no cap, no alert');
});

test('the midday run sends a pause approval through the approval engine and never pauses by itself', async () => {
  setEnv();
  const { db, close } = await openDatabase();
  const fake = fakeMeta(70903, { 777: { id: '777', account_id: '70903', name: 'דירות', objective: 'OUTCOME_LEADS', daily_budget: '10000' } });
  try {
    const id = await ownerWithMeta(db, '972500000903', 70903);
    await spendCap.set(id, 50);
    const data = { account, accountId: 'act_70903', campaigns: [{ id: '777', name: 'דירות', effective_status: 'ACTIVE', dailyBudget: 100, today: today(85, 0) }] };
    const first = await guard.runIntraday({ now: MIDDAY, loader: async () => data });
    assert.deepEqual(first.results, ['ALERTED+PROPOSED_PAUSE'], JSON.stringify(first));
    const plan = (await db.query("SELECT p.payload FROM approvals a JOIN action_plans p ON p.id=a.action_id WHERE a.client_id=$1 AND a.status='PENDING'", [id])).rows[0].payload;
    assert.equal(plan.intent, 'PAUSE_CAMPAIGN'); assert.equal(plan.target.campaignId, '777');
    assert.equal(fake.posts.length, 0, 'no write to Meta without the owner');
    assert.ok(await guard.ownsApproval(id, plan.id), 'the button works even mid-task');
    const sent = (await db.query('SELECT payload FROM whatsapp_outbox WHERE client_id=$1 ORDER BY delivery_order', [id])).rows.map((r) => JSON.stringify(r.payload));
    assert.equal(sent.length, 3, 'cap alert, then the pause proposal and its approval buttons');
    assert.match(sent[0], /תקרת ההוצאה היומית/); assert.match(sent[1], /אין אף פנייה/); assert.match(sent[2], /interactive/);
    assert.equal((await guard.runIntraday({ now: MIDDAY, loader: async () => data })).results.length, 0, 'once per slot');
    await require('../marketingStore').update(id, null, (p) => { delete p.ui; return { handled: false, changed: true }; });
    const later = await guard.runIntraday({ now: new Date('2026-11-17T15:00:00Z'), loader: async () => data });
    assert.deepEqual(later.results, ['QUIET'], 'same alerts are not repeated the same day');
  } finally { fake.restore(); await close(); restoreEnv(); }
});
