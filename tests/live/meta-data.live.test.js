'use strict';
// Opt-in live check against a real Meta TEST ad account. Never spends money: every object is
// created PAUSED (and the ad set starts a week from now), read back, then deleted.
// Not part of `npm test` (the glob is tests/*.test.js). Run:
//   META_TEST_ACCESS_TOKEN=... META_TEST_AD_ACCOUNT_ID=act_... META_TEST_PAGE_ID=... \
//   [META_APP_SECRET=...] [META_GRAPH_VERSION=v26.0] npm run test:live
// The token needs ads_management (+ pages_read_engagement / pages_manage_ads for the Page).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const axios = require('axios');

const TOKEN = process.env.META_TEST_ACCESS_TOKEN;
const ACCOUNT = process.env.META_TEST_AD_ACCOUNT_ID;
const PAGE = process.env.META_TEST_PAGE_ID;
const configured = !!(TOKEN && /^act_\d+$/.test(ACCOUNT || '') && /^\d+$/.test(PAGE || ''));
const VERSION = /^v\d+\.\d+$/.test(process.env.META_GRAPH_VERSION || '') ? process.env.META_GRAPH_VERSION : 'v26.0';
const base = 'https://graph.facebook.com/' + VERSION;
const proof = () => (process.env.META_APP_SECRET ? { appsecret_proof: crypto.createHmac('sha256', process.env.META_APP_SECRET).update(TOKEN).digest('hex') } : {});
const form = (body) => new URLSearchParams(Object.entries(body).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]));
const opts = () => ({ headers: { Authorization: 'Bearer ' + TOKEN }, params: proof(), timeout: 30000 });
const explain = (e) => { const m = e?.response?.data?.error; return m ? Error(`Graph ${m.code}/${m.error_subcode || ''}: ${m.message}`) : e; };
const get = (path, params = {}) => axios.get(base + path, { ...opts(), params: { ...params, ...proof() } }).then((r) => r.data).catch((e) => { throw explain(e); });
const post = (path, body) => axios.post(base + path, form(body), opts()).then((r) => r.data).catch((e) => { throw explain(e); });
const del = (id) => axios.delete(base + '/' + id, opts()).then((r) => r.data).catch(() => null);

// A plain 1200x628 PNG (Meta's recommended link-ad size), generated in memory.
function png(w = 1200, h = 628) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x44)]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}

test('live: campaign -> ad set -> creative -> ad are created PAUSED, insights are readable, then deleted', { skip: !configured && 'set META_TEST_ACCESS_TOKEN, META_TEST_AD_ACCOUNT_ID, META_TEST_PAGE_ID', timeout: 180000 }, async () => {
  const write = require('../../metaWrite');
  const created = [];
  const stamp = 'SCORPIO live test ' + new Date().toISOString();
  try {
    const account = await get('/' + ACCOUNT, { fields: 'id,currency,account_status' });
    assert.equal(account.id, ACCOUNT);
    const plan = { intent: 'CREATE_BUNDLE', target: { accountId: ACCOUNT }, parameters: { name: stamp, objective: 'OUTCOME_TRAFFIC', specialAdCategories: [], pageId: PAGE,
      link: 'https://www.example.com/', message: 'Live test, never delivered', headline: 'Test', adSets: [] } };
    // The same bodies production sends (metaWrite), with PAUSED everywhere.
    const campaign = await post('/' + ACCOUNT + '/campaigns', write.campaignBody(plan));
    created.unshift(campaign.id);
    const set = { name: stamp, dailyBudgetMinor: 1000, billingEvent: 'IMPRESSIONS', optimizationGoal: 'LINK_CLICKS', bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
      targeting: { geo_locations: { countries: ['IL'] }, age_min: 25 }, startTime: new Date(Date.now() + 7 * 86400000).toISOString() };
    const adset = await post('/' + ACCOUNT + '/adsets', write.adsetBody(set, campaign.id));
    created.unshift(adset.id);
    const image = await post('/' + ACCOUNT + '/adimages', { bytes: png().toString('base64') });
    const hash = Object.values(image.images || {})[0]?.hash;
    assert.ok(hash, 'image uploaded');
    const creative = await post('/' + ACCOUNT + '/adcreatives', write.creativeBody({ ...plan.parameters, imageHash: hash }));
    created.unshift(creative.id);
    const ad = await post('/' + ACCOUNT + '/ads', { name: stamp, adset_id: adset.id, creative: { creative_id: creative.id }, status: 'PAUSED' });
    created.unshift(ad.id);

    for (const id of [campaign.id, adset.id, ad.id]) {
      const o = await get('/' + id, { fields: 'id,status,effective_status,account_id' });
      assert.equal(o.status, 'PAUSED', id + ' is PAUSED');
      assert.equal('act_' + o.account_id, ACCOUNT);
    }
    // Insights for the new campaign (empty: nothing ran), read the way the dashboard reads them.
    const insights = await get('/' + campaign.id + '/insights', { fields: require('../../metaInsights').FIELDS, date_preset: 'last_7d', use_unified_attribution_setting: true });
    assert.ok(Array.isArray(insights.data));
    const summary = require('../../metaInsights').summarize(insights.data, { currency: account.currency });
    assert.equal(summary.totals.spend, 0, 'no money was spent');
  } finally {
    // Delete ad, creative, ad set, campaign (DELETE /{id}).
    for (const id of created) await del(id);
  }
});
