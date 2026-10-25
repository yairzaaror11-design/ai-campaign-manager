const { isWriteIntent } = require('./actionPlan');

const OBJECTIVES = new Set([
  'OUTCOME_AWARENESS',
  'OUTCOME_TRAFFIC',
  'OUTCOME_ENGAGEMENT',
  'OUTCOME_LEADS',
  'OUTCOME_APP_PROMOTION',
  'OUTCOME_SALES'
]);

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function validMinorBudget(parameters) {
  return Number.isSafeInteger(parameters?.dailyBudgetMinor) &&
    parameters.dailyBudgetMinor > 0 &&
    typeof parameters.currency === 'string' &&
    /^[A-Z]{3}$/.test(parameters.currency);
}

function validateActionPlan(plan) {
  const errors = [];

  if (!plan || typeof plan !== 'object') {
    return { ok: false, errors: ['Missing action plan'] };
  }

  if (!plan.id) errors.push('Missing action ID');
  if (!plan.intent) errors.push('Missing intent');
  if (!isWriteIntent(plan.intent)) errors.push('Unsupported write intent');
  if (plan.missing?.length) errors.push('Action has missing information');

  if (plan.target?.accountId && !/^act_\d+$/.test(String(plan.target.accountId))) {
    errors.push('Invalid account ID');
  }

  if (plan.target?.campaignId && !/^\d+$/.test(String(plan.target.campaignId))) {
    errors.push('Invalid campaign ID');
  }

  if (plan.intent === 'CREATE_CAMPAIGN') {
    if (!plan.target?.accountId) errors.push('Missing account ID');
    if (!plan.parameters?.name) errors.push('Missing campaign name');
    if (!OBJECTIVES.has(String(plan.parameters?.objective || ''))) {
      errors.push('Invalid or missing campaign objective');
    }
  }

  if (plan.intent === 'CREATE_ADSET') {
    if (!plan.target?.accountId) errors.push('Missing account ID');
    if (!plan.parameters?.campaignId) errors.push('Missing campaign ID');
    if (!plan.parameters?.name) errors.push('Missing ad set name');
    if (!positiveNumber(plan.parameters?.dailyBudget)) {
      errors.push('Invalid daily budget');
    }
    if (!validMinorBudget(plan.parameters)) {
      errors.push('Missing verified budget in Meta minor units and currency');
    }
  }

  if (plan.intent === 'CREATE_AD') {
    if (!plan.target?.accountId) errors.push('Missing account ID');
    if (!plan.parameters?.adsetId) errors.push('Missing ad set ID');
    if (!plan.parameters?.creativeId) errors.push('Missing creative ID');
    if (!plan.parameters?.name) errors.push('Missing ad name');
  }

  if (plan.intent === 'CHANGE_BUDGET') {
    if (!plan.target?.campaignId) errors.push('Missing campaign ID');
    if (!positiveNumber(plan.parameters?.dailyBudget)) {
      errors.push('Invalid daily budget');
    }
    if (!validMinorBudget(plan.parameters)) {
      errors.push('Missing verified budget in Meta minor units and currency');
    }
  }

  if (
    ['PAUSE_CAMPAIGN', 'RESUME_CAMPAIGN', 'EDIT_CAMPAIGN'].includes(plan.intent) &&
    !plan.target?.campaignId
  ) {
    errors.push('Missing campaign ID');
  }

  return { ok: errors.length === 0, errors };
}

module.exports = { validateActionPlan };
