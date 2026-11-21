'use strict';
// Sign-in with Google: off unless configured; PKCE + single-use state bound to the browser;
// only a linked Google account signs in; unknown accounts are linked after one phone/link sign-in;
// one Google account cannot be linked to two businesses. Google itself is faked.
const test = require('node:test'), assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { openDatabase } = require('./helpers/isolatedDatabase');
// One database for the file (native Postgres in CI, embedded locally); rows are scoped to fresh clients.
let h;
test.before(async () => { h = await openDatabase(); });
test.after(async () => { await h.close(); });

const ORIGIN = 'https://campaign.example';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (claims) => [b64({ alg: 'RS256' }), b64({ iss: 'https://accounts.google.com', aud: 'gid.apps.googleusercontent.com', exp: Math.floor(Date.now() / 1000) + 600, email_verified: true, ...claims }), 'sig'].join('.');
const fakeGoogle = (claims, seen = []) => async (url, init) => {
  seen.push({ url, body: new URLSearchParams(init.body) });
  return { ok: true, json: async () => ({ id_token: idToken(claims) }) };
};
const run = crypto.randomBytes(4).toString('hex'); // unique Google ids per run (shared CI database)
const phone = () => '97250' + String(crypto.randomInt(1000000, 9999999));

function withEnv(values, work) {
  const saved = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  Object.assign(process.env, values);
  return Promise.resolve(work()).finally(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; });
}
const ENV = { APP_PUBLIC_URL: ORIGIN + '/', GOOGLE_LOGIN_CLIENT_ID: 'gid.apps.googleusercontent.com', GOOGLE_LOGIN_CLIENT_SECRET: 'secret' };

test('Google sign-in: disabled, PKCE start, pending link, sign-in, misuse refused, unlink', async () => {
  {
    const g = require('../googleLogin');
    await withEnv({ APP_PUBLIC_URL: ORIGIN + '/', GOOGLE_LOGIN_CLIENT_ID: '', GOOGLE_LOGIN_CLIENT_SECRET: '' }, async () => {
      assert.equal(g.configured(), false);
      await assert.rejects(g.start('LOGIN'), /GOOGLE_LOGIN_DISABLED/);
      assert.deepEqual(await g.status(1), { enabled: false, accounts: [] });
    });
    await withEnv(ENV, async () => {
      const clients = require('../clientStore');
      const owner = await clients.getOrCreateClient(phone()), other = await clients.getOrCreateClient(phone());

      // Start: only openid+email, S256 challenge, our redirect.
      const s = await g.start('LOGIN');
      const u = new URL(s.url);
      assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
      assert.equal(u.searchParams.get('scope'), 'openid email');
      assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(u.searchParams.get('redirect_uri'), ORIGIN + '/app/auth/google/callback');
      const state = u.searchParams.get('state');

      // Wrong browser: refused, and the state is burned.
      await assert.rejects(g.callback({ code: 'c', state, browser: 'f'.repeat(64) }, { http: fakeGoogle({ sub: 'A' }) }), /GOOGLE_LOGIN_EXPIRED/);
      await assert.rejects(g.callback({ code: 'c', state, browser: s.browser }, { http: fakeGoogle({ sub: 'A' }) }), /GOOGLE_LOGIN_EXPIRED/);

      // Unknown Google account → pending; the verifier matches the challenge.
      const s2 = await g.start('LOGIN'), st2 = new URL(s2.url).searchParams, seen = [];
      const pending = await g.callback({ code: 'code-1', state: st2.get('state'), browser: s2.browser }, { http: fakeGoogle({ sub: 'sub-owner-' + run, email: 'owner@gmail.com' }, seen) });
      assert.equal(pending.kind, 'PENDING');
      assert.equal(crypto.createHash('sha256').update(seen[0].body.get('code_verifier')).digest('base64url'), st2.get('code_challenge'));
      assert.equal(seen[0].body.get('client_secret'), 'secret');
      assert.equal(await g.completePending(pending.pending, owner.id), true);
      assert.equal(await g.completePending(pending.pending, other.id), false, 'a pending link is single use');
      assert.deepEqual((await g.status(owner.id)).accounts.map((a) => a.email), ['owner@gmail.com']);
      assert.deepEqual((await g.status(other.id)).accounts, []);

      // Linked account signs in to its own business only.
      const s3 = await g.start('LOGIN');
      const signed = await g.callback({ code: 'code-2', state: new URL(s3.url).searchParams.get('state'), browser: s3.browser }, { http: fakeGoogle({ sub: 'sub-owner-' + run, email: 'owner@gmail.com' }) });
      assert.equal(signed.kind, 'SESSION');
      assert.equal(String(signed.clientId), String(owner.id));
      const portal = require('../portalStore');
      const auth = await portal.authenticate({ headers: { cookie: 'cb_session=' + signed.session } });
      assert.equal(String(auth.clientId), String(owner.id));

      // Linking the same Google account to another business is refused.
      const s4 = await g.start('LINK', other.id);
      await assert.rejects(g.callback({ code: 'c', state: new URL(s4.url).searchParams.get('state'), browser: s4.browser }, { http: fakeGoogle({ sub: 'sub-owner-' + run }) }), /GOOGLE_ACCOUNT_IN_USE/);
      // LINK needs a signed-in business; LOGIN must not carry one.
      await assert.rejects(g.start('LINK'), /GOOGLE_LOGIN_INVALID/);
      await assert.rejects(g.start('LOGIN', owner.id), /GOOGLE_LOGIN_INVALID/);

      // Token checks: wrong audience, unverified email, expired token, user cancelled.
      for (const [claims, error] of [[{ sub: 'x', aud: 'someone-else' }, /GOOGLE_LOGIN_FAILED/], [{ sub: 'x', email_verified: false }, /GOOGLE_EMAIL_NOT_VERIFIED/], [{ sub: 'x', exp: 1 }, /GOOGLE_LOGIN_FAILED/], [{ sub: 'x', iss: 'https://evil.example' }, /GOOGLE_LOGIN_FAILED/]]) {
        const st = await g.start('LOGIN');
        await assert.rejects(g.callback({ code: 'c', state: new URL(st.url).searchParams.get('state'), browser: st.browser }, { http: fakeGoogle(claims) }), error);
      }
      const sd = await g.start('LOGIN');
      await assert.rejects(g.callback({ error: 'access_denied', state: new URL(sd.url).searchParams.get('state'), browser: sd.browser }), /GOOGLE_LOGIN_DENIED/);

      // Unlink: the account no longer signs in (it becomes pending again).
      await g.unlink(owner.id);
      const s5 = await g.start('LOGIN');
      assert.equal((await g.callback({ code: 'c', state: new URL(s5.url).searchParams.get('state'), browser: s5.browser }, { http: fakeGoogle({ sub: 'sub-owner-' + run }) })).kind, 'PENDING');
    });
  }
});

test('Google sign-in over HTTP: config, start cookie, callback session, pending linked by the WhatsApp link sign-in', async () => {
  const realFetch = globalThis.fetch;
  await withEnv(ENV, async () => {
    const app = require('express')().use(require('express').json()).use(require('../portalRoutes'));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const root = 'http://127.0.0.1:' + server.address().port;
    let googleSub = 'sub-http-' + run;
    globalThis.fetch = (url, init) => String(url).startsWith('https://oauth2.googleapis.com/') ? fakeGoogle({ sub: googleSub, email: 'http@gmail.com' })(url, init) : realFetch(url, init);
    try {
      const owner = await require('../clientStore').getOrCreateClient(phone());
      assert.deepEqual(await (await realFetch(root + '/app/auth/google/config')).json(), { enabled: true });

      const flow = async () => {
        const start = await realFetch(root + '/app/auth/google/start?mode=login', { redirect: 'manual' });
        assert.equal(start.status, 302);
        assert.match(start.headers.get('location'), /^https:\/\/accounts\.google\.com\//);
        const cookie = start.headers.get('set-cookie');
        assert.match(cookie, /cb_gflow=[a-f0-9]{64}; Path=\/app\/auth\/google; HttpOnly; Secure; SameSite=Lax/);
        const state = new URL(start.headers.get('location')).searchParams.get('state');
        return realFetch(root + '/app/auth/google/callback?code=abc&state=' + state, { headers: { cookie: cookie.split(';')[0] } });
      };
      // Unknown account → pending cookie, back to /app#google=pending.
      const first = await flow();
      assert.match(await first.text(), /url=\/app#google=pending/);
      const pendingCookie = first.headers.getSetCookie().find((c) => c.startsWith('cb_gpending=')).split(';')[0];

      // The owner signs in once with the WhatsApp link → the Google account is linked.
      const ticket = (await require('../portalStore').createTicket(owner.id)).split('#login=')[1];
      const login = await realFetch(root + '/app/api/login', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', cookie: pendingCookie }, body: JSON.stringify({ token: ticket }) });
      assert.deepEqual(await login.json(), { ok: true, googleLinked: true });
      assert.ok(login.headers.getSetCookie().some((c) => c.startsWith('cb_gpending=;')));

      // Next time: Google alone signs in (Strict session cookies, same-site refresh to /app).
      const second = await flow();
      assert.match(await second.text(), /url=\/app#google=ok/);
      const session = second.headers.getSetCookie().find((c) => c.startsWith('cb_session='));
      assert.match(session, /HttpOnly; Secure; SameSite=Strict/);
      const me = await realFetch(root + '/app/api/google-login', { headers: { cookie: session.split(';')[0] } });
      assert.deepEqual((await me.json()).accounts.map((a) => a.email), ['http@gmail.com']);

      // A tampered state never signs in.
      const bad = await realFetch(root + '/app/auth/google/callback?code=abc&state=' + 'a'.repeat(64));
      assert.match(await bad.text(), /#google=expired/);
      assert.equal(bad.headers.getSetCookie().some((c) => c.startsWith('cb_session=')), false);
      // Linking from settings requires being signed in.
      const link = await realFetch(root + '/app/auth/google/start?mode=link', { redirect: 'manual' });
      assert.equal(link.headers.get('location'), '/app#google=signin');
    } finally {
      globalThis.fetch = realFetch;
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
