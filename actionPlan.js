const crypto = require('crypto');

const WRITE_INTENTS = new Set([
  'CREATE_CAMPAIGN',
  'CREATE_ADSET',
  'CREATE_AD',
  'CREATE_CREATIVE',
  'UPLOAD_IMAGE',
  'CREATE_BUNDLE',
  'ACTIVATE_BUNDLE',
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
  const p=plan.parameters || {},t=plan.target || {};
  return ['*פעולה מוצעת — נדרש אישור מפורש*',plan.summary || plan.intent,
    'פעולה: '+plan.intent,
    'חשבון: '+(t.accountName || '')+' ('+(t.accountId || 'לא נבחר')+')',
    'קמפיין/מודעה: '+(t.campaignName || p.name || t.campaignId || 'לא הוגדר'),
    'מטרה: '+(p.objective || plan.review?.objective || 'לפי הקמפיין הקיים'),
    'קהל: '+(p.adSets ? JSON.stringify(p.adSets) : p.targeting ? JSON.stringify(p.targeting) : 'ללא שינוי קהל'),
    ...(plan.review?.adSets ? ['פרטי קהל, תקציב ביחידות משנה ותאריכים ב־'+plan.review.currency+': '+JSON.stringify(plan.review.adSets)] : []),
    ...(p.adsetIds ? ['קבוצות מודעות: '+p.adsetIds.join(', '),'מודעות: '+p.adIds.join(', ')] : []),
    'תקציב יומי: '+(p.dailyBudget!==undefined ? p.dailyBudget+' '+p.currency : 'ללא שינוי תקציב'),
    'התחלה: '+(p.startTime || 'ללא שינוי'),
    'סיום: '+(p.endTime || 'ללא שינוי'),
    'גרסת פעולה: '+require('./approvalPolicy').planHash(plan).slice(0,12),
    'יצירה מתחילה במצב PAUSED. הפעלה דורשת אישור נפרד.'
  ].join('\n');
}

module.exports = {
  WRITE_INTENTS,
  isWriteIntent,
  createActionPlan,
  formatActionPlan
};
