const axios = require('axios');
const base = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v24.0'}`;
async function get(path, params = {}) {
  if (!process.env.META_ADS_ACCESS_TOKEN) throw Error('META_ADS_ACCESS_TOKEN is not configured');
  return (await axios.get(base() + path, {
    params: { ...params, access_token: process.env.META_ADS_ACCESS_TOKEN },
    timeout: 15000
  })).data;
}
async function getAdAccounts() {
  return get('/me/adaccounts', {
    fields: 'id,name,account_status,currency,timezone_name', limit: 100
  });
}
async function getCampaigns(id) {
  if (!/^act_\d+$/.test(String(id))) throw Error('Invalid ad account ID');
  return get(`/${id}/campaigns`, {
    fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget',
    limit: 100
  });
}
async function getCampaignPerformance(id, date = 'last_7d') {
  if (!/^act_\d+$/.test(String(id))) throw Error('Invalid ad account ID');
  const allowed = new Set(['today','yesterday','last_7d','last_14d','last_30d','this_month','last_month']);
  if (!allowed.has(date)) date = 'last_7d';
  return get(`/${id}/insights`, {
    fields: 'campaign_id,campaign_name,impressions,clicks,spend,ctr,cpc,cpm,actions,website_purchase_roas',
    level: 'campaign', date_preset: date, limit: 100
  });
}
async function executeApprovedAction() {
  return { ok: false, blocked: true, message: 'Write actions are disabled. No Meta changes were made.' };
}
module.exports = { getAdAccounts, getCampaigns, getCampaignPerformance, executeApprovedAction };
