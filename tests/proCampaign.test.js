'use strict';
// Senior media-buyer campaign building: 2-5 different ads, Advantage+ defaults for small budgets,
// higher-intent lead forms, and professional pacing in the campaign guard. Meta is always mocked.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const axios = require('axios');
const { openDatabase } = require('./helpers/isolatedDatabase');
const { createActionPlan, formatActionPlan } = require('../actionPlan');
const { strictPlan } = require('../approvalPolicy');
const { validateActionPlan } = require('../actionValidator');
const buying = require('../mediaBuying');
const forms = require('../metaLeadForms');
const guard = require('../campaignGuard');

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
// A tiny fake Graph API for one ad account (axios mocked), recording every write.
function fakeMeta(account, extraReads = {}) {
  const objects = new Map(), posts = [], reads = [];
  let next = 5000;
  const get = axios.get, post = axios.post;
  axios.get = async (url, options) => {
    reads.push({ url, params: options?.params });
    if (url.endsWith('/me/permissions')) return { data: { data: [{ permission: 'ads_read', status: 'granted' }, { permission: 'ads_management', status: 'granted' }] } };
    if (url.endsWith('/act_' + account)) return { data: { id: 'act_' + account, name: 'עסק בדיקה', currency: 'ILS', timezone_name: 'Asia/Jerusalem', account_status: 1 } };
    if (url.endsWith('/me/accounts')) return { data: { data: [{ id: '12', name: 'עמוד', access_token: 'page-token' }] } };
    const key = url.split('/').at(-1);
    if (extraReads[key]) return { data: typeof extraReads[key] === 'function' ? extraReads[key](options?.params) : extraReads[key] };
    if (objects.has(key)) return { data: objects.get(key) };
    throw Error('UNEXPECTED_READ ' + url);
  };
  axios.post = async (url, body) => {
    const p = Object.fromEntries(body.entries()), key = url.split('/').at(-1);
    posts.push({ path: url.split('/').slice(-2).join('/'), body: p });
    if (objects.has(key)) { objects.set(key, { ...objects.get(key), ...p }); return { data: { success: true } }; }
    const id = String(++next), parsed = Object.fromEntries(Object.entries(p).map(([k, v]) => { try { return [k, /^[{[]/.test(v) ? JSON.parse(v) : v]; } catch { return [k, v]; } }));
    objects.set(id, { ...parsed, id, account_id: String(account), creative: parsed.creative ? { id: parsed.creative.creative_id } : undefined });
    return { data: { id } };
  };
  return { posts, reads, objects, restore: () => { axios.get = get; axios.post = post; } };
}

const set = (extra = {}) => ({ name: 'קהל', dailyBudget: 100, dailyBudgetMinor: 10000, currency: 'ILS', billingEvent: 'IMPRESSIONS', optimizationGoal: 'LINK_CLICKS', targeting: { geo_locations: { countries: ['IL'] } }, startTime: '2026-12-01T09:00:00Z', ...extra });
const ADS = [{ headline: 'דירה בלי עמלה', message: 'נמאס לחפש?', imageHash: 'hash1' }, { headline: '200 משפחות מרוצות', message: 'תשאלו את השכנים', imageHash: 'hash2' }, { headline: 'ייעוץ ראשון חינם', message: 'השאירו פרטים', imageHash: 'hash3' }];
const bundle = (patch = {}) => createActionPlan({ intent: 'CREATE_BUNDLE', summary: 'קמפיין', target: { accountId: 'act_1' }, parameters: { name: 'Leads', objective: 'OUTCOME_TRAFFIC', dailyBudget: 100, dailyBudgetMinor: 10000, currency: 'ILS', pageId: '555', link: 'https://business.example', message: ADS[0].message, headline: ADS[0].headline, imageHash: ADS[0].imageHash, ads: ADS, adSets: [set()], ...patch } });

// ---------- 1. CREATE_BUNDLE with 2-5 different ads ----------
test('a bundle carries 2-5 different ads, each with its own image and copy, shown in plain Hebrew', () => {
  const plan = bundle();
  strictPlan(plan);
  assert.equal(validateActionPlan(plan).ok, true);
  const text = formatActionPlan(plan);
  assert.match(text, /3 מודעות שונות/);
  assert.match(text, /1\. דירה בלי עמלה/); assert.match(text, /3\. ייעוץ ראשון חינם/);
  assert.match(text, /Meta תריץ את 3 המודעות/);
  assert.doesNotMatch(text, /hash1/, 'no technical identifiers for the owner');
  // Backward compatible: the single-ad plan and the copy-only variants still work.
  strictPlan(bundle({ ads: undefined }));
  strictPlan(bundle({ ads: undefined, variants: [{ headline: 'ב', message: 'ב' }] }));
});

test('ad count, per-ad image, per-ad copy and duplicates are validated', () => {
  // Refused before approval, with the exact reason from the bundle check.
  const bad = (patch, re) => { assert.throws(() => strictPlan(bundle(patch))); assert.throws(() => buying.checkBundleAds(bundle(patch).parameters), re); };
  bad({ ads: [ADS[0]] }, /INVALID_BUNDLE_ADS/);
  bad({ ads: [...ADS, { ...ADS[1], imageHash: 'h4' }, { ...ADS[1], imageHash: 'h5' }, { ...ADS[1], imageHash: 'h6' }] }, /INVALID_BUNDLE_ADS/);
  bad({ ads: [ADS[0], { headline: 'x', message: 'y' }] }, /BUNDLE_AD_IMAGE_REQUIRED/);
  bad({ ads: [ADS[0], { headline: 'x', imageHash: 'h2' }] }, /BUNDLE_AD_COPY_REQUIRED/);
  bad({ ads: [ADS[0], { ...ADS[0] }] }, /DUPLICATE_BUNDLE_AD/);
  bad({ ads: [ADS[0], { ...ADS[1], status: 'ACTIVE' }] }, /INVALID_BUNDLE_ADS/);
  bad({ variants: [{ headline: 'ב', message: 'ב' }] }, /ADS_AND_VARIANTS_CONFLICT/);
  bad({ headline: 'אחר' }, /BUNDLE_FIRST_AD_MISMATCH/);
  bad({ adSets: [set(), set({ name: 'ב' }), set({ name: 'ג' }), set({ name: 'ד' }), set({ name: 'ה' })], ads: [...ADS, { ...ADS[1], imageHash: 'h4' }, { ...ADS[1], imageHash: 'h5' }], dailyBudget: 500, dailyBudgetMinor: 50000 }, /BUNDLE_TOO_MANY_ADS/);
  const errors = validateActionPlan(bundle({ ads: [ADS[0], { headline: 'x', message: '' }] })).errors;
  assert.ok(errors.some((e) => /Ad 2 is missing its image/.test(e)) && errors.some((e) => /Ad 2 is missing its copy/.test(e)));
});

// ---------- 2. Small-budget defaults ----------
test('small budgets get Advantage+ audience with the location as the hard limit, and automatic placements', () => {
  const plan = bundle({ adSets: [set({ targeting: { geo_locations: { countries: ['IL'] }, age_min: 30, age_max: 55, publisher_platforms: ['facebook'], facebook_positions: ['feed'] } })] });
  buying.applyBundleDefaults(plan);
  const t = plan.parameters.adSets[0].targeting;
  assert.deepEqual(t.targeting_automation, { advantage_audience: 1 });
  assert.deepEqual(t.geo_locations, { countries: ['IL'] }, 'location stays the manual setting');
  assert.equal(t.age_max, 65); assert.equal(t.age_min, 25, 'Meta allows a hard minimum age of 18-25 only');
  assert.deepEqual(t.age_range, [30, 55], 'the owner age becomes a suggestion');
  assert.equal(t.publisher_platforms, undefined); assert.equal(t.facebook_positions, undefined);
  strictPlan(plan);
  const text = formatActionPlan(plan);
  assert.match(text, /קהל Advantage\+/); assert.match(text, /אוטומטי בפייסבוק ובאינסטגרם/); assert.match(text, /העדפה: גילאי 30–55/);
  // Meta's adset body carries exactly the approved targeting.
  const body = require('../metaWrite').adsetBody(plan.parameters.adSets[0], '9');
  assert.equal(body.targeting.targeting_automation.advantage_audience, 1); assert.equal(body.targeting.publisher_platforms, undefined); assert.equal(body.status, 'PAUSED');
});

test('defaults stay away from large budgets and from audiences the owner narrowed on purpose', () => {
  const big = bundle({ dailyBudget: 1000, dailyBudgetMinor: 100000, adSets: [set({ dailyBudget: 1000, dailyBudgetMinor: 100000 })] });
  buying.applyBundleDefaults(big);
  assert.equal(big.parameters.adSets[0].targeting.targeting_automation, undefined);
  const women = bundle({ adSets: [set({ targeting: { geo_locations: { countries: ['IL'] }, genders: [2] } })] });
  buying.applyBundleDefaults(women);
  assert.equal(women.parameters.adSets[0].targeting.targeting_automation, undefined);
  assert.equal(require('../metaWrite').adsetBody(women.parameters.adSets[0], '9').targeting.targeting_automation.advantage_audience, 0, 'exact audience as approved');
  // Advantage+ shapes Meta rejects are refused before approval.
  assert.throws(() => strictPlan(bundle({ adSets: [set({ targeting: { geo_locations: { countries: ['IL'] }, targeting_automation: { advantage_audience: 1 }, age_max: 50 } })] })), /ADVANTAGE_AUDIENCE_AGE/);
  // One ad set at small budgets.
  const split = bundle({ dailyBudget: 100, adSets: [set({ dailyBudget: 50, dailyBudgetMinor: 5000 }), set({ name: 'ב', dailyBudget: 50, dailyBudgetMinor: 5000 })] });
  assert.match(buying.singleAdSetIssue(split).message, /SMALL_BUDGET_SINGLE_ADSET/);
  assert.match(buying.singleAdSetIssue(split).reply, /קהל אחד/);
  assert.equal(buying.singleAdSetIssue(bundle()), null);
});

test('approved bundle with 3 ads creates 3 paused creatives with their own images and verifies them', async () => {
  setEnv();
  const { db, close } = await openDatabase();
  const fake = fakeMeta(70951);
  try {
    const id = await ownerWithMeta(db, '972500000951', 70951);
    const input = createActionPlan({ intent: 'CREATE_BUNDLE', summary: 'יצירה מושהית', target: { accountId: 'act_70951' }, parameters: { name: 'בדיקה', objective: 'OUTCOME_TRAFFIC', dailyBudget: 100, pageId: '12', link: 'https://example.com', message: ADS[0].message, headline: ADS[0].headline, imageHash: ADS[0].imageHash, ads: ADS,
      adSets: [{ name: 'קהל', dailyBudget: 100, targeting: { geo_locations: { countries: ['IL'] }, age_min: 18 }, billingEvent: 'IMPRESSIONS', optimizationGoal: 'LINK_CLICKS', startTime: '2026-12-01T10:00:00Z' }] } });
    const approval = await require('../approvalEngine').createApprovalForClient(id, input);
    assert.deepEqual(approval.actionPlan.parameters.adSets[0].targeting.targeting_automation, { advantage_audience: 1 }, 'default is inside the approved plan');
    const result = await require('../metaConnection').context.run(String(id), () => require('../dashboardApprovals').approve(id, approval.actionId));
    assert.equal(result.ok, true, result.reply);
    const creatives = fake.posts.filter((p) => p.path.endsWith('/adcreatives')).map((p) => JSON.parse(p.body.object_story_spec).link_data);
    assert.deepEqual(creatives.map((c) => c.image_hash), ['hash1', 'hash2', 'hash3']);
    assert.deepEqual(creatives.map((c) => c.name), ADS.map((a) => a.headline));
    assert.equal(fake.posts.filter((p) => p.path.endsWith('/ads')).length, 3);
    const adset = JSON.parse(fake.posts.find((p) => p.path.endsWith('/adsets')).body.targeting);
    assert.equal(adset.targeting_automation.advantage_audience, 1); assert.equal(adset.publisher_platforms, undefined);
    assert.ok(fake.posts.filter((p) => p.body.status).every((p) => p.body.status === 'PAUSED'), 'nothing activated');
  } finally { fake.restore(); await close(); restoreEnv(); }
});

test('verification fails when a created ad does not carry its approved image', async () => {
  const meta = require('../metaConnection');
  const graph = meta.graph, credentials = meta.credentials;
  const plan = bundle({ adSets: [set({ targeting: { geo_locations: { countries: ['IL'] }, age_min: 18, age_max: 65, targeting_automation: { advantage_audience: 1 } } })] });
  const objects = { campaignId: '10', creativeId: '20', creativeIds: ['20', '21', '22'], adsetIds: ['30'], adIds: ['40', '41', '42'] };
  const creative = (hash, name) => ({ account_id: '1', object_story_spec: { link_data: { image_hash: hash, name } } });
  const store = { 10: { id: '10', account_id: '1', status: 'PAUSED', name: 'Leads', objective: 'OUTCOME_TRAFFIC' }, 20: creative('hash1', ADS[0].headline), 21: creative('hash2', ADS[1].headline), 22: creative('hash3', ADS[2].headline),
    30: { account_id: '1', status: 'PAUSED', campaign_id: '10', daily_budget: '10000', targeting: { targeting_automation: { advantage_audience: 1 } } },
    40: { account_id: '1', status: 'PAUSED', adset_id: '30', creative: { id: '20' } }, 41: { account_id: '1', status: 'PAUSED', adset_id: '30', creative: { id: '21' } }, 42: { account_id: '1', status: 'PAUSED', adset_id: '30', creative: { id: '22' } } };
  meta.credentials = async () => ({ token: 't' });
  meta.graph = async (path) => store[path.slice(1)];
  try {
    const verify = () => meta.context.run('1', () => require('../metaVerify').verifyAction(plan, { id: '10', objects }));
    assert.equal((await verify()).verified, true);
    store[22] = creative('hash1', ADS[2].headline);
    assert.equal((await verify()).verified, false, 'wrong image on ad 3');
    store[22] = creative('hash3', ADS[2].headline);
    store[30] = { ...store[30], targeting: { targeting_automation: { advantage_audience: 0 } } };
    assert.equal((await verify()).verified, false, 'Advantage+ audience not applied');
  } finally { meta.graph = graph; meta.credentials = credentials; }
});

// ---------- 3. Lead forms ----------
const form = (patch = {}) => ({ name: 'טופס דירות', pageId: '555', locale: 'HE_IL', privacyPolicyUrl: 'https://business.example/privacy',
  questions: [{ type: 'FULL_NAME' }, { type: 'PHONE' }, { type: 'CUSTOM', key: 'deal', label: 'לקנות או לשכור?', options: ['לקנות', 'לשכור'] }, { type: 'CUSTOM', key: 'when', label: 'מתי?', options: ['עכשיו', 'תוך 3 חודשים', 'בהמשך'] }],
  formType: 'HIGHER_INTENT', thankYou: { buttonType: 'VIEW_WEBSITE', websiteUrl: 'https://wa.me/972501234567' }, ...patch });

test('higher-intent lead form with qualifying questions and a WhatsApp or call ending', () => {
  const body = forms.formBody(form());
  assert.equal(body[forms.HIGHER_INTENT_FIELD], true); assert.equal(forms.HIGHER_INTENT_FIELD, 'is_optimized_for_quality');
  assert.deepEqual(body.privacy_policy, { url: 'https://business.example/privacy' });
  assert.deepEqual(body.questions[2], { type: 'CUSTOM', key: 'deal', label: 'לקנות או לשכור?', options: [{ key: 'deal_1', value: 'לקנות' }, { key: 'deal_2', value: 'לשכור' }] });
  assert.deepEqual(body.questions[0], { type: 'FULL_NAME' });
  assert.equal(body.thank_you_page.button_type, 'VIEW_WEBSITE'); assert.equal(body.thank_you_page.website_url, 'https://wa.me/972501234567');
  const call = forms.formBody(form({ thankYou: { buttonType: 'CALL_BUSINESS', phone: '+972501234567' } })).thank_you_page;
  assert.equal(call.button_type, 'CALL_BUSINESS'); assert.equal(call.business_phone_number, '+972501234567'); assert.equal(call.website_url, undefined);
  assert.equal(forms.formBody(form({ formType: 'MORE_VOLUME', thankYou: undefined })).is_optimized_for_quality, false);
  // Older plans: higher intent by default, no ending button.
  const legacy = forms.formBody(form({ formType: undefined, thankYou: undefined }));
  assert.equal(legacy.is_optimized_for_quality, true); assert.equal(legacy.thank_you_page.button_type, 'NONE');
  const plan = createActionPlan({ intent: 'CREATE_LEAD_FORM', target: { accountId: 'act_11' }, parameters: form() });
  strictPlan(plan);
  const text = formatActionPlan(plan);
  assert.match(text, /כוונה גבוהה/); assert.match(text, /2 שאלות סינון/); assert.match(text, /לקנות או לשכור\? \(לקנות \/ לשכור\)/); assert.match(text, /wa\.me/); assert.match(text, /האישור יוצר טופס בלבד/);
});

test('lead form rules: privacy link, at most 3 qualifying questions, real options and a valid ending', () => {
  const q = (key) => ({ type: 'CUSTOM', key, label: 'שאלה ' + key, options: ['א', 'ב'] });
  const bad = (patch, re) => assert.throws(() => strictPlan(createActionPlan({ intent: 'CREATE_LEAD_FORM', target: { accountId: 'act_11' }, parameters: form(patch) })), re);
  bad({ privacyPolicyUrl: undefined }, /FORM_PRIVACY_URL_REQUIRED/);
  bad({ questions: [{ type: 'FULL_NAME' }, { type: 'PHONE' }, q('a'), q('b'), q('c'), q('d')] }, /TOO_MANY_QUALIFYING_QUESTIONS/);
  bad({ questions: [{ type: 'FULL_NAME' }, { type: 'PHONE' }, { ...q('a'), options: ['א', 'א'] }] }, /INVALID_FORM_OPTIONS/);
  bad({ thankYou: { buttonType: 'CALL_BUSINESS' } }, /FORM_THANK_YOU_PHONE_REQUIRED/);
  bad({ thankYou: { buttonType: 'VIEW_WEBSITE', websiteUrl: 'http://127.0.0.1/x' } }, /FORM_THANK_YOU_URL_REQUIRED/);
  bad({ thankYou: { buttonType: 'DOWNLOAD' } }, /INVALID_FORM_THANK_YOU/);
  bad({ formType: 'RICH_CREATIVE' }, /INVALID_FORM_TYPE/);
});

test('createLeadForm sends the higher-intent body to the granted Page (axios mocked) and verifies the options', async () => {
  setEnv();
  const permits = require('../metaExecution'), pages = forms.pageAccess, inspect = forms.inspect, assertPermit = permits.assertPermit, meta = require('../metaConnection');
  const get = axios.get, post = axios.post, graph = meta.graph;
  const sent = [];
  permits.assertPermit = (plan) => ({ token: 'user-token', clientId: '1', plan });
  forms.pageAccess = async () => ({ token: 'page-token' });
  axios.post = async (url, body, options) => { sent.push({ url, body: Object.fromEntries(body.entries()), auth: options.headers.Authorization }); return { data: { id: '777' } }; };
  axios.get = async () => { throw Error('UNEXPECTED_READ'); };
  try {
    const plan = createActionPlan({ intent: 'CREATE_LEAD_FORM', target: { accountId: 'act_11' }, parameters: form({ thankYou: { buttonType: 'CALL_BUSINESS', phone: '+972501234567', buttonText: 'להתקשר למשרד' } }) });
    assert.deepEqual(await require('../metaWrite').createLeadForm(plan), { id: '777' });
    assert.equal(sent.length, 1); assert.match(sent[0].url, /\/555\/leadgen_forms$/); assert.equal(sent[0].auth, 'Bearer page-token');
    assert.equal(sent[0].body.is_optimized_for_quality, 'true');
    assert.deepEqual(JSON.parse(sent[0].body.thank_you_page).button_text, 'להתקשר למשרד');
    assert.equal(JSON.parse(sent[0].body.questions)[3].options.length, 3);
    // Verification compares the options Meta stored.
    const stored = { id: '777', page_id: '555', name: plan.parameters.name, locale: 'HE_IL', privacy_policy_url: plan.parameters.privacyPolicyUrl, status: 'ACTIVE', questions: forms.formBody(plan.parameters).questions };
    forms.inspect = async () => ({ form: stored });
    assert.equal((await require('../metaVerify').verifyAction(plan, { id: '777' })).verified, true);
    stored.questions = stored.questions.map((x, i) => (i === 3 ? { ...x, options: x.options.slice(0, 2) } : x));
    assert.equal((await require('../metaVerify').verifyAction(plan, { id: '777' })).verified, false);
  } finally { permits.assertPermit = assertPermit; forms.pageAccess = pages; forms.inspect = inspect; axios.get = get; axios.post = post; meta.graph = graph; restoreEnv(); }
});

// ---------- 4. Campaign guard pacing ----------
const NOW = new Date('2026-11-17T09:00:00Z');
const old = new Date(NOW - 10 * 864e5).toISOString(), recent = new Date(NOW - 24 * 36e5).toISOString();
const row = (spend, leads, extra = {}) => ({ spend: String(spend), impressions: '8000', ctr: '1.2', frequency: '1.5', actions: leads ? [{ action_type: 'lead', value: String(leads) }] : [], ...extra });
const account = { account_status: 1, currency: 'ILS', spend30: 1000, leads30: 25 }; // 40 ₪ per lead
const ad = (id, spend, leads, extra = {}) => ({ id, name: 'מודעה ' + id, adset_id: '30', effective_status: 'ACTIVE', created_time: old, d7: row(spend, leads), ...extra });
const campaign = (extra = {}) => ({ id: '1', name: 'דירות', effective_status: 'ACTIVE', created_time: old, d7: row(200, 4), d3: row(80, 2), d30: row(600, 16), ads: [ad('41', 90, 0), ad('42', 110, 4)], ...extra });

test('guard proposes pausing one ad that spent 2x the target cost per lead with no lead', () => {
  const f = guard.evaluate({ account, now: NOW, campaigns: [campaign()] });
  assert.equal(f[0].kind, 'AD_NO_LEADS'); assert.equal(f[0].pause, true); assert.equal(f[0].adId, '41');
  assert.match(f[0].text, /90 ₪/); assert.match(f[0].text, /40 ₪/); assert.match(f[0].text, /הקמפיין עצמו ממשיך לרוץ/);
  assert.equal(guard.evaluate({ account: { ...account, targetCpl: 50 }, now: NOW, campaigns: [campaign()] }).length, 0, 'below 2x the owner target');
  assert.equal(guard.evaluate({ account, now: NOW, campaigns: [campaign({ ads: [ad('41', 79, 0), ad('42', 110, 4)] })] }).length, 0, 'below 2x');
  assert.equal(guard.evaluate({ account, now: NOW, campaigns: [campaign({ ads: [ad('41', 90, 0)] })] }).length, 0, 'never the only ad in the ad set');
  assert.equal(guard.evaluate({ account, now: NOW, campaigns: [campaign({ ads: [ad('41', 90, 0, { created_time: recent }), ad('42', 110, 4)] })] }).length, 0, 'a new ad gets its 72 hours');
});

test('no performance judgement within 72 hours of launch or of the last major change', () => {
  assert.equal(guard.evaluate({ account, now: NOW, campaigns: [campaign({ lastMajorChange: recent })] }).length, 0);
  assert.equal(guard.evaluate({ account, now: NOW, campaigns: [campaign({ created_time: recent })] }).length, 0);
  assert.ok(guard.settledHours({ created_time: old, lastMajorChange: recent }, NOW) < 72);
  const today = { id: '1', name: 'דירות', effective_status: 'ACTIVE', dailyBudget: 100, today: { spend: '85', actions: [] }, created_time: old, lastMajorChange: recent };
  const MIDDAY = new Date('2026-11-17T11:00:00Z');
  assert.equal(guard.evaluateToday({ account, now: MIDDAY, campaigns: [today] }).length, 0, 'midday burn alert waits too');
  assert.equal(guard.evaluateToday({ account, now: MIDDAY, campaigns: [today], cap: 50 })[0].kind, 'SPEND_CAP', 'the owner cap is always enforced');
  assert.equal(guard.evaluateToday({ account, now: MIDDAY, campaigns: [{ ...today, lastMajorChange: undefined }] })[0].kind, 'BURN_NO_LEADS');
});

test('7-day frequency above 4 is creative fatigue', () => {
  const tired = campaign({ ads: [], d7: row(200, 4, { frequency: '4.3' }) });
  const f = guard.evaluate({ account, now: NOW, campaigns: [tired] });
  assert.equal(f[0].kind, 'FATIGUE'); assert.match(f[0].text, /4\.3 פעמים/); assert.equal(f[0].pause, undefined, 'a proposal, never an action');
  assert.equal(guard.evaluate({ account, now: NOW, campaigns: [campaign({ ads: [], d7: row(200, 4, { frequency: '4' }) })] }).length, 0);
});

test('guard reads ads on a 7-day window and finds the last major change (axios mocked, read only)', async () => {
  setEnv();
  const { db, close } = await openDatabase();
  const fake = fakeMeta(70952, {
    campaigns: { data: [{ id: '1', name: 'דירות', effective_status: 'ACTIVE', created_time: old }] },
    insights: (params) => ({ data: params.level === 'ad' ? [{ ad_id: '41', adset_id: '30', campaign_id: '1', spend: '120', impressions: '3000', actions: [] }, { ad_id: '42', adset_id: '30', campaign_id: '1', spend: '110', impressions: '5000', actions: [{ action_type: 'lead', value: '4' }] }] : [{ campaign_id: '1', ...row(200, 4) }] }),
    adsets: { data: [{ id: '30', campaign_id: '1', created_time: old, updated_time: recent }] },
    ads: { data: [{ id: '41', name: 'א', adset_id: '30', campaign_id: '1', effective_status: 'ACTIVE', created_time: old }, { id: '42', name: 'ב', adset_id: '30', campaign_id: '1', effective_status: 'ACTIVE', created_time: old }] }
  });
  try {
    const id = await ownerWithMeta(db, '972500000952', 70952);
    const data = await guard.load(id);
    const c = data.campaigns[0];
    assert.equal(c.lastMajorChange, new Date(recent).toISOString());
    assert.deepEqual(c.ads.map((a) => [a.id, a.d7.spend]), [['41', '120'], ['42', '110']]);
    assert.ok(fake.reads.some((r) => r.params?.level === 'ad' && r.params.date_preset === 'last_7d'));
    assert.equal(guard.evaluate({ ...data, now: NOW }).length, 0, 'ad set edited a day ago: still learning');
    assert.equal(guard.evaluate({ ...data, now: new Date(NOW.getTime() + 3 * 864e5) })[0].kind, 'AD_NO_LEADS');
    assert.equal(fake.posts.length, 0);
  } finally { fake.restore(); await close(); restoreEnv(); }
});

test('pausing one ad is a proposal through the approval engine; approving pauses only that ad', async () => {
  setEnv();
  const { db, close } = await openDatabase();
  const fake = fakeMeta(70953, { 1: { id: '1', account_id: '70953', name: 'דירות', objective: 'OUTCOME_LEADS', daily_budget: '10000' } });
  fake.objects.set('41', { id: '41', account_id: '70953', campaign_id: '1', name: 'מודעה 41', status: 'ACTIVE' });
  try {
    const id = await ownerWithMeta(db, '972500000953', 70953);
    const data = { account, accountId: 'act_70953', campaigns: [campaign()] };
    const run = await guard.runDue({ now: NOW, loader: async (c) => (String(c) === String(id) ? data : null), intradayLoader: async () => null });
    assert.ok(run.results.includes('PROPOSED_PAUSE'), JSON.stringify(run));
    assert.equal(fake.posts.length, 0, 'nothing paused without the owner');
    const approval = (await db.query("SELECT a.action_id, p.payload FROM approvals a JOIN action_plans p ON p.id=a.action_id WHERE a.client_id=$1 AND a.status='PENDING'", [id])).rows[0];
    assert.equal(approval.payload.intent, 'PAUSE_AD'); assert.equal(approval.payload.target.adId, '41'); assert.equal(approval.payload.target.adName, 'מודעה 41');
    const card = formatActionPlan(approval.payload);
    assert.match(card, /השהיית מודעה אחת/); assert.match(card, /מודעה 41/); assert.match(card, /שאר המודעות בקמפיין ממשיכות לרוץ/);
    const result = await require('../metaConnection').context.run(String(id), () => require('../dashboardApprovals').approve(id, approval.action_id));
    assert.equal(result.ok, true, result.reply);
    assert.equal(fake.posts.length, 1, 'one write: that ad only');
    assert.match(fake.posts[0].path, /\/41$/); assert.deepEqual(fake.posts[0].body, { status: 'PAUSED' });
  } finally { fake.restore(); await close(); restoreEnv(); }
});

test('a work agreement that allows pausing losers pauses the ad and reports; a pause stays protective', () => {
  const { actionClass } = require('../workAgreement');
  if (actionClass) assert.equal(actionClass({ intent: 'PAUSE_AD' }), 'PROTECTIVE');
  const authority = require('../scopedAuthority');
  const row = { status: 'ACTIVE', policy: { kind: authority.AGREEMENT, clientId: '7', currency: 'ILS', maxDailyPerCampaign: 100, allow: { pauseLosing: true } } };
  row.policy_hash = require('../approvalPolicy').planHash(row.policy);
  assert.deepEqual(authority.agreementDecision(row, { intent: 'PAUSE_AD', tenantId: '7', review: { currency: 'ILS' } }), { ok: true, why: 'PROTECTIVE' });
  row.policy.allow.pauseLosing = false; row.policy_hash = require('../approvalPolicy').planHash(row.policy);
  assert.equal(authority.agreementDecision(row, { intent: 'PAUSE_AD', tenantId: '7', review: { currency: 'ILS' } }).ok, false);
});
