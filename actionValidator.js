const { isWriteIntent } = require('./actionPlan');

function validateActionPlan(plan) {
  const errors = [];

  if (!plan || typeof plan !== 'object') {
    return { ok: false, errors: ['Missing action plan'] };
  }

  if (!plan.id) errors.push('Missing action ID');
  if (!plan.intent) errors.push('Missing intent');
  if (!isWriteIntent(plan.intent)) errors.push('Intent is not a write action');

  if (Array.isArray(plan.missing) && plan.missing.length) {
    errors.push('Action has missing information');
  }

  if (plan.intent === 'CHANGE_BUDGET') {
    const budget = Number(plan.parameters?.dailyBudget);
    if (!Number.isFinite(budget) || budget <= 0) {
      errors.push('Invalid daily budget');
    }
    if (!plan.target?.campaignId) {
      errors.push('Missing campaign ID');
    }
  }

  if (
    ['PAUSE_CAMPAIGN', 'RESUME_CAMPAIGN', 'EDIT_CAMPAIGN', 'DELETE_CAMPAIGN']
      .includes(plan.intent) &&
    !plan.target?.campaignId
  ) {
    errors.push('Missing campaign ID');
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

module.exports = { validateActionPlan };
