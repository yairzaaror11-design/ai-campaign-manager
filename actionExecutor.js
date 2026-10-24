const { validateActionPlan } = require('./actionValidator');
const { audit } = require('./auditLog');

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
      errors: validation.errors
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
        'האישור נקלט ונבדק בהצלחה, אבל המערכת עדיין במצב READ_ONLY ולכן לא בוצע שום שינוי ב-Meta.'
    };
  }

  // Intentionally locked until Stage 3 implements verified Meta write methods.
  return {
    ok: false,
    blocked: true,
    reason: 'WRITE_ENGINE_NOT_IMPLEMENTED',
    message:
      'מנוע הכתיבה ל-Meta עדיין לא הופעל. לא בוצע שום שינוי.'
  };
}

module.exports = { executeApprovedAction };
