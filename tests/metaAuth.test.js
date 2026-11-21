'use strict';
// Real Meta connection: Facebook Login (config_id or classic dialog), redirect from env,
// "תן הרשאה" re-request, long-lived token + debug_token expiry, revocation (190 and the
// deauthorize callback), live asset selection, the connections API and /health counts.
// Meta is mocked at the axios boundary like the other tests; nothing reaches Meta.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const axios = require('axios');
const express = require('express');
const { openDatabase } = require('./helpers/database');

const ALL = ['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement', 'pages_manage_ads', 'leads_retrieval', 'instagram_basic'];
const nowSec = () => Math.floor(Date.now() / 1000);

test('Meta auth: login, permissions, long-lived tokens, revocation, assets, connections and health', async (t) => {
  const env = { ...process.env }, get = axios.get, post = axios.post, h = await openDatabase();
  Object.assign(process.env, { APP_PUBLIC_URL: 'https://app.example.test', META_APP_ID: '123', META_APP_SECRET: 'app-secret', META_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'), META_WRITES_ENABLED: 'false', READ_ONLY: 'true' });
  delete process.env.META_LOGIN_CONFIG_ID; delete process.env.META_MANAGEMENT_LOGIN_CONFIG_ID; delete process.env.META_REDIRECT_URI;
  const meta = require('../metaConnection'), auth = require('../metaAuth');
  const client = async (phone) => require('../clientStore').getOrCreateClient(phone);
  const outbox = async (id) => (await h.db.query('SELECT payload FROM whatsapp_outbox WHERE client_id=$1 ORDER BY delivery_order', [id])).rows.map((r) => r.payload.text?.body || r.payload.interactive?.body?.text || '');
  // Mock Meta: one test user with a configurable grant, debug_token result and assets.
  let granted = [...ALL], declined = [], debug = { is_valid: true, app_id: '123', user_id: '777', expires_at: nowSec() + 60 * 86400, data_access_expires_at: nowSec() + 90 * 86400, scopes: ALL };
  const posts = [], gets = [];
  let exchangeExpiresIn = 5183944;
  axios.post = async (url, body) => {
    const params = Object.fromEntries(new URLSearchParams(String(body)));
    posts.push({ url, params });
    if (params.grant_type === 'fb_exchange_token') return { data: { access_token: 'long-' + params.fb_exchange_token.replace(/^long-/, ''), token_type: 'bearer', expires_in: exchangeExpiresIn } };
    return { data: { access_token: 'short-token', token_type: 'bearer', expires_in: 3600 } };
  };
  axios.get = async (url, options = {}) => {
    gets.push({ url, params: options.params || {} });
    if (url.endsWith('/debug_token')) {
      assert.equal(options.params.access_token, '123|app-secret');
      return { data: { data: debug } };
    }
    assert.match(options.headers?.Authorization || '', /^Bearer long-/, 'Graph calls use the long-lived token');
    assert.ok(options.params.appsecret_proof);
    if (url.endsWith('/me')) return { data: { id: '777' } };
    if (url.endsWith('/me/permissions')) return { data: { data: [...granted.map((permission) => ({ permission, status: 'granted' })), ...declined.map((permission) => ({ permission, status: 'declined' }))] } };
    if (url.endsWith('/me/adaccounts')) return { data: { data: [{ id: 'act_11', name: 'משרד תיווך', currency: 'ILS', account_status: 1 }, { id: 'act_12', name: 'חשבון סגור', account_status: 2 }] } };
    if (url.endsWith('/me/accounts')) return { data: { data: [{ id: '501', name: 'עמוד המשרד', tasks: ['ADVERTISE'], instagram_business_account: { id: '9001', username: 'office_ig' } }, { id: '502', name: 'עמוד שני' }] } };
    if (url.endsWith('/act_11/adspixels')) return { data: { data: [{ id: '123456', name: 'פיקסל האתר', last_fired_time: '2026-11-20T10:00:00+0000' }] } };
    if (url.endsWith('/act_11')) return { data: { id: 'act_11', account_status: 1 } };
    return { data: {} };
  };
  const login = async (clientId, opts) => {
    const started = await meta.begin((await meta.createInvite(clientId, opts)).split('#')[1]);
    return { started, url: new URL(started.url) };
  };
  const finish = async ({ started, url }) => meta.callback(url.searchParams.get('state'), started.browser, 'the-code');
  try {
    let a;
    await t.test('classic dialog (no config_id) asks for the permission list; redirect URI comes from env', async () => {
      process.env.META_REDIRECT_URI = 'https://app.example.test/auth/meta/callback';
      a = await client('972500004101');
      const { url } = await login(a.id);
      assert.equal(url.origin + url.pathname, 'https://www.facebook.com/v26.0/dialog/oauth');
      assert.equal(url.searchParams.get('config_id'), null);
      assert.deepEqual(url.searchParams.get('scope').split(','), ALL);
      assert.equal(url.searchParams.get('redirect_uri'), 'https://app.example.test/auth/meta/callback');
      assert.equal(url.searchParams.get('response_type'), 'code');
      assert.match(url.searchParams.get('state'), /^[A-Za-z0-9_-]{43}$/);
      process.env.META_REDIRECT_URI = 'https://evil.example/auth/meta/callback';
      assert.throws(() => meta.config(), /INVALID_META_REDIRECT_URI/);
      process.env.META_REDIRECT_URI = 'https://app.example.test/auth/meta/callback';
    });
    await t.test('Facebook Login for Business uses config_id instead of scope', async () => {
      process.env.META_LOGIN_CONFIG_ID = '456';
      const { url } = await login(a.id);
      assert.equal(url.searchParams.get('config_id'), '456');
      assert.equal(url.searchParams.get('scope'), null);
    });
    await t.test('state is single-use and bound to the browser cookie', async () => {
      const l = await login(a.id);
      await assert.rejects(meta.callback(l.url.searchParams.get('state'), 'other-browser', 'x'), /INVALID_LOGIN/);
      await finish(l);
      await assert.rejects(finish(l), /INVALID_LOGIN/);
    });
    await t.test('login: long-lived exchange, debug_token expiry, granted/declined saved, token encrypted', async () => {
      posts.length = 0;
      await finish(await login(a.id));
      const exchange = posts.find((p) => p.params.grant_type === 'fb_exchange_token');
      assert.ok(exchange, 'short-lived token is exchanged');
      assert.equal(exchange.params.fb_exchange_token, 'short-token');
      assert.equal(posts[0].params.redirect_uri, 'https://app.example.test/auth/meta/callback');
      const row = (await h.db.query('SELECT token_ciphertext,expires_at FROM meta_connections WHERE client_id=$1', [a.id])).rows[0];
      assert.doesNotMatch(row.token_ciphertext, /long-|short-/);
      assert.equal((await meta.credentials(a.id)).token, 'long-short-token');
      assert.equal(Math.round(new Date(row.expires_at).getTime() / 1000), debug.expires_at);
      const s = await auth.state(a.id);
      assert.equal(s.status, 'ACTIVE');
      assert.deepEqual(s.granted, ALL);
      assert.equal(Math.round(new Date(s.data_access_expires_at).getTime() / 1000), debug.data_access_expires_at);
    });
    await t.test('missing permissions are listed in Hebrew and "תן הרשאה" re-requests exactly them', async () => {
      granted = ALL.filter((p) => !['leads_retrieval', 'business_management'].includes(p)); declined = ['leads_retrieval', 'business_management'];
      await finish(await login(a.id));
      const view = await auth.metaView(a.id);
      assert.equal(view.status, 'MISSING_PERMISSIONS');
      assert.deepEqual(view.missing.sort(), ['business_management', 'leads_retrieval']);
      assert.ok(view.permissions.find((p) => p.name === 'leads_retrieval' && !p.granted && p.declined && /לידים/.test(p.label)));
      const { url } = await login(a.id, { rerequest: true });
      assert.equal(url.searchParams.get('auth_type'), 'rerequest');
      assert.deepEqual(url.searchParams.get('scope').split(',').sort(), ['business_management', 'leads_retrieval']);
      // WhatsApp: the same link from "תן הרשאה".
      const reply = await require('../metaConversation').handle(a.id, 'תן הרשאה', {}, 'perm-1');
      assert.match(reply.reply, /https:\/\/app\.example\.test\/auth\/meta\/connect#/);
      granted = [...ALL]; declined = [];
      await finish(await login(a.id, { rerequest: true }));
      assert.deepEqual((await auth.metaView(a.id)).missing, []);
    });
    await t.test('a login without ads_read is refused but remembered for the re-request', async () => {
      process.env.META_MANAGEMENT_LOGIN_CONFIG_ID = '789';
      const b = await client('972500004102');
      granted = ['pages_show_list']; declined = ['ads_read', 'ads_management'];
      await assert.rejects(finish(await login(b.id)), /ADS_(READ|MANAGEMENT)_REQUIRED/);
      await assert.rejects(meta.credentials(b.id), /META_CONNECTION_REQUIRED/);
      const { url } = await login(b.id, { rerequest: true });
      assert.equal(url.searchParams.get('config_id'), '789');
      assert.ok(url.searchParams.get('scope').split(',').includes('ads_read'));
      granted = [...ALL]; declined = [];
      delete process.env.META_MANAGEMENT_LOGIN_CONFIG_ID;
    });
    await t.test('assets are listed live and saved per business; foreign ids are refused', async () => {
      const list = await auth.assets(a.id);
      assert.deepEqual(list.adAccounts.map((x) => [x.id, x.active]), [['act_11', true], ['act_12', false]]);
      assert.deepEqual(list.pages.map((p) => p.id), ['501', '502']);
      assert.deepEqual(list.instagram, [{ id: '9001', username: 'office_ig', pageId: '501' }]);
      assert.doesNotMatch(JSON.stringify(list), /long-|token/i);
      await auth.selectAsset(a.id, 'adAccount', 'act_11');
      await assert.rejects(auth.selectAsset(a.id, 'adAccount', 'act_12'), /ACCOUNT_NOT_GRANTED/);
      await auth.selectAsset(a.id, 'page', '501');
      assert.deepEqual(await auth.selectedAssets(a.id), { pageId: '501', instagramId: '9001' });
      await assert.rejects(auth.selectAsset(a.id, 'page', '999'), /ASSET_NOT_GRANTED/);
      await auth.selectAsset(a.id, 'pixel', '123456');
      assert.equal((await h.db.query('SELECT pixel_id FROM business_channels WHERE client_id=$1', [a.id])).rows[0].pixel_id, '123456');
      await assert.rejects(auth.selectAsset(a.id, 'pixel', '654321'), /ASSET_NOT_GRANTED/);
      const view = await auth.metaView(a.id);
      assert.equal(view.status, 'CONNECTED');
      assert.equal(view.assets.page.name, 'עמוד המשרד');
      assert.equal(view.assets.pixel.name, 'פיקסל האתר');
    });
    await t.test('connections API: authenticated JSON, no secrets, and actions', async () => {
      const app = express(); app.use(express.json());
      app.use('/app/api', (req, res, next) => { req.portal = { clientId: a.id }; next(); });
      app.use('/app/api/connections', require('../connectionRoutes'));
      const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const base = 'http://127.0.0.1:' + server.address().port + '/app/api/connections';
      try {
        const res = await fetch(base); assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.meta.status, 'CONNECTED');
        assert.ok(body.meta.tokenExpiresAt && body.meta.lastSyncAt);
        assert.ok(['publishing', 'pixel', 'leadAds', 'whatsapp'].every((k) => k in body));
        assert.doesNotMatch(JSON.stringify(body), /long-short|token_ciphertext|app-secret|972500/);
        const connect = await (await fetch(base + '/meta/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
        assert.match(connect.url, /^https:\/\/app\.example\.test\/auth\/meta\/connect#[A-Za-z0-9_-]{43}$/);
        const assets = await fetch(base + '/meta/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'page', id: '999' }) });
        assert.equal(assets.status, 400); assert.match((await assets.json()).error, /לא נמצאה/);
        assert.equal((await fetch(base + '/meta/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
      } finally { server.close(); }
    });
    await t.test('expiring token: renewal is tried, then the owner is told once, N days ahead', async () => {
      debug = { ...debug, expires_at: nowSec() + 3 * 86400 };
      await h.db.query("UPDATE meta_connections SET expires_at=NOW()+INTERVAL '3 days' WHERE client_id=$1", [a.id]);
      posts.length = 0;
      exchangeExpiresIn = 3 * 86400; // Meta did not extend it
      const r = await auth.checkOne(a.id);
      assert.equal(r.renewed, true);
      assert.ok(posts.some((p) => p.params.grant_type === 'fb_exchange_token'));
      await auth.checkOne(a.id);
      const notes = (await outbox(a.id)).filter((m) => /יפוג בעוד/.test(m));
      assert.equal(notes.length, 1);
      assert.match(notes[0], /קישור חדש לחיבור מטא/);
      debug = { ...debug, expires_at: nowSec() + 60 * 86400 }; exchangeExpiresIn = 5183944;
    });
    await t.test('error 190 → debug_token confirms → disconnected, jobs stopped, owner told in Hebrew', async () => {
      const c = await client('972500004103');
      await finish(await login(c.id));
      debug = { ...debug, is_valid: false, error: { code: 190, subcode: 460 } };
      const saved = axios.get;
      axios.get = async (url, options) => { if (url.endsWith('/debug_token')) return saved(url, options); throw Object.assign(Error('x'), { response: { data: { error: { code: 190, error_subcode: 460 } } } }); };
      try {
        await meta.context.run(String(c.id), () => assert.rejects(meta.tenantRead('/me/adaccounts', {}), /META_TOKEN_EXPIRED/));
        for (let i = 0; i < 50 && (await auth.state(c.id)).status !== 'REVOKED'; i++) await new Promise((r) => setTimeout(r, 20));
      } finally { axios.get = saved; }
      assert.equal((await auth.state(c.id)).status, 'REVOKED');
      assert.equal((await auth.state(c.id)).reason, 'SESSION_INVALIDATED');
      await assert.rejects(meta.credentials(c.id), /META_CONNECTION_REQUIRED/);
      const notes = (await outbox(c.id)).filter((m) => /שינוי סיסמה/.test(m));
      assert.equal(notes.length, 1);
      assert.equal((await auth.metaView(c.id)).status, 'REVOKED');
      debug = { ...debug, is_valid: true, error: undefined };
    });
    await t.test('deauthorize callback (signed_request) disconnects and notifies the owner', async () => {
      const d = await client('972500004104');
      await finish(await login(d.id));
      const payload = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', issued_at: nowSec(), user_id: '777' })).toString('base64url');
      const sig = crypto.createHmac('sha256', 'app-secret').update(payload).digest('base64url');
      const app = express(); app.use('/meta', require('../metaDeletion').router);
      const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
      try {
        const bad = await fetch('http://127.0.0.1:' + server.address().port + '/meta/deauthorize', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'signed_request=' + sig.slice(1) + 'A.' + payload });
        assert.equal(bad.status, 400);
        const ok = await fetch('http://127.0.0.1:' + server.address().port + '/meta/deauthorize', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'signed_request=' + sig + '.' + payload });
        assert.equal(ok.status, 200);
      } finally { server.close(); }
      assert.equal((await auth.state(d.id)).reason, 'DEAUTHORIZED');
      await assert.rejects(meta.credentials(d.id), /META_CONNECTION_REQUIRED/);
      assert.ok((await outbox(d.id)).some((m) => /הוסר מתוך פייסבוק/.test(m)));
      // Reconnecting restores an active connection.
      await finish(await login(d.id));
      assert.equal((await auth.state(d.id)).status, 'ACTIVE');
    });
    await t.test('owner disconnect from the dashboard marks the state and removes the token', async () => {
      await meta.disconnect(a.id);
      assert.equal((await auth.state(a.id)).status, 'DISCONNECTED');
      assert.equal((await auth.metaView(a.id)).status, 'NOT_CONNECTED');
    });
    await t.test('/health integrations: counts only, no ids, tokens or phones', async () => {
      const s = await auth.healthSummary();
      assert.equal(typeof s.meta.connected, 'number');
      assert.ok(s.meta.revoked >= 1);
      assert.equal(s.meta.loginMode, 'business_config');
      assert.doesNotMatch(JSON.stringify(s), /act_|972500|777|123456|long-/);
    });
  } finally {
    axios.get = get; axios.post = post;
    await new Promise((r) => setTimeout(r, 50));
    await h.close();
    for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
    Object.assign(process.env, env);
  }
});
