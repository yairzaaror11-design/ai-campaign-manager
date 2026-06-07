const axios = require('axios');
const { logger } = require('../utils/logger');

const META_BASE   = 'https://graph.facebook.com/v19.0';
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
const WABA_ID      = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

// Default performance fields
const INSIGHT_FIELDS = [
  'impressions', 'clicks', 'spend', 'reach', 'frequency',
  'ctr', 'cpc', 'cpm', 'cpp',
  'actions', 'action_values',
  'cost_per_action_type',
  'website_purchase_roas',
  'conversions', 'conversion_values'
].join(',');

/**
 * Fetch all ad accounts the token has access to
 */
async function getAdAccounts() {
  try {
    const response = await metaGet('/me/adaccounts', {
      fields: 'id,name,account_status,currency,timezone_name,amount_spent,balance,spend_cap,business',
      limit: 100
    });

    const accounts = response.data || [];
    return {
      total: accounts.length,
      accounts: accounts.map(acc => ({
        id:         acc.id,
        name:       acc.name,
        status:     accountStatusLabel(acc.account_status),
        currency:   acc.currency,
        timezone:   acc.timezone_name,
        spent:      formatMoney(acc.amount_spent, acc.currency),
        balance:    formatMoney(acc.balance, acc.currency),
        business:   acc.business?.name || 'Personal'
      }))
    };
  } catch (err) {
    logger.error('getAdAccounts error', { error: err.message });
    return { error: err.message, accounts: [] };
  }
}

/**
 * Get campaigns for an account
 */
async function getCampaigns(accountId, statusFilter = 'ALL') {
  try {
    const params = {
      fields: 'id,name,status,objective,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time,created_time',
      limit: 50
    };

    if (statusFilter !== 'ALL') {
      params.effective_status = JSON.stringify([statusFilter]);
    }

    const response = await metaGet(`/${accountId}/campaigns`, params);
    const campaigns = response.data || [];

    return {
      account_id: accountId,
      total: campaigns.length,
      campaigns: campaigns.map(c => ({
        id:              c.id,
        name:            c.name,
        status:          c.status,
        objective:       c.objective,
        daily_budget:    c.daily_budget  ? formatMicro(c.daily_budget)  : null,
        lifetime_budget: c.lifetime_budget ? formatMicro(c.lifetime_budget) : null,
        budget_remaining: c.budget_remaining ? formatMicro(c.budget_remaining) : null,
        start_time:      c.start_time,
        stop_time:       c.stop_time || 'No end date'
      }))
    };
  } catch (err) {
    logger.error('getCampaigns error', { error: err.message });
    return { error: err.message, campaigns: [] };
  }
}

/**
 * Get campaign or account performance insights
 */
async function getCampaignPerformance(accountId, campaignId, datePreset = 'last_7d') {
  try {
    const endpoint = campaignId
      ? `/${campaignId}/insights`
      : `/${accountId}/insights`;

    const response = await metaGet(endpoint, {
      fields: INSIGHT_FIELDS,
      date_preset: datePreset,
      level: campaignId ? 'campaign' : 'account',
      limit: 20
    });

    const insights = response.data || [];

    if (!insights.length) {
      return { message: 'No performance data for this period.', insights: [] };
    }

    return {
      date_preset: datePreset,
      insights: insights.map(i => ({
        campaign_id:   i.campaign_id,
        campaign_name: i.campaign_name,
        impressions:   Number(i.impressions || 0).toLocaleString(),
        clicks:        Number(i.clicks || 0).toLocaleString(),
        spend:         `$${Number(i.spend || 0).toFixed(2)}`,
        reach:         Number(i.reach || 0).toLocaleString(),
        ctr:           `${Number(i.ctr || 0).toFixed(2)}%`,
        cpc:           `$${Number(i.cpc || 0).toFixed(2)}`,
        cpm:           `$${Number(i.cpm || 0).toFixed(2)}`,
        roas:          extractROAS(i.website_purchase_roas),
        conversions:   extractConversions(i.actions),
        date_start:    i.date_start,
        date_stop:     i.date_stop
      }))
    };
  } catch (err) {
    logger.error('getCampaignPerformance error', { error: err.message });
    return { error: err.message, insights: [] };
  }
}

/**
 * Get ad sets for a campaign
 */
async function getAdSets(campaignId) {
  try {
    const response = await metaGet(`/${campaignId}/adsets`, {
      fields: 'id,name,status,daily_budget,lifetime_budget,targeting,optimization_goal,billing_event,bid_amount,start_time,end_time',
      limit: 50
    });

    const adsets = response.data || [];

    return {
      campaign_id: campaignId,
      total: adsets.length,
      adsets: adsets.map(a => ({
        id:              a.id,
        name:            a.name,
        status:          a.status,
        daily_budget:    a.daily_budget    ? formatMicro(a.daily_budget)    : 'N/A',
        lifetime_budget: a.lifetime_budget ? formatMicro(a.lifetime_budget) : 'N/A',
        optimization:    a.optimization_goal,
        billing:         a.billing_event,
        bid:             a.bid_amount ? formatMicro(a.bid_amount) : 'Auto'
      }))
    };
  } catch (err) {
    logger.error('getAdSets error', { error: err.message });
    return { error: err.message, adsets: [] };
  }
}

/**
 * Generate a comprehensive performance report
 */
async function generateReport(accountId, campaignId, datePreset = 'last_30d') {
  try {
    const [performance, campaigns] = await Promise.all([
      getCampaignPerformance(accountId, campaignId, datePreset),
      campaignId ? Promise.resolve(null) : getCampaigns(accountId, 'ALL')
    ]);

    // Get breakdown by day for trends
    const endpoint = campaignId ? `/${campaignId}/insights` : `/${accountId}/insights`;
    const dailyResponse = await metaGet(endpoint, {
      fields: 'impressions,clicks,spend,ctr,cpc',
      date_preset: datePreset,
      time_increment: 1,
      limit: 30
    });

    const dailyData = (dailyResponse.data || []).map(d => ({
      date:        d.date_start,
      spend:       Number(d.spend || 0).toFixed(2),
      clicks:      d.clicks,
      impressions: d.impressions,
      ctr:         Number(d.ctr || 0).toFixed(2)
    }));

    // Calculate totals and averages
    const totals = dailyData.reduce((acc, d) => {
      acc.spend  += Number(d.spend);
      acc.clicks += Number(d.clicks || 0);
      acc.impressions += Number(d.impressions || 0);
      return acc;
    }, { spend: 0, clicks: 0, impressions: 0 });

    return {
      report_type:  campaignId ? 'Campaign Report' : 'Account Report',
      date_range:   datePreset,
      generated_at: new Date().toISOString(),
      summary: {
        total_spend:       `$${totals.spend.toFixed(2)}`,
        total_clicks:      totals.clicks.toLocaleString(),
        total_impressions: totals.impressions.toLocaleString(),
        avg_ctr:           totals.impressions > 0
                           ? `${((totals.clicks / totals.impressions) * 100).toFixed(2)}%`
                           : 'N/A',
        avg_cpc:           totals.clicks > 0
                           ? `$${(totals.spend / totals.clicks).toFixed(2)}`
                           : 'N/A'
      },
      performance: performance.insights || [],
      daily_trend: dailyData,
      campaigns:   campaigns?.campaigns || []
    };
  } catch (err) {
    logger.error('generateReport error', { error: err.message });
    return { error: err.message };
  }
}

/**
 * Execute an approved budget change
 */
async function executeApprovedAction(pending) {
  const { action, campaignId, adSetId, newBudget, reason } = pending;

  try {
    if (action === 'update_budget') {
      const id = adSetId || campaignId;
      const budgetField = adSetId ? 'daily_budget' : 'daily_budget';
      // Meta API uses cents (×100) for budget
      const budgetCents = Math.round(newBudget * 100);

      await axios.post(
        `${META_BASE}/${id}`,
        { [budgetField]: budgetCents },
        { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
      );

      return `✅ *Budget Updated Successfully!*\n\n• Entity: ${id}\n• New Budget: $${newBudget}\n• Reason: ${reason || 'User approved'}\n• Updated at: ${new Date().toLocaleString()}`;
    }

    return '⚠️ Unknown action type.';
  } catch (err) {
    logger.error('executeApprovedAction error', { error: err.message });
    return `❌ Failed to execute action: ${err.message}`;
  }
}

// ── Helpers ───────────────────────────────────────────────

async function metaGet(endpoint, params = {}) {
  const response = await axios.get(`${META_BASE}${endpoint}`, {
    params: { access_token: ACCESS_TOKEN, ...params }
  });
  return response.data;
}

function formatMicro(microValue) {
  // Meta returns budgets in cents (×100)
  return `$${(Number(microValue) / 100).toFixed(2)}`;
}

function formatMoney(value, currency = 'USD') {
  const amount = Number(value) / 100; // Cents to dollars
  return `${currency} ${amount.toFixed(2)}`;
}

function accountStatusLabel(status) {
  const labels = { 1: 'Active', 2: 'Disabled', 3: 'Unsettled', 7: 'Pending Review', 9: 'In Grace Period', 100: 'Pending Closure', 101: 'Closed', 201: 'Any Active', 202: 'Any Closed' };
  return labels[status] || `Status ${status}`;
}

function extractROAS(roasData) {
  if (!roasData || !Array.isArray(roasData)) return 'N/A';
  const purchase = roasData.find(r => r.action_type === 'omni_purchase' || r.action_type === 'purchase');
  return purchase ? `${Number(purchase.value).toFixed(2)}x` : 'N/A';
}

function extractConversions(actions) {
  if (!actions || !Array.isArray(actions)) return 0;
  const purchase = actions.find(a => a.action_type === 'purchase' || a.action_type === 'omni_purchase');
  return purchase ? Number(purchase.value) : 0;
}

module.exports = {
  getAdAccounts,
  getCampaigns,
  getCampaignPerformance,
  getAdSets,
  generateReport,
  executeApprovedAction
};
