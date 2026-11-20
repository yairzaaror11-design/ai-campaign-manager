'use strict';
// Channels: organic auto-publish (Meta mocked), landing pages per business and item,
// Pixel + Conversions API, and the extra lead sources. Everything is scoped to the
// test's own client ids (unique phones 97250480xxxx); no global counts.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');
const { openDatabase } = require('./helpers/isolatedDatabase');

const env = { ...process.env };
function setEnv(extra = {}) {
  Object.assign(process.env, { APP_PUBLIC_URL: 'https://app.example.test', META_APP_ID: '123', META_APP_SECRET: 'test-secret', META_LOGIN_CONFIG_ID: '456',
    META_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'), SOCIAL_FACEBOOK_CLIENT_ID: 'fb-app', SOCIAL_FACEBOOK_CLIENT_SECRET: 'fb-secret',
    SOCIAL_INSTAGRAM_CLIENT_ID: 'fb-app', SOCIAL_INSTAGRAM_CLIENT_SECRET: 'fb-secret', WHATSAPP_SEND_ENABLED: 'false', LEAD_ALERTS_ENABLED: 'false', ...extra });
}
function restoreEnv() { for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k]; Object.assign(process.env, env); }
const SUNDAY = new Date('2026-11-22T08:00:00Z'); // 10:00 in Israel
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);

async function client(db, phone) { return (await db.query('INSERT INTO clients(phone) VALUES($1) RETURNING id', [phone])).rows[0].id; }
async function agree(clientId, allow) {
  const authority = require('../scopedAuthority');
  return authority.withWhatsAppOwner(clientId, () => authority.setAgreement(clientId, { monthlyCeiling: 3000, maxDailyPerCampaign: 200, allow }));
}
async function connect(db, clientId, provider, accountId) {
  const meta = require('../metaConnection');
  await db.query(`INSERT INTO social_connections(client_id,provider,app_id,token_ciphertext,external_id,display_name,expires_at) VALUES($1,$2,'fb-app',$3,$4,'העסק',NOW()+INTERVAL '30 days')
    ON CONFLICT(client_id,provider) DO UPDATE SET token_ciphertext=EXCLUDED.token_ciphertext,external_id=EXCLUDED.external_id`,
  [clientId, provider, meta.encrypt(JSON.stringify({ accessToken: 'user-token-' + provider }), clientId + ':' + provider), accountId]);
}
async function organicPost(db, clientId, { status = 'APPROVED', media = 'AI_GRAPHIC', format = 'POST', caption = 'פוסט חם ואישי על העסק שלנו עם קריאה לשלוח הודעה #עסק' } = {}) {
  await db.query("INSERT INTO organic_plans(client_id,starts_on,ends_on) VALUES($1,'2026-11-01','2027-02-01') ON CONFLICT DO NOTHING", [clientId]);
  const id = crypto.randomUUID();
  await db.query('INSERT INTO organic_posts(id,client_id,publish_on,format,media,purpose,topic,caption,visual,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [id, clientId, '2026-11-22', format, media, 'טיפ מקצועי', 'טיפ על השירות', caption, 'תמונה', status]);
  return (await db.query('SELECT * FROM organic_posts WHERE id=$1', [id])).rows[0];
}
// Meta Graph mock: permissions per token, Page token, photo/feed/IG container/publish.
function fakeGraph({ permissions = ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement', 'instagram_basic', 'instagram_content_publish'], failInstagramPublish = false } = {}) {
  const calls = [];
  axios.get = async (url, opts) => {
    calls.push({ method: 'GET', url, params: opts?.params });
    if (url.endsWith('/me/permissions')) return { data: { data: permissions.map((permission) => ({ permission, status: 'granted' })) } };
    if (url.endsWith('/me/accounts')) return { data: { data: [{ id: '111222', access_token: 'page-token' }] } };
    if (/\/7770001$/.test(url) && opts?.params?.fields === 'status_code') return { data: { status_code: 'FINISHED' } };
    if (/\/9990001$/.test(url)) return { data: { permalink: 'https://www.instagram.com/p/ABC123/' } };
    throw Error('unexpected GET ' + url);
  };
  axios.post = async (url, body, opts) => {
    const params = Object.fromEntries(body instanceof URLSearchParams ? body : []);
    calls.push({ method: 'POST', url, params, auth: opts?.headers?.Authorization });
    if (url.endsWith('/111222/photos')) return { data: { id: '5001', post_id: '111222_5002' } };
    if (url.endsWith('/111222/feed')) return { data: { id: '111222_5003' } };
    if (url.endsWith('/333444/media')) return { data: { id: '7770001' } };
    if (url.endsWith('/333444/media_publish')) { if (failInstagramPublish) throw Object.assign(Error('x'), { response: { data: { error: { code: 9004 } } } }); return { data: { id: '9990001' } }; }
    throw Error('unexpected POST ' + url);
  };
  return calls;
}

test('migration 048 is idempotent', async () => {
  const { pg, close } = await openDatabase();
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '048_channels.sql'), 'utf8');
    await pg.exec(sql); await pg.exec(sql);
    const cols = (await pg.query("SELECT column_name FROM information_schema.columns WHERE table_name='crm_leads' AND column_name IN ('ad_id','utm','landing_page_id','measurement_consent')")).rows;
    assert.equal(cols.length, 4);
  } finally { await close(); }
});

test('auto-publish: Facebook photo + Instagram post, recorded with links, never twice; agreement and permissions respected', async () => {
  setEnv({ ORGANIC_AUTOPUBLISH_ENABLED: 'true' });
  const { db, close } = await openDatabase();
  const get = axios.get, post = axios.post;
  try {
    const pub = require('../socialPublisher');
    const id = await client(db, '972504804001');
    await connect(db, id, 'facebook', '111222'); await connect(db, id, 'instagram', '333444');
    const p = await organicPost(db, id);
    const graphic = async () => ({ buffer: JPEG, mimeType: 'image/jpeg' });

    // No work agreement: nothing is published, nothing is called.
    let calls = fakeGraph();
    assert.equal((await pub.publishPost(p, { graphic })).attempted, false);
    await agree(id, { organicPosts: false });
    assert.equal((await pub.publishPost(p, { graphic })).why, 'NOT_ALLOWED');
    assert.equal(calls.length, 0);

    await agree(id, { organicPosts: true });
    const r = await pub.publishPost(p, { graphic, wait: async () => {} });
    assert.equal(r.complete, true);
    const fb = calls.find((c) => c.url.endsWith('/111222/photos'));
    assert.equal(fb.params.message, p.caption); assert.equal(fb.auth, 'Bearer page-token');
    assert.match(fb.params.url, /^https:\/\/app\.example\.test\/m\/[0-9a-f-]{36}$/);
    assert.ok(calls.find((c) => c.url.endsWith('/333444/media')).params.image_url.startsWith('https://app.example.test/m/'));
    const rows = (await db.query('SELECT network,status,external_id,permalink FROM organic_publications WHERE post_id=$1 ORDER BY network', [p.id])).rows;
    assert.deepEqual(rows.map((x) => [x.network, x.status, x.permalink]), [['facebook', 'PUBLISHED', 'https://www.facebook.com/111222_5002'], ['instagram', 'PUBLISHED', 'https://www.instagram.com/p/ABC123/']]);
    assert.match(r.note, /פורסם בפייסבוק: https:\/\/www\.facebook\.com\/111222_5002/);
    // The image Meta downloads is served publicly.
    const mediaId = fb.params.url.split('/').at(-1);
    assert.deepEqual((await pub.media(mediaId)).buffer, JPEG);

    // Idempotent: a second run publishes nothing new.
    const before = calls.filter((c) => c.method === 'POST').length;
    const again = await pub.publishPost(p, { graphic });
    assert.equal(again.complete, true);
    assert.equal(calls.filter((c) => c.method === 'POST').length, before);

    // The dashboard sees "published" with the link.
    const o = await require('../organicContent').overview(id, { now: SUNDAY });
    assert.equal(o.posts.find((x) => x.id === p.id).publications.length, 2);

    // Missing permission: falls back and says why, without publishing.
    const p2 = await organicPost(db, id);
    calls = fakeGraph({ permissions: ['pages_show_list'] });
    const r2 = await pub.publishPost(p2, { graphic });
    assert.equal(r2.complete, false);
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
    assert.match(r2.note, /חסרה הרשאת פרסום/);

    // A PNG image cannot go to Instagram; Facebook still publishes; a Meta error is recorded once.
    const p3 = await organicPost(db, id);
    calls = fakeGraph({ failInstagramPublish: true });
    const r3 = await pub.publishPost(p3, { graphic: async () => ({ buffer: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(100)]), mimeType: 'image/png' }) });
    assert.deepEqual(r3.results.map((x) => [x.network, x.status, x.reason || null]), [['facebook', 'PUBLISHED', null], ['instagram', 'FAILED', 'NEEDS_JPEG']]);
    assert.match(r3.note, /JPEG/);
    // A video post is never auto-published.
    const p4 = await organicPost(db, id, { media: 'AI_VIDEO', format: 'REEL' });
    assert.ok((await pub.publishPost(p4, { graphic })).results.every((x) => x.reason === 'VIDEO_NOT_SUPPORTED'));
  } finally { axios.get = get; axios.post = post; await close(); restoreEnv(); }
});

test('auto-publish inside the daily run: no WhatsApp window needed when everything is published; activity log says so', async () => {
  setEnv({ ORGANIC_AUTOPUBLISH_ENABLED: 'true', GRAPHICS_ENABLED: 'false' });
  const { db, close } = await openDatabase();
  const get = axios.get, post = axios.post;
  try {
    const o = require('../organicContent');
    const id = await client(db, '972504804002');
    await connect(db, id, 'facebook', '111222');
    await agree(id, { organicPosts: true });
    // A post the owner did not review: with the agreement it goes out in the approved style.
    const p = await organicPost(db, id, { status: 'DRAFT', media: 'PHOTO' });
    const calls = fakeGraph();
    const r = await o.runDue({ now: SUNDAY });
    assert.equal(r.status, 'RAN');
    const row = (await db.query('SELECT status,autopublish_checked_at FROM organic_posts WHERE id=$1', [p.id])).rows[0];
    assert.equal(row.status, 'SENT'); assert.ok(row.autopublish_checked_at);
    assert.ok(calls.some((c) => c.url.endsWith('/111222/feed')), 'no image: a text post on the Page');
    assert.equal((await db.query("SELECT status FROM organic_publications WHERE post_id=$1 AND network='facebook'", [p.id])).rows[0].status, 'PUBLISHED');
    const log = await require('../activityLog').list(id);
    assert.ok(log.some((x) => /פרסמתי בעצמי בפייסבוק/.test(x.what)));
    // Without the agreement a draft is not picked up at all.
    const other = await client(db, '972504804003');
    await connect(db, other, 'facebook', '111222');
    const d = await organicPost(db, other, { status: 'DRAFT' });
    await o.runDue({ now: SUNDAY });
    assert.equal((await db.query('SELECT status FROM organic_posts WHERE id=$1', [d.id])).rows[0].status, 'DRAFT');
  } finally { axios.get = get; axios.post = post; await close(); restoreEnv(); }
});

test('landing pages per business and item: agreement decides publishing, form creates a linked lead with UTM, CAPI deduplicated and consent-bound', async () => {
  setEnv({ META_CAPI_ENABLED: 'true' });
  const { db, close } = await openDatabase();
  const get = axios.get, post = axios.post;
  try {
    const lp = require('../landingPages'), catalog = require('../catalog');
    const id = await client(db, '972504804010');
    await db.query("INSERT INTO customer_accounts(client_id,display_name,consent_version) VALUES($1,'דנה','v1')", [id]);
    const item = await catalog.create(id, { title: 'ייעוץ עסקי', price: 350, description: 'פגישת ייעוץ של שעה' }, { vertical: 'services' });
    const active = await catalog.activate(id, item.id).catch(async () => { await db.query("UPDATE catalog_items SET status='ACTIVE' WHERE id=$1", [item.id]); return catalog.get(id, item.id); });

    // No agreement: drafts, and the owner is told why.
    let r = await lp.onItemActive(id, active);
    assert.equal(r.published, false); assert.equal(r.why, 'NO_AGREEMENT');
    assert.match(lp.itemLine(r), /פרסם דף/);
    await assert.rejects(lp.get((await db.query("SELECT slug FROM landing_pages WHERE client_id=$1 AND kind='ITEM'", [id])).rows[0].slug), /LANDING_NOT_FOUND/);
    // The agreement allows publishing content: pages go live by themselves (idempotent, one page each).
    await agree(id, { organicPosts: true });
    r = await lp.onItemActive(id, active);
    assert.equal(r.published, true); assert.match(r.url, /^https:\/\/app\.example\.test\/p\/i[a-z0-9]{10}$/);
    assert.equal(r.business.published, true);
    await lp.onItemActive(id, active);
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM landing_pages WHERE client_id=$1 AND kind IN ('BUSINESS','ITEM')", [id])).rows[0].n, 2);

    const slug = r.url.split('/').at(-1), page = await lp.get(slug);
    await db.query('INSERT INTO business_channels(client_id,pixel_id) VALUES($1,$2)', [id, '123456789012']);
    const html = lp.render(await lp.view(page));
    assert.match(html, /<html lang="he" dir="rtl">/); assert.match(html, /ייעוץ עסקי/); assert.match(html, /<label for="f-phone">/);
    assert.match(html, /href="\/privacy"/); assert.match(html, /data-pixel="123456789012"/); assert.match(html, /class="skip"/);
    assert.match(lp.csp('123'), /connect\.facebook\.net/); assert.doesNotMatch(lp.csp(null), /facebook/);
    const biz = await lp.get(r.business.url.split('/').at(-1));
    assert.match(lp.render(await lp.view(biz)), new RegExp('/p/' + slug));

    // A lead from the item page: linked to the item, campaign and ad from UTM; Lead event queued with the browser's event id.
    const eventId = crypto.randomUUID();
    const lead = await lp.submit(slug, { name: 'יוסי', phone: '050-7654321', email: 'Yossi@Example.com', consent: true, eventId, measurementConsent: true, fbp: 'fb.1.1700000000000.123456',
      utm: { utm_source: 'facebook', utm_campaign: '120200000001', utm_content: '120200000099' }, page: r.url + '?utm_source=facebook' }, { ip: '1.2.3.4', userAgent: 'test' });
    assert.equal(lead.catalog_item_id, item.id); assert.equal(lead.campaign_id, '120200000001'); assert.equal(lead.ad_id, '120200000099');
    assert.equal(lead.landing_page_id, page.id); assert.equal(lead.utm.source, 'facebook'); assert.equal(lead.measurement_consent, true);
    assert.equal((await lp.submit(slug, { name: 'יוסי', phone: '050-7654321', consent: true, eventId })).duplicate, true);
    await assert.rejects(lp.submit(slug, { name: 'x', phone: '0501111111', consent: false, eventId: crypto.randomUUID() }), /INVALID_LEAD_FORM/);
    // Without measurement consent: the lead is saved, nothing goes to Meta.
    const quiet = await lp.submit(slug, { name: 'רותי', phone: '0521112223', consent: true, eventId: crypto.randomUUID(), measurementConsent: false, fbp: 'fb.1.1700000000000.9' });
    assert.equal(quiet.measurement_consent, false); assert.equal(quiet.utm, null);
    const events = (await db.query('SELECT lead_id,stage,event_id,user_data FROM meta_capi_events WHERE client_id=$1', [id])).rows;
    assert.equal(events.length, 1); assert.equal(events[0].event_id, eventId);
    assert.equal(events[0].user_data.em[0], crypto.createHash('sha256').update('yossi@example.com').digest('hex'));
    assert.equal(events[0].user_data.ph[0], crypto.createHash('sha256').update('972507654321').digest('hex'));

    // Closed deal → Purchase with value (after the amount), with the same identifiers.
    await db.query("INSERT INTO meta_connections(client_id,meta_user_id,token_ciphertext,app_id,expires_at) VALUES($1,'u1',$2,'123',NOW()+INTERVAL '1 hour')", [id, require('../metaConnection').encrypt('t', id)]);
    const crm = require('../crmService');
    const won = await crm.update(id, lead.id, { status: 'WON', version: lead.version, revenueMinor: 350000, currency: 'ILS' });
    assert.equal(won.status, 'WON');
    await db.query("UPDATE meta_capi_events SET available_at=NOW() WHERE client_id=$1", [id]);
    const sent = [];
    axios.post = async (url, body) => { sent.push({ url, data: JSON.parse(body.get('data'))[0] }); return { data: { events_received: 1 } }; };
    await require('../metaCrmFeedback').runWebDue({ limit: 50 });
    const mine = sent.filter((s) => s.url.endsWith('/123456789012/events'));
    assert.deepEqual(mine.map((s) => s.data.event_name).sort(), ['Lead', 'Purchase']);
    const purchase = mine.find((s) => s.data.event_name === 'Purchase').data, leadEvent = mine.find((s) => s.data.event_name === 'Lead').data;
    assert.equal(purchase.custom_data.value, 3500); assert.equal(purchase.custom_data.currency, 'ILS'); assert.equal(purchase.user_data.fbp, 'fb.1.1700000000000.123456');
    assert.equal(leadEvent.event_id, eventId); assert.equal(leadEvent.action_source, 'website'); assert.equal(leadEvent.user_data.client_ip_address, '1.2.3.4');
    assert.ok(!sent.some((s) => JSON.stringify(s.data).includes('7654321')), 'only hashed identifiers leave');
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM meta_capi_events WHERE client_id=$1 AND status='SENT' AND user_data='{}'::jsonb", [id])).rows[0].n, 2, 'identifiers cleared after sending');

    // A sold item stops collecting leads and says so.
    await db.query("UPDATE catalog_items SET status='SOLD_OUT' WHERE id=$1", [item.id]);
    await assert.rejects(lp.submit(slug, { name: 'מאוחר', phone: '0533334444', consent: true, eventId: crypto.randomUUID() }), /ITEM_NOT_AVAILABLE/);
    assert.match(lp.render(await lp.view(page)), /כבר לא זמין/);
  } finally { axios.get = get; axios.post = post; await close(); restoreEnv(); }
});

test('lead sources: WhatsApp forward is parsed and linked; webhook authenticates; DM leads stay off', async () => {
  setEnv();
  const { db, close } = await openDatabase();
  try {
    const intake = require('../leadIntake');
    const id = await client(db, '972504804020');
    const parsed = intake.parseForward('ליד חדש: דנה 050-1234567, מיד2, דירת 4 חדרים ברמת גן');
    assert.deepEqual([parsed.name, parsed.phone, parsed.source.key], ['דנה', '050-1234567'.replace(/-/g, ''), 'yad2']);
    assert.equal(intake.parseForward('מה שלומך'), null);
    await db.query("INSERT INTO catalog_items(id,client_id,vertical,title,status) VALUES($1,$2,'real_estate','דירת 4 חדרים ברמת גן','ACTIVE')", [crypto.randomUUID(), id]).catch(async () => {
      await db.query("INSERT INTO catalog_items(id,client_id,vertical,title,status,consent_required,owner_consent) VALUES($1,$2,'real_estate','דירת 4 חדרים ברמת גן','ACTIVE',true,true)", [crypto.randomUUID(), id]);
    });
    const r = await intake.handleForward(id, 'ליד חדש: דנה 050-1234567, מיד2, דירת 4 חדרים ברמת גן', { eventId: 'wamid.TEST1' });
    assert.match(r.reply, /רשמתי ליד חדש/); assert.match(r.reply, /מקור: יד2/); assert.match(r.reply, /דירת 4 חדרים ברמת גן/);
    const lead = (await db.query('SELECT * FROM crm_leads WHERE client_id=$1 AND id=$2', [id, r.leadId])).rows[0];
    assert.equal(lead.source, 'whatsapp_forward:yad2'); assert.equal(lead.name, 'דנה'); assert.ok(lead.catalog_item_id);
    assert.match((await intake.handleForward(id, 'ליד חדש: דנה 050-1234567, מיד2, דירת 4 חדרים ברמת גן', { eventId: 'wamid.TEST1' })).reply, /כבר רשום/);
    assert.match((await intake.handleForward(id, 'ליד חדש: משה בלי טלפון')).reply, /לא מצאתי טלפון/);

    // Webhook: wrong key → nothing; right key → lead with UTM attribution; same event id → duplicate.
    const hook = await intake.rotateWebhook(id);
    const hookId = hook.url.split('/').at(-1);
    assert.match(hook.url, /^https:\/\/app\.example\.test\/hooks\/leads\/wh[a-f0-9]{24}$/);
    assert.equal(await intake.authenticate(hookId, 'x'.repeat(32)), null);
    assert.equal(String(await intake.authenticate(hookId, hook.secret)), String(id));
    const w = await intake.fromWebhook(id, { full_name: 'אבי', phone: '0549876543', utm_source: 'google', utm_campaign: 'winter', event_id: 'form-77' });
    assert.equal(w.source, 'webhook'); assert.equal(w.utm.campaign, 'winter'); assert.equal(w.campaign_id, null);
    assert.equal((await intake.fromWebhook(id, { name: 'אבי', phone: '0549876543', event_id: 'form-77' })).duplicate, true);
    await assert.rejects(intake.fromWebhook(id, { name: 'בלי פרטים' }), /LEAD_CONTACT_REQUIRED/);
    const rotated = await intake.rotateWebhook(id);
    assert.equal(rotated.url, hook.url, 'the URL stays, only the key changes');
    assert.equal(await intake.authenticate(hookId, hook.secret), null);

    // Direct messages: parsed, but not enabled.
    const events = intake.parseMessagingWebhook({ object: 'instagram', entry: [{ messaging: [{ sender: { id: '55' }, recipient: { id: '333444' }, message: { mid: 'm1', text: 'היי, אפשר פרטים? 0501230000' } }] }] });
    assert.equal(events.length, 1);
    assert.equal((await intake.ingestDm(events[0])).status, 'DISABLED');
  } finally { await close(); restoreEnv(); }
});

test('HTTP: public page, lead form origin check, webhook auth, WhatsApp commands', async () => {
  setEnv();
  const { db, close } = await openDatabase();
  const app = require('../index');
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const root = 'http://127.0.0.1:' + server.address().port;
  try {
    const id = await client(db, '972504804030');
    await db.query("INSERT INTO customer_accounts(client_id,display_name,consent_version) VALUES($1,'דנה','v1')", [id]);
    const conv = require('../channelConversation');
    let r = await conv.handleText('972504804030', 'הדף שלי');
    assert.match(r.reply, /פרסם דף/);
    r = await conv.handleText('972504804030', 'פרסם דף');
    assert.match(r.reply, /https:\/\/app\.example\.test\/p\/b[a-z0-9]{10}/);
    const slug = r.reply.match(/\/p\/(b[a-z0-9]{10})/)[1];
    const page = await fetch(root + '/p/' + slug);
    assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    assert.match(await page.text(), /id="contact-form"/);
    assert.equal((await fetch(root + '/p/zzzz')).status, 404);
    assert.equal((await fetch(root + '/landing.css')).status, 200);
    assert.equal((await fetch(root + '/accessibility')).status, 200);
    const body = JSON.stringify({ name: 'גיל', phone: '0501239999', consent: true, eventId: crypto.randomUUID() });
    assert.equal((await fetch(root + '/p/' + slug + '/lead', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body })).status, 403);
    assert.equal((await fetch(root + '/p/' + slug + '/lead', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://app.example.test' }, body })).status, 200);
    const hook = await require('../leadIntake').rotateWebhook(id);
    const url = hook.url.replace('https://app.example.test', root);
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'א', phone: '0501230001' }) })).status, 401);
    const ok = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Bearer ' + hook.secret }, body: 'name=%D7%A8%D7%95%D7%A0%D7%99&phone=0501230002&utm_source=site' });
    assert.equal(ok.status, 201);
    const leads = (await db.query('SELECT source,landing_page_id FROM crm_leads WHERE client_id=$1 ORDER BY created_at', [id])).rows;
    assert.deepEqual(leads.map((l) => l.source.split(':')[0]), ['landing', 'webhook']);
    assert.ok(leads[0].landing_page_id);
    r = await conv.handleText('972504804030', 'ליד חדש: נועה 052-1112233 מהאתר');
    assert.match(r.reply, /מקור: האתר/);
    assert.equal(await conv.handleText('972504804030', 'מה נשמע'), null);
  } finally { await new Promise((resolve) => server.close(resolve)); await close(); restoreEnv(); }
});
