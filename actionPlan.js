const crypto = require('crypto');

const WRITE_INTENTS = new Set([
  'CREATE_CAMPAIGN',
  'CREATE_ADSET',
  'CREATE_AD',
  'CHANGE_BUDGET',
  'PAUSE_CAMPAIGN',
  'RESUME_CAMPAIGN',
  'EDIT_CAMPAIGN'
]);

function isWriteIntent(intent) {
  return WRITE_INTENTS.has(String(intent || '').toUpperCase());
}

function createActionPlan({
  intent,
  summary,
  target = {},
  parameters = {},
  missing = [],
  confidence = null
}) {
  return {
    id: crypto.randomBytes(6).toString('hex').toUpperCase(),
    intent: String(intent || 'UNKNOWN').toUpperCase(),
    summary: String(summary || ''),
    target,
    parameters,
    missing: Array.isArray(missing) ? missing : [],
    confidence,
    requiresApproval: isWriteIntent(intent),
    createdAt: new Date().toISOString()
  };
}

function formatActionPlan(plan) {
  const lines = ['*פעולה מוצעת*', plan.summary || plan.intent];

  if (plan.target?.accountName) lines.push(`חשבון: ${plan.target.accountName}`);
  if (plan.target?.campaignName) lines.push(`קמפיין: ${plan.target.campaignName}`);

  if (plan.parameters?.dailyBudget != null) {
    const currency = plan.parameters.currency ? ` ${plan.parameters.currency}` : '';
    lines.push(`תקציב יומי מוצע: ${plan.parameters.dailyBudget}${currency}`);
  }

  if (plan.parameters?.status) lines.push(`סטטוס מוצע: ${plan.parameters.status}`);
  if (plan.missing.length) lines.push(`חסר לפני אישור: ${plan.missing.join(', ')}`);

  return lines.join('\n');
}

module.exports = {
  WRITE_INTENTS,
  isWriteIntent,
  createActionPlan,
  formatActionPlan
};
