const axios = require('axios');

const base = () =>
  `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v26.0'}`;

function token() {
  if (!process.env.META_ADS_ACCESS_TOKEN) {
    throw Error('META_ADS_ACCESS_TOKEN is not configured');
  }
  return process.env.META_ADS_ACCESS_TOKEN;
}

async function get(path, params = {}) {
  const connection = require('./metaConnection');
  if (connection.context.getStore()) return connection.tenantRead(path, params);
  if (process.env.META_LEGACY_SINGLE_TENANT !== 'true') throw Error('TENANT_CONTEXT_REQUIRED');
  return (
    await axios.get(base() + path, {
      params: { ...params, access_token: token() },
      timeout: 15000
    })
  ).data;
}

function validateAccountId(id) {
  if (!/^act_\d+$/.test(String(id))) throw Error('Invalid ad account ID');
}

async function getAdAccounts() {
  return get('/me/adaccounts', {
    fields: 'id,name,account_status,currency,timezone_name',
    limit: 100
  });
}

async function getCampaigns(id) {
  validateAccountId(id);
  return get(`/${id}/campaigns`, {
    fields:
      'id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time,updated_time',
    limit: 100
  });
}

async function getCampaign(campaignId) {
  if (!/^\d+$/.test(String(campaignId))) throw Error('Invalid campaign ID');
  return get(`/${campaignId}`, {
    fields:
      'id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time,updated_time'
  });
}

async function getCampaignPerformance(id, date = 'last_7d') {
  validateAccountId(id);
  const allowed = new Set([
    'today', 'yesterday', 'last_7d', 'last_14d',
    'last_30d', 'this_month', 'last_month'
  ]);
  if (!allowed.has(date)) date = 'last_7d';

  return get(`/${id}/insights`, {
    fields:
      'campaign_id,campaign_name,impressions,reach,clicks,spend,ctr,cpc,cpm,frequency,actions,cost_per_action_type,website_purchase_roas',
    level: 'campaign',
    date_preset: date,
    limit: 100
  });
}

async function getCampaignInsights(campaignId, date = 'last_7d') {
  if (!/^\d+$/.test(String(campaignId))) throw Error('Invalid campaign ID');
  const allowed = new Set([
    'today', 'yesterday', 'last_7d', 'last_14d',
    'last_30d', 'this_month', 'last_month'
  ]);
  if (!allowed.has(date)) date = 'last_7d';

  return get(`/${campaignId}/insights`, {
    fields:
      'campaign_id,campaign_name,impressions,reach,clicks,spend,ctr,cpc,cpm,frequency,actions,cost_per_action_type',
    date_preset: date
  });
}

module.exports = {
  getAdAccounts,
  getCampaigns,
  getCampaign,
  getCampaignPerformance,
  getCampaignInsights
};
