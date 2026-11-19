'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const axios = require('axios');
const { openDatabase } = require('./helpers/isolatedDatabase');
const buyers = require('../buyerAudiences');
const { createActionPlan, formatActionPlan } = require('../actionPlan');
const { strictPlan } = require('../approvalPolicy');

test('phones are normalized to E.164 digits and hashed exactly as Meta requires', () => {
  assert.equal(buyers.normalizePhone('050-123-4567'), '972501234567');
  assert.equal(buyers.normalizePhone('+972 50 123 4567'), '972501234567');
  assert.equal(buyers.normalizePhone('00972501234567'), '972501234567');
  assert.equal(buyers.normalizePhone('9720501234567'), '972501234567');
  assert.equal(buyers.normalizePhone('+1 (555) 987-6543'), '15559876543');
  assert.equal(buyers.normalizePhone('12'), null);
  assert.equal(buyers.normalizePhone(null), null);
  // Meta's own documented example: sha256("15559876543"), lowercase hex.
  assert.equal(buyers.hashPhone('15559876543'), '1ef970831d7963307784fa8688e8fce101a15685d62aa765fed23f3a2c576a4e');
});

test('audience plans are strictly validated and the approval card says what happens', () => {
  const sync = createActionPlan({ intent: 'SYNC_BUYER_AUDIENCE', summary: 's', target: { accountId: 'act_6001' }, parameters: { name: buyers.AUDIENCE_NAME, snapshotId: crypto.randomUUID(), digest: 'a'.repeat(64), buyerCount: 12 } });
  assert.equal(sync.requiresApproval, true);
  strictPlan(sync);
  assert.throws(() => strictPlan({ ...sync, parameters: { ...sync.parameters, digest: 'x' } }), /INVALID_BUYER_AUDIENCE/);
  assert.throws(() => strictPlan({ ...sync, parameters: { ...sync.parameters, phones: ['0501234567'] } }), /UNSUPPORTED/);
  const card = formatActionPlan(sync);
  assert.match(card, /12 לקוחות/); assert.match(card, /SHA-256/); assert.match(card, /לא נפרסם למי שכבר קנה/); assert.match(card, /אין פרסום ואין חיוב/);
  const look = createActionPlan({ intent: 'CREATE_LOOKALIKE', summary: 'l', target: { accountId: 'act_6001' }, parameters: { name: buyers.LOOKALIKE_NAME, originAudienceId: '777' } });
  strictPlan(look);
  assert.throws(() => strictPlan({ ...look, parameters: { ...look.parameters, originAudienceId: 'abc' } }), /INVALID_LOOKALIKE/);
  assert.match(formatActionPlan(look), /Lookalike/);
  // The audience intents stay out of the AI planners' intent list.
  assert.ok(!require('../actionPlan').WRITE_INTENTS.has('SYNC_BUYER_AUDIENCE'));
  const write = require('../metaWrite');
  assert.deepEqual(write.lookalikeSpec('v26.0'), { ratio: 0.01, country: 'IL' });
  assert.deepEqual(write.lookalikeSpec('v27.0'), { ratio: 0.01 });
});

test('the feature is off unless BUYER_AUDIENCES_ENABLED is true', async () => {
  delete process.env.BUYER_AUDIENCES_ENABLED;
  assert.equal(await buyers.handleText('972500000601', 'קהל לקוחות'), false);
  const plan = { intent: 'CREATE_ADSET', parameters: { targeting: { geo_locations: { countries: ['IL'] } } } };
  assert.equal(await buyers.applyExclusion(1, plan, 'act_6001'), false);
  assert.equal(plan.parameters.targeting.excluded_custom_audiences, undefined);
  assert.deepEqual(await buyers.runDue(), { status: 'DISABLED' });
});

test('buyers audience: approval-gated create, hashed upload only, exclusion, lookalike and weekly offer', async () => {
  const env = { ...process.env }, get = axios.get, post = axios.post;
  Object.assign(process.env, { META_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'), APPROVAL_HMAC_KEY: crypto.randomBytes(32).toString('hex'), META_APP_ID: '123', META_APP_SECRET: 'test-secret', META_LOGIN_CONFIG_ID: '456', APP_PUBLIC_URL: 'https://campaign.example', META_WRITES_ENABLED: 'true', READ_ONLY: 'false', BUYER_AUDIENCES_ENABLED: 'true', META_GRAPH_VERSION: 'v27.0' });
  const { db, close } = await openDatabase();
  const meta = require('../metaConnection'), crm = require('../crmService'), PHONE = '972500000602', ACCOUNT = 'act_6002';
  const tos = { accepted: false }, posts = [], audiences = {};
  let size = 40;
  axios.get = async (url, options) => {
    const fields = options?.params?.fields || '';
    if (url.endsWith('/me/permissions')) return { data: { data: [{ permission: 'ads_management', status: 'granted' }] } };
    if (url.endsWith('/' + ACCOUNT)) return { data: fields === 'tos_accepted' ? (tos.accepted ? { tos_accepted: { custom_audience_tos: 1 } } : { id: ACCOUNT }) : { id: ACCOUNT, name: 'Buyers test', currency: 'ILS', timezone_name: 'Asia/Jerusalem' } };
    const id = /\/(\d+)$/.exec(url)?.[1];
    if (id && audiences[id]) return { data: { id, account_id: '6002', ...audiences[id], approximate_count_lower_bound: size } };
    throw Error('Unexpected GET ' + url);
  };
  axios.post = async (url, body) => {
    const data = Object.fromEntries(body.entries());
    posts.push({ url, data });
    if (url.endsWith('/' + ACCOUNT + '/customaudiences')) {
      if (!tos.accepted) throw Object.assign(Error('rejected'), { response: { status: 400, data: { error: { code: 200, error_subcode: 1870090 } } } });
      const id = String(9000 + Object.keys(audiences).length);
      audiences[id] = { name: data.name, subtype: data.subtype };
      return { data: { id } };
    }
    if (/\/\d+\/users(replace)?$/.test(url)) return { data: { num_received: JSON.parse(data.payload).data.length, num_invalid_entries: 0 } };
    throw Error('Unexpected POST ' + url);
  };
  const inbound = (id, work) => meta.context.run(String(id), () => require('../whatsappDelivery').messageContext.run({ eventId: 'buyers-test-' + Math.random(), sequence: 0 }, work));
  const outbox = async (id) => (await db.query("SELECT payload FROM whatsapp_outbox WHERE client_id=$1", [id])).rows.map((r) => JSON.stringify(r.payload));
  const seen = async (id, re) => assert.ok((await outbox(id)).some((m) => re.test(m)), "no message matching " + re);
  const clearUi = (id) => require('../marketingStore').update(id, null, (p) => { delete p.ui; return { handled: false, changed: true }; });
  const approveAndRun = async (id, approval) => meta.context.run(String(id), async () => {
    const consumed = await require('../approvalEngine').consumeActionForClient(id, approval.actionId);
    assert.equal(consumed.ok, true, JSON.stringify(consumed));
    return require('../actionExecutor').executeApprovedForClient(id, consumed.approval.actionPlan);
  });
  try {
    const id = (await db.query('INSERT INTO clients(phone,meta_ad_account_id) VALUES($1,$2) RETURNING id', [PHONE, ACCOUNT])).rows[0].id;
    await db.query("INSERT INTO meta_connections(client_id,meta_user_id,token_ciphertext,app_id,expires_at) VALUES($1,'60201',$2,'123',NOW()+INTERVAL '1 hour')", [id, meta.encrypt('buyers-token', id)]);
    await db.query('INSERT INTO whatsapp_contacts(phone,last_inbound_at) VALUES($1,NOW()) ON CONFLICT (phone) DO UPDATE SET last_inbound_at=NOW()', [PHONE]);
    for (const [name, phone, status] of [['דנה', '050-111-2233', 'WON'], ['יוסי', '+972 52 444 5566', 'WON'], ['רוני', '0501112233', 'WON'], ['שקד', '0539998877', 'NEW']]) {
      const lead = await crm.create(id, { name, phone });
      if (status === 'WON') await crm.update(id, lead.id, { status: 'WON', version: lead.version });
    }
    const expected = [buyers.hashPhone('972501112233'), buyers.hashPhone('972524445566')].sort();
    assert.deepEqual(await buyers.buyerHashes(id), expected, 'duplicates collapse, only WON leads count');

    // Status in WhatsApp, then terms not accepted: a clear instruction with the link, nothing sent to Meta.
    assert.equal(await inbound(id, () => buyers.handleText(PHONE, 'קהל לקוחות')), true);
    await seen(id, /2 לקוחות שסגרו עסקה/); await seen(id, /עדיין לא נוצר/); await seen(id, /ליצור קהל לקוחות/);
    await clearUi(id);
    await inbound(id, () => buyers.handleText(PHONE, '/buyers-sync'));
    await seen(id, /customaudiences\/tos\/\?act=6002/);
    assert.equal(posts.length, 0);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM action_plans WHERE client_id=$1', [id])).rows[0].n, 0);

    // Accepted: the owner gets an approval card; nothing is written before approval.
    tos.accepted = true;
    const prepared = await inbound(id, () => buyers.prepareSync(id));
    assert.ok(prepared.approval);
    assert.equal(posts.length, 0, 'no Meta write before approval');
    assert.match(formatActionPlan(prepared.approval.actionPlan), /2 לקוחות/);
    const done = await approveAndRun(id, prepared.approval);
    assert.equal(done.ok, true, JSON.stringify(done));
    assert.equal(posts[0].data.subtype, 'CUSTOM'); assert.equal(posts[0].data.customer_file_source, 'USER_PROVIDED_ONLY'); assert.equal(posts[0].data.name, buyers.AUDIENCE_NAME);
    const upload = posts.find((p) => p.url.endsWith('/users'));
    const payload = JSON.parse(upload.data.payload), session = JSON.parse(upload.data.session);
    assert.equal(payload.schema, 'PHONE_SHA256');
    assert.deepEqual(payload.data, expected.map((h) => [h]));
    assert.equal(session.batch_seq, 1); assert.equal(session.last_batch_flag, true);
    assert.ok(!posts.some((p) => /0501112233|972501112233|524445566|דנה|יוסי/.test(JSON.stringify(p.data))), 'no raw phone or name leaves the system');
    const state = await buyers.current(id, ACCOUNT);
    assert.equal(state.audienceId, '9000'); assert.equal(state.buyerCount, 2);

    // Same buyers: nothing to refresh. A new buyer: refresh replaces the list on the same audience.
    assert.equal((await inbound(id, () => buyers.prepareSync(id))).reason, 'UP_TO_DATE');
    const later = await crm.create(id, { name: 'מיה', phone: '054-777-1122' });
    await crm.update(id, later.id, { status: 'WON', version: later.version });
    const refresh = await inbound(id, () => buyers.prepareSync(id));
    assert.equal(refresh.approval.actionPlan.parameters.audienceId, '9000');
    assert.equal((await approveAndRun(id, refresh.approval)).ok, true);
    const replaced = posts.find((p) => p.url.endsWith('/9000/usersreplace'));
    assert.equal(JSON.parse(replaced.data.payload).data.length, 3);
    assert.equal(posts.filter((p) => p.url.endsWith('/customaudiences')).length, 1, 'no second audience');

    // A tampered snapshot is never uploaded.
    const third = await crm.create(id, { name: 'טל', phone: '054-777-3344' });
    await crm.update(id, third.id, { status: 'WON', version: third.version });
    const tampered = await inbound(id, () => buyers.prepareSync(id));
    await db.query("UPDATE buyer_audience_snapshots SET hashes=array_append(hashes,$2) WHERE id=$1", [tampered.approval.actionPlan.parameters.snapshotId, 'b'.repeat(64)]);
    const before = posts.length;
    assert.equal((await approveAndRun(id, tampered.approval)).ok, false);
    assert.equal(posts.length, before);

    // Exclusion: new ad sets skip people who already bought, and the card says so.
    const bundle = createActionPlan({ intent: 'CREATE_BUNDLE', summary: 'b', target: { accountId: ACCOUNT }, parameters: { adSets: [{ targeting: { geo_locations: { countries: ['IL'] } } }, { targeting: { geo_locations: { countries: ['IL'] }, excluded_custom_audiences: [{ id: '9000' }] } }] } });
    assert.equal(await buyers.applyExclusion(id, bundle, ACCOUNT), true);
    assert.deepEqual(bundle.parameters.adSets.map((s) => s.targeting.excluded_custom_audiences), [[{ id: '9000' }], [{ id: '9000' }]]);
    assert.match(formatActionPlan(bundle), /לא נפרסם למי שכבר קנה/);

    // Lookalike only once Meta matched at least 100 people.
    assert.equal((await inbound(id, () => buyers.prepareLookalike(id))).reason, 'TOO_SMALL');
    size = 150;
    await clearUi(id);
    await inbound(id, () => buyers.handleText(PHONE, 'קהל לקוחות'));
    await seen(id, /ליצור קהל דומה 1%/);
    const look = await inbound(id, () => buyers.prepareLookalike(id));
    assert.equal((await approveAndRun(id, look.approval)).ok, true);
    const created = posts.filter((p) => p.url.endsWith('/customaudiences')).at(-1).data;
    assert.equal(created.subtype, 'LOOKALIKE'); assert.equal(created.origin_audience_id, '9000');
    assert.deepEqual(JSON.parse(created.lookalike_spec), { ratio: 0.01 });
    assert.equal((await inbound(id, () => buyers.prepareLookalike(id))).reason, 'LOOKALIKE_EXISTS');
    assert.equal(await buyers.ownsApproval(id, look.approval.actionId), true);

    // Weekly check: proposes (message with buttons, no approval, no Meta write), at most once a week.
    await clearUi(id);
    const writes = posts.length, plans = (await db.query('SELECT COUNT(*)::int n FROM action_plans WHERE client_id=$1', [id])).rows[0].n;
    const week = await buyers.runDue({ onlyClientIds: [id] });
    assert.deepEqual(week.results, ['OFFERED']);
    await seen(id, /העדכון השבועי/);
    assert.deepEqual((await buyers.runDue({ onlyClientIds: [id] })).results, [], 'not again this week');
    assert.equal(posts.length, writes);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM action_plans WHERE client_id=$1', [id])).rows[0].n, plans);
  } finally {
    axios.get = get; axios.post = post;
    for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
    Object.assign(process.env, env);
    await close();
  }
});

test('terms refused at execution time block the action with the Hebrew instruction', async () => {
  const env = { ...process.env }, get = axios.get, post = axios.post;
  Object.assign(process.env, { META_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'), APPROVAL_HMAC_KEY: crypto.randomBytes(32).toString('hex'), META_APP_ID: '123', META_APP_SECRET: 'test-secret', META_LOGIN_CONFIG_ID: '456', APP_PUBLIC_URL: 'https://campaign.example', META_WRITES_ENABLED: 'true', READ_ONLY: 'false', BUYER_AUDIENCES_ENABLED: 'true' });
  const { db, close } = await openDatabase();
  const meta = require('../metaConnection'), ACCOUNT = 'act_6003';
  axios.get = async (url, options) => {
    if (url.endsWith('/me/permissions')) return { data: { data: [{ permission: 'ads_management', status: 'granted' }] } };
    if (url.endsWith('/' + ACCOUNT)) return { data: options?.params?.fields === 'tos_accepted' ? { tos_accepted: { custom_audience_tos: 1 } } : { id: ACCOUNT, name: 'A', currency: 'ILS', timezone_name: 'Asia/Jerusalem' } };
    throw Error('Unexpected GET ' + url);
  };
  axios.post = async () => { throw Object.assign(Error('rejected'), { response: { status: 400, data: { error: { code: 200, error_subcode: 1870090 } } } }); };
  try {
    const id = (await db.query("INSERT INTO clients(phone,meta_ad_account_id) VALUES('972500000603',$1) RETURNING id", [ACCOUNT])).rows[0].id;
    await db.query("INSERT INTO meta_connections(client_id,meta_user_id,token_ciphertext,app_id,expires_at) VALUES($1,'60301',$2,'123',NOW()+INTERVAL '1 hour')", [id, meta.encrypt('t', id)]);
    const lead = await require('../crmService').create(id, { name: 'דנה', phone: '0501231234' });
    await require('../crmService').update(id, lead.id, { status: 'WON', version: lead.version });
    const { approval } = await buyers.prepareSync(id);
    const result = await meta.context.run(String(id), async () => {
      const consumed = await require('../approvalEngine').consumeActionForClient(id, approval.actionId);
      return require('../actionExecutor').executeApprovedForClient(id, consumed.approval.actionPlan);
    });
    assert.equal(result.reason, 'CUSTOM_AUDIENCE_TOS_REQUIRED');
    assert.match(result.message, /customaudiences\/tos\/\?act=6003/);
    assert.equal((await db.query('SELECT status FROM action_plans WHERE id=$1', [approval.actionId])).rows[0].status, 'BLOCKED');
  } finally {
    axios.get = get; axios.post = post;
    for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
    Object.assign(process.env, env);
    await close();
  }
});
