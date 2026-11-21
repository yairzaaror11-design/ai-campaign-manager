'use strict';
// Dashboard sign-in with Google (OpenID Connect, authorization code + PKCE).
// - Off unless GOOGLE_LOGIN_CLIENT_ID and GOOGLE_LOGIN_CLIENT_SECRET are set (the UI hides the button).
// - Asks Google only for "openid email": no Drive, Gmail or contacts access.
// - A Google account signs in only to a business it was linked to. Linking happens either from
//   settings while signed in (mode LINK), or right after an unknown Google account signs in and the
//   owner then signs in once with the WhatsApp link / phone code in the same browser (PENDING).
// - state and the PKCE verifier are single use, expire after 10 minutes and are bound to the
//   browser by an HttpOnly cookie; only hashes of tokens are stored.
const crypto = require('node:crypto');
const db = require('./db');

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const hash = (v) => crypto.createHash('sha256').update('google-login:' + String(v)).digest('hex');
const token = () => crypto.randomBytes(32).toString('hex');
const fail = (code) => Error(code);

function configured() {
  if (!process.env.GOOGLE_LOGIN_CLIENT_ID || !process.env.GOOGLE_LOGIN_CLIENT_SECRET) return false;
  try { require('./portalStore').origin(); return true; } catch { return false; }
}
const redirectUri = () => require('./portalStore').origin() + '/app/auth/google/callback';

// Begins a round trip. Returns the Google URL and the browser token for the flow cookie.
async function start(mode, clientId = null) {
  if (!configured()) throw fail('GOOGLE_LOGIN_DISABLED');
  if (!['LOGIN', 'LINK'].includes(mode) || (mode === 'LINK') !== !!clientId) throw fail('GOOGLE_LOGIN_INVALID');
  const state = token(), browser = token(), verifier = crypto.randomBytes(48).toString('base64url');
  await db.query('DELETE FROM google_login_flows WHERE expires_at<NOW()');
  await db.query("INSERT INTO google_login_flows(token_hash,browser_hash,mode,verifier,client_id,expires_at) VALUES($1,$2,$3,$4,$5,NOW()+INTERVAL '10 minutes')",
    [hash(state), hash(browser), mode, verifier, clientId]);
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_LOGIN_CLIENT_ID, redirect_uri: redirectUri(), response_type: 'code', scope: 'openid email',
    state, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    prompt: 'select_account'
  });
  return { url: AUTHORIZE + '?' + params, browser };
}

// The ID token comes straight from Google's token endpoint over TLS with our client secret,
// so its claims are trusted (OIDC Core 3.1.3.7); we still check issuer, audience, expiry and email.
function claims(idToken) {
  const part = String(idToken || '').split('.')[1];
  if (!part) throw fail('GOOGLE_LOGIN_FAILED');
  let c; try { c = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); } catch { throw fail('GOOGLE_LOGIN_FAILED'); }
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!ISSUERS.includes(c.iss) || !aud.includes(process.env.GOOGLE_LOGIN_CLIENT_ID) || !(Number(c.exp) * 1000 > Date.now())) throw fail('GOOGLE_LOGIN_FAILED');
  if (typeof c.sub !== 'string' || !c.sub || c.sub.length > 255) throw fail('GOOGLE_LOGIN_FAILED');
  if (c.email_verified !== true && c.email_verified !== 'true') throw fail('GOOGLE_EMAIL_NOT_VERIFIED');
  return { sub: c.sub, email: typeof c.email === 'string' ? c.email.slice(0, 254) : null };
}

async function exchange(code, verifier, http) {
  const response = await http(TOKEN, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_LOGIN_CLIENT_ID, client_secret: process.env.GOOGLE_LOGIN_CLIENT_SECRET, redirect_uri: redirectUri(), grant_type: 'authorization_code', code_verifier: verifier }).toString(),
    signal: AbortSignal.timeout(10000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id_token) throw fail('GOOGLE_LOGIN_FAILED');
  return claims(data.id_token);
}

async function newSession(tx, clientId, result) {
  const session = token(), csrf = crypto.randomBytes(24).toString('hex'), h = require('./portalStore').hash;
  await tx("INSERT INTO portal_sessions(token_hash,client_id,csrf_hash,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '7 days')", [h(session), clientId, h(csrf)]);
  await tx("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'PORTAL_LOGIN',$2)", [clientId, result]);
  return { session, csrf };
}

async function link(tx, clientId, { sub, email }) {
  const owner = (await tx('SELECT client_id FROM google_login_identities WHERE sub=$1 FOR UPDATE', [sub])).rows[0];
  if (owner && String(owner.client_id) !== String(clientId)) throw fail('GOOGLE_ACCOUNT_IN_USE');
  if (!owner) await tx('INSERT INTO google_login_identities(sub,client_id,email) VALUES($1,$2,$3)', [sub, clientId, email]);
  else await tx('UPDATE google_login_identities SET email=$2 WHERE sub=$1', [sub, email]);
  await tx("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'GOOGLE_LOGIN','LINKED')", [clientId]);
}

// Google redirected back. Returns one of:
//   {kind:'SESSION', clientId, session, csrf}  signed in
//   {kind:'LINKED', clientId}                  linked from settings
//   {kind:'PENDING', pending}                  unknown Google account; finish with the phone code
async function callback({ code, state, error, browser }, { http = fetch } = {}) {
  if (!configured()) throw fail('GOOGLE_LOGIN_DISABLED');
  if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state)) throw fail('GOOGLE_LOGIN_EXPIRED');
  const flow = (await db.query("UPDATE google_login_flows SET used_at=NOW() WHERE token_hash=$1 AND mode IN ('LOGIN','LINK') AND used_at IS NULL AND expires_at>NOW() RETURNING *", [hash(state)])).rows[0];
  if (!flow) throw fail('GOOGLE_LOGIN_EXPIRED');
  if (!browser || !crypto.timingSafeEqual(Buffer.from(hash(browser)), Buffer.from(flow.browser_hash))) throw fail('GOOGLE_LOGIN_EXPIRED');
  if (error) throw fail(error === 'access_denied' ? 'GOOGLE_LOGIN_DENIED' : 'GOOGLE_LOGIN_FAILED');
  if (typeof code !== 'string' || !code || code.length > 2048) throw fail('GOOGLE_LOGIN_FAILED');
  const who = await exchange(code, flow.verifier, http);
  if (flow.mode === 'LINK') {
    await db.transaction(async (tx) => { await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE', [flow.client_id]); await link(tx, flow.client_id, who); });
    return { kind: 'LINKED', clientId: flow.client_id };
  }
  const known = (await db.query('SELECT client_id FROM google_login_identities WHERE sub=$1', [who.sub])).rows[0];
  if (known) {
    return db.transaction(async (tx) => {
      const c = await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE', [known.client_id]);
      if (!c.rows.length) throw fail('GOOGLE_LOGIN_FAILED');
      await tx('UPDATE google_login_identities SET last_login_at=NOW(),email=COALESCE($2,email) WHERE sub=$1', [who.sub, who.email]);
      return { kind: 'SESSION', clientId: known.client_id, ...await newSession(tx, known.client_id, 'SUCCESS_GOOGLE') };
    });
  }
  const pending = token();
  await db.query("INSERT INTO google_login_flows(token_hash,browser_hash,mode,sub,email,expires_at) VALUES($1,$2,'PENDING',$3,$4,NOW()+INTERVAL '15 minutes')", [hash(pending), flow.browser_hash, who.sub, who.email]);
  return { kind: 'PENDING', pending };
}

// After a successful WhatsApp-link or phone-code sign-in: link the pending Google account, if any.
// Never throws (sign-in already succeeded); returns true when an account was linked.
async function completePending(pending, clientId) {
  try {
    if (!pending || !/^[a-f0-9]{64}$/.test(pending)) return false;
    const row = (await db.query("UPDATE google_login_flows SET used_at=NOW() WHERE token_hash=$1 AND mode='PENDING' AND used_at IS NULL AND expires_at>NOW() RETURNING sub,email", [hash(pending)])).rows[0];
    if (!row) return false;
    await db.transaction(async (tx) => { await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE', [clientId]); await link(tx, clientId, row); });
    return true;
  } catch { return false; }
}

async function status(clientId) {
  if (!configured()) return { enabled: false, accounts: [] };
  const rows = (await db.query('SELECT email,created_at FROM google_login_identities WHERE client_id=$1 ORDER BY created_at', [clientId])).rows;
  return { enabled: true, accounts: rows.map((r) => ({ email: r.email || 'חשבון Google', since: r.created_at })) };
}

async function unlink(clientId) {
  const r = await db.query('DELETE FROM google_login_identities WHERE client_id=$1', [clientId]);
  await db.query("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'GOOGLE_LOGIN','UNLINKED')", [clientId]);
  return { ok: true, removed: r.rowCount ?? 0 };
}

module.exports = { configured, start, callback, completePending, status, unlink, claims, redirectUri };
