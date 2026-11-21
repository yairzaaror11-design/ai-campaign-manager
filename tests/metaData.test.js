'use strict';
// Meta data flows with a mocked Graph API: webhook signature, Lead Ads import, Pixel/CAPI
// dedup, PAUSED creation with HOUSING, Insights mapping and caching. Phones 9725000009xx.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');
const axios = require('axios');
const { openDatabase } = require('./helpers/isolatedDatabase');

function saveEnv() {
  const env = { ...process.env };
  Object.assign(process.env, { META_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'), META_APP_ID: '7001', META_APP_SECRET: 's', META_LOGIN_CONFIG_ID: '456', APP_PUBLIC_URL: 'https://campaign.example' });
  return () => { for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k]; Object.assign(process.env, env); }; }

// ---------- 1. Webhook ----------
async function webhookServer() {
  const app = express();
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = Buffer.from(buf); } }));
  app.use('/webhook', require('../webhook'));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: 'http://127.0.0.1:' + server.address().port + '/webhook', close: () => new Promise((r) => server.close(r)) };
}

test('webhook GET answers hub.challenge only for the configured verify token', async () => {
  const restore = saveEnv();
  process.env.META_WEBHOOK_VERIFY_TOKEN = 'lead-verify-token-123';
  process.env.WHATSAPP_VERIFY_TOKEN = 'wa-verify-token-456';
  const s = await webhookServer();
  try {
    const get = (token) => fetch(s.url + '?hub.mode=subscribe&hub.challenge=98765&hub.verify_token=' + encodeURIComponent(token));
    let r = await get('lead-verify-token-123');
    assert.equal(r.status, 200); assert.equal(await r.text(), '98765');
    assert.equal((await get('wa-verify-token-456')).status, 200, 'the WhatsApp token keeps working');
    assert.equal((await get('wrong')).status, 403);
    r = await fetch(s.url + '?hub.mode=unsubscribe&hub.challenge=1&hub.verify_token=lead-verify-token-123');
    assert.equal(r.status, 403);
  } finally { await s.close(); restore(); }
});

test('webhook POST verifies X-Hub-Signature-256 over the raw body and rejects unsigned or invalid', async () => {
  const restore = saveEnv();
  process.env.META_APP_SECRET = 'app-secret-for-tests';
  process.env.META_LEAD_IMPORT_ENABLED = 'true';
  const importer = require('../metaLeadImport');
  const enqueue = importer.enqueue; const received = [];
  importer.enqueue = async (body) => { received.push(body); };
  const s = await webhookServer();
  try {
    // Raw bytes as Meta sends them (escaped unicode): the HMAC is over exactly these bytes.
    const raw = '{"object":"page","entry":[{"id":"111","time":1,"changes":[{"field":"leadgen","value":{"leadgen_id":"333","page_id":"111","form_id":"222","note":"\\u05e9\\u05dc\\u05d5\\u05dd"}}]}]}';
    const sig = 'sha256=' + crypto.createHmac('sha256', 'app-secret-for-tests').update(raw).digest('hex');
    const post = (headers) => fetch(s.url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw });
    assert.equal((await post({})).status, 401, 'unsigned');
    assert.equal((await post({ 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) })).status, 401, 'wrong signature');
    assert.equal((await post({ 'x-hub-signature-256': sig.slice(0, -2) })).status, 401, 'truncated signature');
    const reSerialized = 'sha256=' + crypto.createHmac('sha256', 'app-secret-for-tests').update(JSON.stringify(JSON.parse(raw))).digest('hex');
    assert.equal((await post({ 'x-hub-signature-256': reSerialized })).status, 401, 'signature of a re-serialized body is not accepted');
    assert.equal(received.length, 0);
    const ok = await post({ 'x-hub-signature-256': sig });
    assert.equal(ok.status, 200);
    assert.equal(received.length, 1);
    assert.equal(received[0].entry[0].changes[0].value.leadgen_id, '333');
  } finally { importer.enqueue = enqueue; await s.close(); restore(); }
});

// ---------- 2. Lead Ads import ----------
test('a Lead Ads lead is fetched once, saved once with its source, and a new form on a connected page is accepted', async () => {
  const restore = saveEnv();
  const { db, close } = await openDatabase();
  const importer = require('../metaLeadImport'), meta = require('../metaConnection'), forms = require('../metaLeadForms');
  const concierge = require('../leadConcierge');
  const original = { graph: meta.graph, pageAccess: forms.pageAccess, onNewLead: concierge.onNewLead };
  try {
    process.env.META_APP_ID = '7001';
    const client = (await db.query("INSERT INTO clients(phone) VALUES('972500000951') RETURNING id,meta_generation")).rows[0];
    await db.query("INSERT INTO meta_lead_sources(form_id,page_id,client_id,meta_generation,app_id) VALUES('5001','4001',$1,$2,'7001')", [client.id, client.meta_generation]);
    forms.pageAccess = async () => ({ token: 'page-token', connection: client });
    const alerted = []; concierge.onNewLead = async (clientId, lead) => { alerted.push(lead.id); };
    const requests = [];
    meta.graph = async (path, token, params) => {
      requests.push({ path, token, fields: params.fields });
      return { id: path.slice(1), form_id: path === '/6002' ? '5002' : '5001', created_time: '2026-11-21T08:00:00+0000', ad_id: '8001', ad_name: 'מודעה א', adset_id: '8101', adset_name: 'תל אביב', campaign_id: '8201', campaign_name: 'דירות 4 חדרים', is_organic: false, platform: 'fb',
        field_data: [{ name: 'full_name', values: ['דנה כהן'] }, { name: 'phone_number', values: ['+972521234567'] }, { name: 'email', values: ['dana@example.test'] }] };
    };
    const event = (leadId, formId) => ({ object: 'page', entry: [{ id: '4001', changes: [{ field: 'leadgen', value: { page_id: '4001', form_id: formId, leadgen_id: leadId, ad_id: '8001', adgroup_id: '8101' } }] }] });
    // Meta retries deliveries for up to 36 hours: the same leadgen_id arrives three times.
    await importer.enqueue(event('6001', '5001')); await importer.enqueue(event('6001', '5001'));
    await importer.runOne(); await importer.runOne();
    await importer.enqueue(event('6001', '5001')); await importer.runOne();
    let leads = (await db.query("SELECT * FROM crm_leads WHERE client_id=$1 AND source='meta_lead_ads'", [client.id])).rows;
    assert.equal(leads.length, 1);
    assert.equal(requests.filter((r) => r.path === '/6001').length, 1, 'the lead is read from Graph once');
    assert.equal(requests[0].token, 'page-token');
    assert.match(requests[0].fields, /campaign_id/); assert.match(requests[0].fields, /ad_id/); assert.match(requests[0].fields, /field_data/);
    const lead = leads[0];
    assert.equal(lead.source_event_id, '6001'); assert.equal(lead.name, 'דנה כהן'); assert.equal(lead.campaign_id, '8201'); assert.equal(lead.ad_id, '8001');
    assert.deepEqual({ page: lead.source_detail.pageId, form: lead.source_detail.formId, ad: lead.source_detail.adId, adset: lead.source_detail.adsetId, campaign: lead.source_detail.campaignName },
      { page: '4001', form: '5001', ad: '8001', adset: '8101', campaign: 'דירות 4 חדרים' });
    assert.deepEqual(alerted, [lead.id], 'the lead enters the concierge once');

    // A form made in Ads Manager on the same connected Page: registered to this business.
    await importer.enqueue(event('6002', '5002')); await importer.runOne();
    leads = (await db.query("SELECT source_event_id FROM crm_leads WHERE client_id=$1 AND source='meta_lead_ads' ORDER BY source_event_id", [client.id])).rows;
    assert.deepEqual(leads.map((l) => l.source_event_id), ['6001', '6002']);
    // A page nobody connected is ignored.
    await importer.enqueue({ object: 'page', entry: [{ id: '4999', changes: [{ field: 'leadgen', value: { page_id: '4999', form_id: '5999', leadgen_id: '6999' } }] }] });
    assert.equal((await db.query("SELECT 1 FROM meta_lead_events WHERE lead_id='6999'")).rows.length, 0);
    const st = await importer.status(client.id);
    assert.equal(st.imported, 2); assert.equal(st.forms, 2);
  } finally { Object.assign(meta, { graph: original.graph }); forms.pageAccess = original.pageAccess; concierge.onNewLead = original.onNewLead; await close(); restore(); }
});

test('connecting a form subscribes the Page to leadgen when it is not subscribed yet', async () => {
  const restore = saveEnv();
  const importer = require('../metaLeadImport'), meta = require('../metaConnection');
  const post = axios.post, graph = meta.graph;
  process.env.META_APP_ID = '7001'; process.env.META_APP_SECRET = 's';
  let subscribed = false; const posts = [];
  meta.graph = async () => ({ data: subscribed ? [{ id: '7001', subscribed_fields: ['leadgen'] }] : [] });
  axios.post = async (url, body, opts) => { posts.push({ url, body: body.toString(), auth: opts.headers.Authorization, proof: opts.params.appsecret_proof }); subscribed = true; return { data: { success: true } }; };
  try {
    assert.equal(await importer.pageSubscribed('4001', 'page-token'), false);
    assert.equal(await importer.subscribePage('4001', 'page-token'), true);
    assert.match(posts[0].url, /\/4001\/subscribed_apps$/);
    assert.equal(posts[0].body, 'subscribed_fields=leadgen');
    assert.equal(posts[0].auth, 'Bearer page-token');
    assert.equal(posts[0].proof, crypto.createHmac('sha256', 's').update('page-token').digest('hex'));
    assert.equal(await importer.pageSubscribed('4001', 'page-token'), true);
  } finally { axios.post = post; meta.graph = graph; restore(); }
});

// ---------- 3. Pixel + Conversions API ----------
test('browser pixel and server Lead share one event_id; website events carry url and user agent', () => {
  const capi = require('../metaCrmFeedback');
  const fs = require('node:fs');
  const browser = fs.readFileSync(require('node:path').join(__dirname, '..', 'public', 'landing', 'landing.js'), 'utf8');
  // The page sends eventId to the server and fires fbq Lead with the same eventID.
  assert.match(browser, /eventId: eventId/); assert.match(browser, /fbq\('track', 'Lead', \{\}, \{ eventID: eventId \}\)/);
  const eventId = crypto.randomUUID();
  const user = capi.userData({ email: ' Dana@Example.test ', phone: '052-123-4567', ip: '1.2.3.4', userAgent: 'Mozilla/5.0', fbp: 'fb.1.1700000000000.123' });
  assert.deepEqual(user.em, [crypto.createHash('sha256').update('dana@example.test').digest('hex')]);
  assert.deepEqual(user.ph, [crypto.createHash('sha256').update('972521234567').digest('hex')]);
  assert.equal(user.fbp, 'fb.1.1700000000000.123', 'fbp is never hashed');
  const [web] = JSON.parse(capi.webPayload({ stage: 'LEAD', event_time: new Date(), event_id: eventId, event_source_url: 'https://app.example/p/x', user_data: user }, {}));
  assert.equal(web.event_name, 'Lead'); assert.equal(web.event_id, eventId); assert.equal(web.action_source, 'website'); assert.equal(web.event_source_url, 'https://app.example/p/x');
  // A webhook lead without a browser user agent is not claimed as a website event.
  const [hook] = JSON.parse(capi.webPayload({ stage: 'LEAD', event_time: new Date(), event_id: eventId, user_data: { em: user.em } }, {}));
  assert.equal(hook.action_source, 'system_generated'); assert.equal(hook.event_source_url, undefined);
  const [sale] = JSON.parse(capi.webPayload({ stage: 'PURCHASE', event_time: new Date(), event_id: 'purchase:abc12345', user_data: {} }, { revenue_minor: 250000, currency: 'ILS' }));
  assert.equal(sale.event_name, 'Purchase'); assert.equal(sale.custom_data.value, 2500); assert.equal(sale.custom_data.currency, 'ILS');
  // Conversion Leads (CRM): system_generated, event_source crm, Meta's lead id as raw digits.
  const crm = capi.payload({ stage: 'WON', event_time: new Date(), meta_lead_id: '123456789012345678' }, { revenue_minor: 100, currency: 'ILS' });
  assert.match(crm, /"lead_id":123456789012345678\b/); assert.match(crm, /"action_source":"system_generated"/); assert.match(crm, /"event_source":"crm"/);
});

test('Lead and Purchase are each sent once; Purchase waits for the amount; permanent errors stop with a reason', async () => {
  const restore = saveEnv();
  const { db, close } = await openDatabase();
  const capi = require('../metaCrmFeedback'), meta = require('../metaConnection');
  const post = axios.post, credentials = meta.credentials;
  try {
    process.env.META_APP_SECRET = 's';
    const client = (await db.query("INSERT INTO clients(phone) VALUES('972500000952') RETURNING id")).rows[0];
    await db.query("INSERT INTO business_channels(client_id,pixel_id) VALUES($1,'1234567890')", [client.id]);
    const lead = (await db.query("INSERT INTO crm_leads(id,client_id,name,phone,source,source_event_id,measurement_consent) VALUES($1,$2,'דנה','0521234567','landing:x',$3,true) RETURNING *", [crypto.randomUUID(), client.id, crypto.randomUUID()])).rows[0];
    meta.credentials = async () => ({ token: 'tok', meta_ad_account_id: 'act_1' });
    const sent = [];
    axios.post = async (url, body) => { sent.push({ url, data: JSON.parse(new URLSearchParams(body.toString()).get('data')) }); return { data: { events_received: 1 } }; };
    const eventId = crypto.randomUUID();
    assert.equal(await capi.enqueueWebLead(lead, { eventId, url: 'https://app.example/p/x', userAgent: 'UA', ip: '1.1.1.1' }), true);
    assert.equal(await capi.enqueueWebLead(lead, { eventId, url: 'https://app.example/p/x', userAgent: 'UA' }), false, 'queued once');
    await capi.runWebDue(); await capi.runWebDue();
    assert.equal(sent.length, 1); assert.match(sent[0].url, /\/1234567890\/events$/); assert.equal(sent[0].data[0].event_id, eventId);
    // Deal closed without an amount: Purchase waits, it is never sent with value 0.
    const won = { ...lead, status: 'WON' };
    await db.transaction((tx) => capi.enqueueWebPurchase(tx, won));
    await db.query("UPDATE meta_capi_events SET available_at=NOW() WHERE stage='PURCHASE' AND lead_id=$1", [lead.id]);
    await capi.runWebDue();
    let row = (await db.query("SELECT status,reason,attempts FROM meta_capi_events WHERE stage='PURCHASE' AND lead_id=$1", [lead.id])).rows[0];
    assert.deepEqual(row, { status: 'PENDING', reason: 'WAITING_FOR_SALE_AMOUNT', attempts: 0 });
    assert.equal(sent.length, 1);
    await db.query("UPDATE crm_leads SET revenue_minor=180000,currency='ILS' WHERE id=$1", [lead.id]);
    await db.query("UPDATE meta_capi_events SET available_at=NOW() WHERE stage='PURCHASE' AND lead_id=$1", [lead.id]);
    await capi.runWebDue(); await capi.runWebDue();
    assert.equal(sent.length, 2);
    assert.equal(sent[1].data[0].event_name, 'Purchase'); assert.equal(sent[1].data[0].custom_data.value, 1800); assert.equal(sent[1].data[0].event_id, 'purchase:' + lead.id);
    // Second business lead: Meta answers 400 (invalid parameter) -> FAILED at once, with the code.
    const lead2 = (await db.query("INSERT INTO crm_leads(id,client_id,name,phone,source,source_event_id,measurement_consent) VALUES($1,$2,'רון','0521234568','landing:x',$3,true) RETURNING *", [crypto.randomUUID(), client.id, crypto.randomUUID()])).rows[0];
    await capi.enqueueWebLead(lead2, { eventId: crypto.randomUUID(), url: 'https://app.example/p/x', userAgent: 'UA' });
    axios.post = async () => { const e = Error('Request failed'); e.response = { status: 400, data: { error: { code: 100 } } }; throw e; };
    await capi.runWebDue();
    row = (await db.query("SELECT status,reason FROM meta_capi_events WHERE lead_id=$1", [lead2.id])).rows[0];
    assert.deepEqual(row, { status: 'FAILED', reason: 'META_ERROR_100' });
    assert.deepEqual(capi.failure({ response: { status: 400, data: { error: { code: 613 } } } }), { reason: 'META_TEMPORARY_613', permanent: false });
    assert.deepEqual(capi.failure({}), { reason: 'META_NO_ANSWER', permanent: false });
    const st = await capi.status(client.id);
    assert.equal(st.website.sent, 2); assert.equal(st.website.failed, 1); assert.equal(st.website.lastFailure, 'META_ERROR_100');
  } finally { axios.post = post; meta.credentials = credentials; await close(); restore(); }
});

// ---------- 4. Real campaign creation: PAUSED, HOUSING ----------
const bundlePlan = (over = {}) => ({ id: crypto.randomUUID(), intent: 'CREATE_BUNDLE', tenantId: '1', target: { accountId: 'act_900' }, parameters: {
  name: 'דירות בתל אביב', objective: 'OUTCOME_LEADS', specialAdCategories: ['HOUSING'], dailyBudget: 50, dailyBudgetMinor: 5000, currency: 'ILS', pageId: '4001', instagramUserId: '17841400000000001',
  link: 'https://business.example', message: 'דירת 4 חדרים', headline: 'דירה חדשה', imageHash: 'hash1', formId: '5001', variants: [{ headline: 'שנייה', message: 'אחרת' }],
  adSets: [{ name: 'תל אביב', dailyBudget: 50, dailyBudgetMinor: 5000, currency: 'ILS', billingEvent: 'IMPRESSIONS', optimizationGoal: 'LEAD_GENERATION', promotedObject: { page_id: '4001' },
    targeting: { geo_locations: { countries: ['IL'] }, age_min: 25 }, startTime: '2026-12-01T09:00:00Z' }], ...over } });

test('the real adapter creates campaign, ad sets, creatives and ads all PAUSED, with HOUSING and the current required fields', async () => {
  const restore = saveEnv();
  const write = require('../metaWrite'), meta = require('../metaConnection'), execution = require('../metaExecution'), forms = require('../metaLeadForms');
  const saved = { graph: meta.graph, permit: execution.assertPermit, inspect: forms.inspect, post: axios.post };
  process.env.META_WRITES_ENABLED = 'true'; process.env.READ_ONLY = 'false'; process.env.META_APP_SECRET = 's';
  const plan = bundlePlan();
  execution.assertPermit = () => ({ clientId: '1', token: 'user-token', plan });
  forms.inspect = async () => ({ form: { id: '5001' } });
  meta.graph = async (path) => (path === '/me/accounts' ? { data: [{ id: '4001' }] } : { id: path.slice(1), account_id: '900' });
  const calls = []; let n = 100;
  axios.post = async (url, body) => { const p = Object.fromEntries(new URLSearchParams(body.toString())); calls.push({ path: new URL(url).pathname.replace(/^\/v\d+\.\d+/, ''), p }); return { data: { id: String(n++) } }; };
  try {
    const out = await write.createBundle(plan);
    const of = (suffix) => calls.filter((c) => c.path.endsWith(suffix));
    assert.equal(of('/campaigns').length, 1); assert.equal(of('/adsets').length, 1); assert.equal(of('/adcreatives').length, 2); assert.equal(of('/ads').length, 2);
    for (const c of [...of('/campaigns'), ...of('/adsets'), ...of('/ads')]) assert.equal(c.p.status, 'PAUSED', c.path + ' must be PAUSED');
    assert.ok(!calls.some((c) => c.p.status === 'ACTIVE'), 'nothing is activated');
    const camp = of('/campaigns')[0].p;
    assert.deepEqual(JSON.parse(camp.special_ad_categories), ['HOUSING']);
    assert.deepEqual(JSON.parse(camp.special_ad_category_country), ['IL']);
    assert.equal(camp.is_adset_budget_sharing_enabled, 'false');
    assert.equal(camp.objective, 'OUTCOME_LEADS');
    const set = of('/adsets')[0].p;
    assert.equal(set.destination_type, 'ON_AD'); assert.equal(set.optimization_goal, 'LEAD_GENERATION'); assert.equal(set.daily_budget, '5000');
    assert.deepEqual(JSON.parse(set.promoted_object), { page_id: '4001' });
    assert.equal(JSON.parse(set.targeting).targeting_automation.advantage_audience, 0);
    const creative = JSON.parse(of('/adcreatives')[0].p.object_story_spec);
    assert.equal(creative.link_data.link, 'https://fb.me/'); assert.equal(creative.link_data.call_to_action.value.lead_gen_form_id, '5001');
    assert.equal(creative.instagram_user_id, '17841400000000001'); assert.equal(creative.instagram_actor_id, undefined);
    assert.equal(out.objects.adIds.length, 2);
  } finally { Object.assign(meta, { graph: saved.graph }); execution.assertPermit = saved.permit; forms.inspect = saved.inspect; axios.post = saved.post; restore(); }
});

test('writes are refused unless META_WRITES_ENABLED=true and READ_ONLY=false; mocks refuse production', async () => {
  const restore = saveEnv();
  try {
    process.env.META_WRITES_ENABLED = 'false'; process.env.READ_ONLY = 'false';
    await assert.rejects(require('../metaWrite').createCampaign(bundlePlan()), /TENANT_WRITES_DISABLED/);
    process.env.META_WRITES_ENABLED = 'true'; process.env.READ_ONLY = 'true';
    await assert.rejects(require('../metaWrite').createCampaign(bundlePlan()), /READ_ONLY_BLOCK/);
    process.env.NODE_ENV = 'production';
    assert.throws(() => require('../mockMetaAdapter').createMockMetaAdapter(), /MOCK_META_FORBIDDEN_IN_PRODUCTION/);
    assert.throws(() => require('../durableMockMetaAdapter').createDurableMockMetaAdapter(1, 'x'), /MOCK_META_FORBIDDEN_IN_PRODUCTION/);
    process.env.MOCK_META_ENABLED = 'true';
    assert.throws(() => require('../runtimeConfig').validateRuntime(), /MISSING_CONFIGURATION|UNSAFE_PRODUCTION_MODE/);
  } finally { restore(); }
});

test('a real-estate business always declares HOUSING; restricted countries get the housing audience rules', async () => {
  const policy = require('../approvalPolicy'), verticals = require('../verticalProfiles');
  const detect = verticals.detect;
  try {
    verticals.detect = async () => ({ key: 'real_estate', known: true });
    const plan = bundlePlan({ specialAdCategories: [] });
    await policy.applySpecialAdCategories(1, plan);
    assert.deepEqual(plan.parameters.specialAdCategories, ['HOUSING']);
    assert.equal(plan.parameters.adSets[0].targeting.age_min, 25, 'Israel-only audience keeps the approved ages');
    const abroad = bundlePlan({ specialAdCategories: ['NONE'] });
    abroad.parameters.adSets[0].targeting = { geo_locations: { countries: ['US'], cities: [{ key: '1', radius: 5, distance_unit: 'kilometer' }] }, age_min: 30, genders: [2] };
    await policy.applySpecialAdCategories(1, abroad);
    assert.deepEqual(abroad.parameters.specialAdCategories, ['HOUSING']);
    const t = abroad.parameters.adSets[0].targeting;
    assert.equal(t.age_min, 18); assert.equal(t.age_max, 65); assert.equal(t.genders, undefined); assert.equal(t.geo_locations.cities[0].radius, 15);
    assert.deepEqual(require('../metaWrite').campaignBody(abroad).special_ad_category_country, ['US']);
    verticals.detect = async () => ({ key: 'services', known: true });
    const other = bundlePlan({ specialAdCategories: [] });
    await policy.applySpecialAdCategories(1, other);
    assert.deepEqual(other.parameters.specialAdCategories, []);
    assert.equal(require('../metaWrite').campaignBody(other).special_ad_category_country, undefined);
  } finally { verticals.detect = detect; }
});

// ---------- 5. Measurement ----------
test('Insights rows map to spend/impressions/clicks/leads/CPL without double-counting leads', () => {
  const { summarize, leadsOf } = require('../metaInsights');
  const row = { campaign_id: '8201', campaign_name: 'דירות', account_currency: 'ILS', spend: '300.50', impressions: '12000', clicks: '240', reach: '9000',
    actions: [{ action_type: 'onsite_conversion.lead_grouped', value: '10' }, { action_type: 'lead', value: '12' }, { action_type: 'link_click', value: '240' }] };
  assert.equal(leadsOf(row), 12, '"lead" (all leads) wins; types are never added together');
  assert.equal(leadsOf({ actions: [{ action_type: 'offsite_conversion.fb_pixel_lead', value: '3' }] }), 3);
  const s = summarize([row, { campaign_id: '8202', campaign_name: 'ב', spend: '99.5', impressions: '1000', clicks: '10', actions: [] }, { campaign_id: 'bad', spend: '1000' }]);
  assert.equal(s.currency, 'ILS');
  assert.deepEqual(s.totals, { spend: 400, impressions: 13000, clicks: 250, leads: 12, ctr: 250 / 13000, costPerLead: 33.33 });
  assert.equal(s.campaigns[0].costPerLead, 25.04); assert.equal(s.campaigns[1].costPerLead, null);
});

test('Insights are read with unified attribution, cached, and last_insights_sync is recorded', async () => {
  const restore = saveEnv();
  const { db, close } = await openDatabase();
  const insights = require('../metaInsights'), meta = require('../metaConnection');
  const saved = { credentials: meta.credentials, tenantRead: meta.tenantRead, graph: meta.graph };
  try {
    const client = (await db.query("INSERT INTO clients(phone) VALUES('972500000953') RETURNING id")).rows[0];
    meta.credentials = async () => ({ token: 't', meta_ad_account_id: 'act_953' });
    meta.graph = async () => ({ currency: 'USD' });
    const reads = [];
    meta.tenantRead = async (path, params) => { reads.push({ path, params }); return { data: [{ campaign_id: '1', campaign_name: 'א', spend: '10', impressions: '100', clicks: '5', actions: [{ action_type: 'lead', value: '2' }] }] }; };
    assert.equal(await insights.lastSync(client.id), null);
    const first = await insights.accountInsights(client.id, 'last_7d');
    assert.equal(first.cached, false); assert.equal(first.currency, 'USD', 'falls back to the account currency');
    assert.equal(first.totals.spend, 10); assert.equal(first.totals.costPerLead, 5);
    assert.equal(reads[0].path, '/act_953/insights'); assert.equal(reads[0].params.use_unified_attribution_setting, true);
    assert.equal(reads[0].params.date_preset, 'last_7d'); assert.equal(reads[0].params.level, 'campaign');
    assert.ok(!/7d_view|28d_view/.test(JSON.stringify(reads[0].params)), 'no removed attribution windows');
    const second = await insights.accountInsights(client.id, 'last_7d');
    assert.equal(second.cached, true); assert.equal(reads.length, 1);
    assert.ok(await insights.lastSync(client.id));
    await insights.accountInsights(client.id, 'last_7d', { force: true });
    assert.equal(reads.length, 2);
    // The business report takes spend from Insights and revenue from the CRM.
    const report = await require('../businessReport').build(client.id, 'last_7d');
    assert.equal(report.spend, 10); assert.equal(report.currency, 'USD'); assert.equal(report.ads.leads, 2);
    assert.equal(report.metrics.revenuePerShekel, null, 'USD spend is never mixed with ILS revenue');
  } finally { Object.assign(meta, saved); await close(); restore(); }
});
