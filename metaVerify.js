const meta = require('./metaAds');

async function verifyCampaign(campaignId) {
  const campaign = await meta.getCampaign(campaignId);
  return {
    verified: !!campaign?.id,
    campaign
  };
}

async function verifyAction(plan, writeResult) {
  const campaignId =
    writeResult?.id ||
    plan.target?.campaignId ||
    plan.parameters?.campaignId;

  if (!campaignId || !/^\d+$/.test(String(campaignId))) {
    return {
      verified: false,
      reason: 'NO_VERIFIABLE_CAMPAIGN_ID'
    };
  }

  return verifyCampaign(campaignId);
}

module.exports = { verifyAction, verifyCampaign };
