'use strict';
// The same approvals the owner gets on WhatsApp, available in the dashboard.
// Approving here goes through the identical consume -> execute -> verify path.
const db = require('./db');
const ID = /^[A-Za-z0-9-]{6,64}$/;
const REASONS = { NOT_FOUND: 'האישור כבר אינו פעיל.', EXPIRED: 'תוקף האישור פג. אפשר לבקש מהסוכן להכין את הפעולה מחדש.', ALREADY_USED: 'האישור הזה כבר טופל.', RATE_LIMITED: 'יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.', STALE_PLAN: 'החשבון או הפעולה השתנו מאז ההכנה. צריך להכין את הפעולה מחדש.' };

async function pending(clientId) {
  const rows = (await db.query(`SELECT a.action_id, a.expires_at, p.payload FROM approvals a JOIN action_plans p ON p.id=a.action_id AND p.client_id=a.client_id
    WHERE a.client_id=$1 AND a.status='PENDING' AND a.expires_at>NOW() AND p.status='PROPOSED' ORDER BY a.created_at DESC LIMIT 10`, [clientId])).rows;
  const { formatActionPlan } = require('./actionPlan');
  return rows.map((r) => ({ actionId: r.action_id, intent: r.payload.intent, task: !!r.payload.taskId, summary: formatActionPlan(r.payload), expiresAt: r.expires_at,
    startsSpending: ['ACTIVATE_BUNDLE', 'RESUME_CAMPAIGN'].includes(r.payload.intent) }));
}

async function approve(clientId, actionId) {
  if (!ID.test(String(actionId || ''))) throw Error('INVALID_APPROVAL');
  const task = await require('./taskAgent').active(clientId);
  const step = task?.state?.steps?.find((s) => s.status === 'WAITING_APPROVAL' && s.result?.approval?.actionId === actionId);
  if (step) {
    // Task approvals continue the task exactly as the WhatsApp button does.
    const code = require('./metaConnection').decrypt(step.result.approval.codeCiphertext, clientId);
    const r = await require('./taskAgent').send(clientId, { message: 'אשר ' + code, requestId: 'portal-approve:' + actionId, channel: 'PORTAL' });
    return { ok: true, reply: r?.reply || 'האישור נקלט.' };
  }
  const consumed = await require('./approvalEngine').consumeActionForClient(clientId, actionId);
  if (!consumed.ok) return { ok: false, reply: REASONS[consumed.reason] || 'לא ניתן לאשר את הפעולה.' };
  const result = await require('./actionExecutor').executeApprovedForClient(clientId, consumed.approval.actionPlan);
  return { ok: !!result.ok, reply: result.ok ? 'הפעולה בוצעה ואומתה מול Meta.' : result.message || 'הפעולה לא בוצעה.' };
}

async function reject(clientId, actionId) {
  if (!ID.test(String(actionId || ''))) throw Error('INVALID_APPROVAL');
  const task = await require('./taskAgent').active(clientId);
  if (task?.state?.steps?.some((s) => s.status === 'WAITING_APPROVAL' && s.result?.approval?.actionId === actionId)) {
    await require('./taskAgent').cancel(clientId);
    return { ok: true, reply: 'המשימה בוטלה. שום פעולה לא בוצעה ב־Meta.' };
  }
  await db.transaction(async (tx) => {
    await tx("UPDATE approvals SET status='CANCELLED' WHERE client_id=$1 AND action_id=$2 AND status='PENDING'", [clientId, actionId]);
    await tx("UPDATE action_plans SET status='CANCELLED' WHERE client_id=$1 AND id=$2 AND status='PROPOSED'", [clientId, actionId]);
  });
  return { ok: true, reply: 'הפעולה בוטלה ולא בוצעה.' };
}

// Pause or resume a campaign: prepared as an approval, never executed directly.
async function prepareCampaignAction(clientId, campaignId, kind) {
  if (!/^\d{1,40}$/.test(String(campaignId || '')) || !['PAUSE', 'RESUME'].includes(kind)) throw Error('INVALID_CAMPAIGN_ACTION');
  const task = await require('./taskAgent').active(clientId);
  if (task?.state?.steps?.some((s) => s.status === 'WAITING_APPROVAL')) return { ok: false, reply: 'יש משימה שמחכה לאישור שלך. סיימו או בטלו אותה קודם, כדי ששום אישור לא יידרס.' };
  const c = await require('./metaConnection').credentials(clientId);
  if (!c.meta_ad_account_id) return { ok: false, reply: 'צריך קודם לבחור חשבון מודעות.' };
  const campaign = await require('./metaAds').getCampaign(campaignId);
  const { createActionPlan } = require('./actionPlan');
  const intent = kind === 'PAUSE' ? 'PAUSE_CAMPAIGN' : 'RESUME_CAMPAIGN';
  // A copy made by "שכפל קמפיין מנצח" is paused at every level: activating it turns on
  // exactly the copied ad sets and ads, the same way a new campaign is activated.
  const copy = kind === 'RESUME' ? (await db.query(`SELECT execution_result->'objects' AS o FROM action_plans WHERE client_id=$1 AND intent='DUPLICATE_CAMPAIGN' AND status='VERIFIED'
    AND execution_result->'objects'->>'campaignId'=$2 ORDER BY updated_at DESC LIMIT 1`, [clientId, String(campaignId)])).rows[0]?.o : null;
  let approval;
  try {
    approval = await require('./approvalEngine').createApprovalForClient(clientId, copy?.adsetIds?.length && copy?.adIds?.length
      ? createActionPlan({ intent: 'ACTIVATE_BUNDLE', summary: 'הפעלת העותק "' + String(campaign.name || campaignId).slice(0, 80) + '"',
        target: { accountId: c.meta_ad_account_id, campaignId: String(campaignId) }, parameters: { adsetIds: copy.adsetIds.map(String), adIds: copy.adIds.map(String) } })
      : createActionPlan({ intent,
      summary: (kind === 'PAUSE' ? 'כיבוי הקמפיין ' : 'הפעלה מחדש של הקמפיין ') + '"' + String(campaign.name || campaignId).slice(0, 80) + '"',
      target: { accountId: c.meta_ad_account_id, campaignId: String(campaignId) } }));
  } catch (error) { if (error.message === 'SPEND_CAP_EXCEEDED') return { ok: false, reply: error.reply }; throw error; }
  return { ok: true, actionId: approval.actionId };
}

module.exports = { pending, approve, reject, prepareCampaignAction };
