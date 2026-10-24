const { validateActionPlan } = require('./actionValidator');
const metaWrite = require('./metaWrite');
const { verifyAction } = require('./metaVerify');
const { audit } = require('./auditLog');

const handlers = {
  CREATE_CAMPAIGN: metaWrite.createCampaign,
  CREATE_ADSET: metaWrite.createAdSet,
  CREATE_AD: metaWrite.createAd,
  CHANGE_BUDGET: metaWrite.changeBudget,
  PAUSE_CAMPAIGN: metaWrite.pauseCampaign,
  RESUME_CAMPAIGN: metaWrite.resumeCampaign,
  EDIT_CAMPAIGN: metaWrite.editCampaign
};

async function executeApprovedAction(phone, actionPlan) {
  const validation = validateActionPlan(actionPlan);

  if (!validation.ok) {
    audit('action_blocked_validation', {
      phone,
      actionId: actionPlan?.id,
      intent: actionPlan?.intent,
      result: 'BLOCKED',
      reason: validation.errors.join('; ')
    });

    return {
      ok: false,
      blocked: true,
      reason: 'VALIDATION_FAILED',
      errors: validation.errors,
      message: `הפעולה נחסמה בבדיקת בטיחות: ${validation.errors.join(', ')}`
    };
  }

  if (process.env.READ_ONLY !== 'false') {
    audit('action_blocked_read_only', {
      phone,
      actionId: actionPlan.id,
      intent: actionPlan.intent,
      result: 'BLOCKED',
      reason: 'READ_ONLY'
    });

    return {
      ok: false,
      blocked: true,
      reason: 'READ_ONLY',
      message:
        'האישור נקלט ונבדק בהצלחה. מנוע Meta מוכן, אבל READ_ONLY=true ולכן לא בוצע שום שינוי בחשבון הפרסום.'
    };
  }

  const handler = handlers[actionPlan.intent];
  if (!handler) {
    return {
      ok: false,
      blocked: true,
      reason: 'UNSUPPORTED_ACTION',
      message: 'הפעולה עדיין אינה נתמכת במנוע הכתיבה.'
    };
  }

  try {
    const writeResult = await handler(actionPlan);
    const verification = await verifyAction(actionPlan, writeResult);

    audit('action_executed', {
      phone,
      actionId: actionPlan.id,
      intent: actionPlan.intent,
      targetId: writeResult?.id || actionPlan.target?.campaignId,
      result: verification.verified ? 'VERIFIED' : 'UNVERIFIED'
    });

    if (!verification.verified) {
      return {
        ok: false,
        blocked: false,
        reason: 'POST_WRITE_VERIFICATION_FAILED',
        writeResult,
        verification,
        message:
          'Meta קיבל את הפעולה, אבל לא הצלחתי לאמת את המצב החדש. אין לדווח ללקוח שהפעולה הושלמה עד לבדיקה.'
      };
    }

    return {
      ok: true,
      writeResult,
      verification,
      message: 'הפעולה בוצעה ואומתה מחדש מול Meta.'
    };
  } catch (error) {
    audit('action_execution_failed', {
      phone,
      actionId: actionPlan.id,
      intent: actionPlan.intent,
      result: 'FAILED',
      reason: error.response?.data?.error?.message || error.message
    });

    return {
      ok: false,
      blocked: false,
      reason: 'META_WRITE_FAILED',
      message: 'Meta לא השלים את הפעולה. לא דווח שהשינוי בוצע.'
    };
  }
}

module.exports = { executeApprovedAction };
