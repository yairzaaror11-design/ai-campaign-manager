const crypto = require('crypto');

const WRITE_INTENTS = new Set([
  'CREATE_CAMPAIGN',
  'CREATE_ADSET',
  'CREATE_AD',
  'CHANGE_BUDGET',
  'PAUSE_CAMPAIGN',
  'RESUME_CAMPAIGN',
  'EDIT_CAMPAIGN',
  'DELETE_CAMPAIGN',
  'UPLOAD_IMAGE',
  'UPLOAD_VIDEO',
  'OPTIMIZE_CAMPAIGN'
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
    id: crypto.randomBytes(3).toString('hex').toUpperCase(),
    intent: String(intent || 'UNKNOWN').toUpperCase(),
    summary: String(summary || ''),
    target,
    parameters,
    missing: Array.isArray(missing) ? missing : [],
    confidence,
    requiresApproval: isWriteIntent(intent),
    executable: false,
    readOnlyBlocked: true,
    createdAt: new Date().toISOString()
  };
}

function formatActionPlan(plan) {
  const lines = [
    'פעולה מוצעת',
    plan.summary || plan.intent
  ];

  if (plan.target?.accountName) {
    lines.push(`חשבון: ${plan.target.accountName}`);
  }

  if (plan.target?.campaignName) {
    lines.push(`קמפיין: ${plan.target.campaignName}`);
  }

  if (plan.parameters?.dailyBudget != null) {
    lines.push(`תקציב יומי מוצע: ${plan.parameters.dailyBudget}`);
  }

  if (plan.missing.length) {
    lines.push(`חסר: ${plan.missing.join(', ')}`);
  }

  lines.push('');
  lines.push('לא בוצע שום שינוי ב-Meta.');
  lines.push(
    'מנגנון הביצוע והאישור יופעל בשלב הבא לאחר בדיקות.'
  );

  return lines.join('\n');
}

module.exports = {
  WRITE_INTENTS,
  isWriteIntent,
  createActionPlan,
  formatActionPlan
};
