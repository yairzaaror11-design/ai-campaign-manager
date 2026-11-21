'use strict';
// Opt-in LIVE test against a real Meta test account. Read-only: it never creates,
// changes or spends anything. Skipped unless both are set:
//   META_TEST_ACCESS_TOKEN   a user access token of a test user / your own user (ads_read at least)
//   META_TEST_AD_ACCOUNT_ID  act_<digits> that the token can read
// Optional: META_APP_ID + META_APP_SECRET (adds appsecret_proof and checks debug_token),
//           META_GRAPH_VERSION (default v26.0).
// Run: npm run test:live
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const axios = require('axios');

const token = process.env.META_TEST_ACCESS_TOKEN;
const account = process.env.META_TEST_AD_ACCOUNT_ID;
const skip = !token || !account ? 'META_TEST_ACCESS_TOKEN and META_TEST_AD_ACCOUNT_ID are not set' : false;
const version = process.env.META_GRAPH_VERSION || 'v26.0';
const secret = process.env.META_APP_SECRET;

async function graph(path, params = {}) {
  const proof = secret ? { appsecret_proof: crypto.createHmac('sha256', secret).update(token).digest('hex') } : {};
  try {
    return (await axios.get('https://graph.facebook.com/' + version + path, { headers: { Authorization: 'Bearer ' + token }, params: { ...params, ...proof }, timeout: 20000 })).data;
  } catch (error) {
    const e = error?.response?.data?.error;
    throw Error('Meta ' + path + ' failed: ' + (e ? `${e.code}/${e.error_subcode || '-'} ${e.message}` : error.message));
  }
}

test('LIVE Meta: token, permissions and asset listing (read-only)', { skip, timeout: 60000 }, async (t) => {
  assert.match(account, /^act_\d+$/, 'META_TEST_AD_ACCOUNT_ID must look like act_123');
  const { REQUIRED, OPTIONAL } = require('../../metaAuth');

  await t.test('debug_token: the token is valid for this app', { skip: !process.env.META_APP_ID || !secret ? 'META_APP_ID / META_APP_SECRET not set' : false }, async () => {
    const r = (await axios.get('https://graph.facebook.com/' + version + '/debug_token', { params: { input_token: token, access_token: process.env.META_APP_ID + '|' + secret }, timeout: 20000 })).data.data;
    assert.equal(r.is_valid, true, 'token is valid');
    assert.equal(String(r.app_id), String(process.env.META_APP_ID), 'token belongs to META_APP_ID');
    t.diagnostic('expires: ' + (r.expires_at ? new Date(r.expires_at * 1000).toISOString() : 'never') + ', data access until: ' + (r.data_access_expires_at ? new Date(r.data_access_expires_at * 1000).toISOString() : 'n/a'));
  });

  await t.test('/me/permissions answers with granted/declined statuses', async () => {
    const rows = (await graph('/me/permissions')).data;
    assert.ok(Array.isArray(rows) && rows.length > 0);
    assert.ok(rows.every((p) => typeof p.permission === 'string' && ['granted', 'declined', 'expired'].includes(p.status)));
    const granted = rows.filter((p) => p.status === 'granted').map((p) => p.permission);
    assert.ok(granted.includes('ads_read'), 'ads_read is granted');
    const missing = REQUIRED.filter((p) => !granted.includes(p));
    t.diagnostic('granted: ' + granted.join(', '));
    t.diagnostic('missing required: ' + (missing.join(', ') || 'none') + ' · optional missing: ' + (OPTIONAL.filter((p) => !granted.includes(p)).join(', ') || 'none'));
  });

  await t.test('/me/adaccounts lists the test ad account', async () => {
    const r = await graph('/me/adaccounts', { fields: 'id,name,currency,account_status', limit: 100 });
    assert.ok(Array.isArray(r.data));
    assert.ok(r.data.some((a) => a.id === account), 'test ad account is visible to the token');
  });

  await t.test('pixels (datasets) of the ad account can be listed', async () => {
    const r = await graph('/' + account + '/adspixels', { fields: 'id,name,last_fired_time', limit: 50 });
    assert.ok(Array.isArray(r.data));
    assert.ok(r.data.every((p) => /^\d+$/.test(p.id)));
    t.diagnostic('pixels: ' + r.data.length);
  });

  await t.test('Facebook Pages (and linked Instagram accounts) can be listed', async () => {
    let r;
    try { r = await graph('/me/accounts', { fields: 'id,name,tasks,instagram_business_account{id,username}', limit: 100 }); }
    catch { r = await graph('/me/accounts', { fields: 'id,name,tasks', limit: 100 }); }
    assert.ok(Array.isArray(r.data));
    t.diagnostic('pages: ' + r.data.length + ', with Instagram: ' + r.data.filter((p) => p.instagram_business_account).length);
  });
});
