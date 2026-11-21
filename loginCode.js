'use strict';
// Dashboard sign-in without a WhatsApp link: phone number -> a one-time 6-digit code on WhatsApp.
// Security: only a keyed hash of the code is stored; 10-minute expiry; single use; at most
// 5 wrong tries per code; per-phone and per-IP rate limits; the answer to "send me a code" is
// the same whether or not the number is a customer (no account enumeration).
const crypto = require('node:crypto');
const db = require('./db');
const copy = require('./onboardingCopy');

const MAX_TRIES = 5;
const pepper = () => process.env.PORTAL_CODE_SECRET || process.env.META_TOKEN_ENCRYPTION_KEY || process.env.APP_PUBLIC_URL || 'scorpio-login-code';
const codeHash = (id, code) => crypto.createHmac('sha256', pepper()).update(String(id) + ':' + String(code)).digest('hex');
const phoneKey = (phone) => crypto.createHash('sha256').update('login-phone:' + phone).digest('hex');
// Israeli local form (05X...) and international form (9725X...) both reach the same customer.
function normalize(input) {
  let d = require('./auth').normalizePhone(input);
  if (/^0\d{8,9}$/.test(d)) d = '972' + d.slice(1);
  return /^\d{8,15}$/.test(d) ? d : null;
}

// Always resolves to the same generic answer. `send` is injectable for tests.
async function request(phoneInput, { send = sendCode } = {}) {
  const generic = { ok: true, message: copy.loginCodeSentGeneric };
  const phone = normalize(phoneInput);
  if (!phone) return generic;
  // 3 codes per number per 15 minutes; checked before the lookup so timing does not reveal customers.
  if (!await require('./rateLimit').take('login-code-request:' + phoneKey(phone), 3, 900)) return generic;
  const client = (await db.query('SELECT id,phone FROM clients WHERE phone=$1', [phone])).rows[0];
  if (!client) return generic;
  const id = crypto.randomUUID(), code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await db.transaction(async (tx) => {
    await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE', [client.id]);
    // Only the newest code works.
    await tx('UPDATE portal_login_codes SET used_at=NOW() WHERE client_id=$1 AND used_at IS NULL', [client.id]);
    await tx("INSERT INTO portal_login_codes(id,client_id,code_hash,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '10 minutes')", [id, client.id, codeHash(id, code)]);
    await tx("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'PORTAL_LOGIN_CODE','ISSUED')", [client.id]);
  });
  try { await send(client, code, id); } catch (error) {
    require('./logger').logger.warn('Login code not sent', { error: /^[A-Z_]+$/.test(error?.message) ? error.message : 'LOGIN_CODE_SEND_FAILED' });
  }
  return generic;
}
async function sendCode(client, code, id) {
  await require('./metaConnection').context.run(String(client.id), () => require('./whatsappDelivery').messageContext.run({ eventId: 'login-code:' + id, sequence: 0, humanSupportNotice: true },
    () => require('./whatsapp').safeSend(client.phone, copy.loginCodeMessage(code))));
}

// Returns {clientId, session, csrf} or throws INVALID_LOGIN_CODE / LOGIN_CODE_RATE_LIMITED.
async function verify(phoneInput, codeInput) {
  const phone = normalize(phoneInput), code = String(codeInput ?? '').trim();
  if (!phone || !/^\d{6}$/.test(code)) throw Error('INVALID_LOGIN_CODE');
  if (!await require('./rateLimit').take('login-code-verify:' + phoneKey(phone), 10, 900)) throw Error('LOGIN_CODE_RATE_LIMITED');
  const session = crypto.randomBytes(32).toString('hex'), csrf = crypto.randomBytes(24).toString('hex'), hash = require('./portalStore').hash;
  const result = await db.transaction(async (tx) => {
    const client = (await tx('SELECT id FROM clients WHERE phone=$1 FOR UPDATE', [phone])).rows[0];
    if (!client) return null;
    const row = (await tx('SELECT id,code_hash,attempts FROM portal_login_codes WHERE client_id=$1 AND used_at IS NULL AND expires_at>NOW() ORDER BY created_at DESC LIMIT 1 FOR UPDATE', [client.id])).rows[0];
    if (!row) return null;
    const expected = Buffer.from(row.code_hash, 'hex'), supplied = Buffer.from(codeHash(row.id, code), 'hex');
    if (!crypto.timingSafeEqual(expected, supplied)) {
      // Too many wrong tries burn the code.
      await tx('UPDATE portal_login_codes SET attempts=attempts+1,used_at=CASE WHEN attempts+1>=$2 THEN NOW() ELSE NULL END WHERE id=$1', [row.id, MAX_TRIES]);
      return { failed: true };
    }
    const consumed = await tx('UPDATE portal_login_codes SET used_at=NOW() WHERE id=$1 AND used_at IS NULL RETURNING id', [row.id]);
    if (!consumed.rows.length) return null;
    await tx("INSERT INTO portal_sessions(token_hash,client_id,csrf_hash,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '7 days')", [hash(session), client.id, hash(csrf)]);
    await tx("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'PORTAL_LOGIN','SUCCESS_CODE')", [client.id]);
    return { clientId: client.id };
  });
  if (!result || result.failed) throw Error('INVALID_LOGIN_CODE');
  return { ...result, session, csrf };
}

module.exports = { request, verify, normalize, sendCode, MAX_TRIES };
