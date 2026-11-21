'use strict';
// Ad performance numbers (spend, impressions, clicks, reach, leads, cost per lead) come only
// from the Meta Ads Insights API of the business's own ad account. Sales and revenue come
// only from our CRM (businessReport). Nothing here is estimated or filled in.
//
// Graph API: GET /act_{id}/insights, level=campaign
// (developers.facebook.com/docs/marketing-api/reference/ad-account/insights):
// * use_unified_attribution_setting=true -> the same attribution as Ads Manager shows
//   (the 7d_view / 28d_view windows stopped returning data on 2026-01-12, so none are requested);
// * spend is in the ad account currency (account_currency), never converted here;
// * leads use ONE action type, never a sum: "lead" (all leads) when present, otherwise
//   on-Facebook leads, otherwise pixel leads. Adding them would count a lead twice.
// Results are cached per business/account/period (meta_insights_cache); clients.last_insights_sync
// says when Meta was last read, for the connections screen.
const db = require('./db');
const { logger } = require('./logger');

const FIELDS = 'campaign_id,campaign_name,account_currency,spend,impressions,clicks,reach,actions,date_start,date_stop';
const LEAD_TYPES = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'];
const MAX_AGE_MS = 15 * 60 * 1000;

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
function leadsOf(row) {
  if (!Array.isArray(row?.actions)) return 0;
  for (const type of LEAD_TYPES) {
    const item = row.actions.find((a) => a?.action_type === type);
    if (item) return num(item.value);
  }
  return 0;
}
const round2 = (n) => Math.round(n * 100) / 100;

// Pure mapping from Insights rows to what the dashboard and reports show.
function summarize(rows, { currency = null } = {}) {
  const campaigns = [];
  for (const row of rows || []) {
    if (!/^\d{1,40}$/.test(String(row.campaign_id || ''))) continue;
    const spend = num(row.spend), leads = leadsOf(row);
    campaigns.push({ id: String(row.campaign_id), name: String(row.campaign_name || '').slice(0, 80), spend: round2(spend),
      impressions: num(row.impressions), clicks: num(row.clicks), reach: num(row.reach), leads,
      costPerLead: leads > 0 ? round2(spend / leads) : null });
  }
  const sum = (k) => campaigns.reduce((t, c) => t + c[k], 0);
  const spend = round2(sum('spend')), leads = sum('leads'), impressions = sum('impressions'), clicks = sum('clicks');
  return {
    currency: currency || rows?.find((r) => /^[A-Z]{3}$/.test(r.account_currency || ''))?.account_currency || null,
    totals: { spend, impressions, clicks, leads, ctr: impressions > 0 ? clicks / impressions : null, costPerLead: leads > 0 ? round2(spend / leads) : null },
    campaigns
  };
}

async function fetchRows(accountId, period, read) {
  const range = require('./reportPeriod').validate(period);
  const rows = []; let after;
  for (let page = 0; page < 20; page++) {
    const r = await read('/' + accountId + '/insights', { level: 'campaign', fields: FIELDS, use_unified_attribution_setting: true, ...range, limit: 100, ...(after ? { after } : {}) });
    rows.push(...(r.data || []));
    if (!r.paging?.next) return rows;
    after = r.paging?.cursors?.after;
    if (typeof after !== 'string' || after.length > 4096) throw Error('INVALID_REPORT_CURSOR');
  }
  throw Error('REPORT_PAGE_LIMIT');
}

const periodKey = (period) => (typeof period === 'string' ? period : 'range:' + period.since + ':' + period.until);

// Account insights for a period, from cache when fresh. null when no ad account is connected.
async function accountInsights(clientId, period = 'last_7d', { maxAgeMs = MAX_AGE_MS, force = false } = {}) {
  const meta = require('./metaConnection');
  return meta.context.run(String(clientId), async () => {
    const c = await meta.credentials(clientId);
    if (!c?.meta_ad_account_id) return null;
    const account = c.meta_ad_account_id, key = periodKey(period);
    if (!force) {
      const cached = (await db.query('SELECT payload,synced_at FROM meta_insights_cache WHERE client_id=$1 AND account_id=$2 AND period=$3 AND synced_at>NOW()-make_interval(secs=>$4::int)',
        [clientId, account, key, Math.floor(maxAgeMs / 1000)])).rows[0];
      if (cached) return { ...cached.payload, syncedAt: new Date(cached.synced_at).toISOString(), cached: true };
    }
    const rows = await fetchRows(account, period, (path, params) => meta.tenantRead(path, params));
    let currency = rows.find((r) => /^[A-Z]{3}$/.test(r.account_currency || ''))?.account_currency || null;
    if (!currency) currency = (await meta.graph('/' + account, c.token, { fields: 'currency' }).catch(() => ({}))).currency || null;
    const payload = { accountId: account, period: key, attribution: 'unified', ...summarize(rows, { currency }) };
    const saved = (await db.query(`INSERT INTO meta_insights_cache(client_id,account_id,period,payload,synced_at) VALUES($1,$2,$3,$4::jsonb,NOW())
      ON CONFLICT(client_id,account_id,period) DO UPDATE SET payload=EXCLUDED.payload,synced_at=NOW() RETURNING synced_at`, [clientId, account, key, JSON.stringify(payload)])).rows[0];
    await db.query('UPDATE clients SET last_insights_sync=$2 WHERE id=$1', [clientId, saved.synced_at]);
    return { ...payload, syncedAt: new Date(saved.synced_at).toISOString(), cached: false };
  });
}

// Never throws: null when the account is missing or Meta cannot be read right now.
async function safeAccountInsights(clientId, period, options) {
  try { return await accountInsights(clientId, period, options); } catch (error) {
    logger.warn('Insights not read', { reason: /^[A-Z_]+$/.test(error?.message || '') ? error.message : 'INSIGHTS_READ_FAILED' });
    return null;
  }
}

async function lastSync(clientId) {
  const r = (await db.query('SELECT last_insights_sync FROM clients WHERE id=$1', [clientId])).rows[0];
  return r?.last_insights_sync ? new Date(r.last_insights_sync).toISOString() : null;
}

module.exports = { FIELDS, LEAD_TYPES, leadsOf, summarize, fetchRows, accountInsights, safeAccountInsights, lastSync };
