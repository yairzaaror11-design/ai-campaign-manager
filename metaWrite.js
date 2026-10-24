const axios = require('axios');

const base = () =>
  `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v26.0'}`;

function assertWriteEnabled() {
  if (process.env.READ_ONLY !== 'false') {
    throw Error('READ_ONLY_BLOCK');
  }
  if (!process.env.META_ADS_ACCESS_TOKEN) {
    throw Error('META_ADS_ACCESS_TOKEN is not configured');
  }
}

async function post(path, data = {}) {
  assertWriteEnabled();

  return (
    await axios.post(
      base() + path,
      new URLSearchParams({
        ...Object.fromEntries(
          Object.entries(data)
            .filter(([, value]) => value !== undefined && value !== null)
            .map(([key, value]) => [
              key,
              typeof value === 'object' ? JSON.stringify(value) : String(value)
            ])
        ),
        access_token: process.env.META_ADS_ACCESS_TOKEN
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000
      }
    )
  ).data;
}

function accountPath(accountId, edge) {
  if (!/^act_\d+$/.test(String(accountId))) throw Error('Invalid account ID');
  return `/${accountId}/${edge}`;
}

function objectPath(id) {
  if (!/^\d+$/.test(String(id))) throw Error('Invalid Meta object ID');
  return `/${id}`;
}

async function createCampaign(plan) {
  const p = plan.parameters;
  return post(accountPath(plan.target.accountId, 'campaigns'), {
    name: p.name,
    objective: p.objective,
    status: 'PAUSED',
    special_ad_categories: p.specialAdCategories || []
  });
}

async function createAdSet(plan) {
  const p = plan.parameters;
  return post(accountPath(plan.target.accountId, 'adsets'), {
    name: p.name,
    campaign_id: p.campaignId,
    daily_budget: p.dailyBudgetMinor,
    billing_event: p.billingEvent,
    optimization_goal: p.optimizationGoal,
    bid_strategy: p.bidStrategy,
    targeting: p.targeting,
    promoted_object: p.promotedObject,
    start_time: p.startTime,
    end_time: p.endTime,
    status: 'PAUSED'
  });
}

async function createAd(plan) {
  const p = plan.parameters;
  return post(accountPath(plan.target.accountId, 'ads'), {
    name: p.name,
    adset_id: p.adsetId,
    creative: { creative_id: p.creativeId },
    status: 'PAUSED'
  });
}

async function changeBudget(plan) {
  return post(objectPath(plan.target.campaignId), {
    daily_budget: plan.parameters.dailyBudgetMinor
  });
}

async function pauseCampaign(plan) {
  return post(objectPath(plan.target.campaignId), { status: 'PAUSED' });
}

async function resumeCampaign(plan) {
  return post(objectPath(plan.target.campaignId), { status: 'ACTIVE' });
}

async function editCampaign(plan) {
  const allowed = {};
  if (plan.parameters.name) allowed.name = plan.parameters.name;
  if (plan.parameters.status) allowed.status = plan.parameters.status;
  return post(objectPath(plan.target.campaignId), allowed);
}

module.exports = {
  createCampaign,
  createAdSet,
  createAd,
  changeBudget,
  pauseCampaign,
  resumeCampaign,
  editCampaign
};
