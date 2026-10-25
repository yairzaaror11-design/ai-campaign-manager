'use strict';
const { getOrCreateClient } = require('./clientStore');
const { latest, save } = require('./lifecycleStore');
const { approveStage } = require('./campaignLifecycle');
const { runOne } = require('./workflowWorker');

async function handleLifecycleMessage(phone, text) {
  if (!/^\/campaign-(?:status|draft|activate)\b/.test(text)) return { handled: false };
  const client = await getOrCreateClient(phone);
  const row = await latest(client.id);
  if (!row) return { handled: true, reply: 'לא נמצאה תוכנית קמפיין שממתינה לאישור.' };
  let flow = row.payload;
  if (String(client.id) !== flow.tenantId || client.meta_ad_account_id !== flow.plan.brief.adAccountId) {
    return { handled: true, reply: 'אין הרשאה לחשבון הפרסום בתוכנית זו.' };
  }
  if (text === '/campaign-status') return { handled: true, reply: 'סטטוס: ' + flow.status + '\nPlan hash: ' + flow.planHash + '\nאסטרטגיה: ' + JSON.stringify(flow.plan.strategy) + '\nקריאייטיב: ' + JSON.stringify(flow.plan.creatives) + '\nאובייקטים: ' + JSON.stringify(flow.objects || {}) };
  const match = text.match(/^\/campaign-(draft|activate)\s+([a-f0-9]{64})$/);
  if (!match) return { handled: true, reply: 'נדרש מזהה תוכנית מדויק. שלח /campaign-status.' };
  if (process.env.MOCK_META_ENABLED !== 'true') return { handled: true, reply: 'יצירת קמפיינים נעולה. ניתן לבדוק רק עם MOCK_META_ENABLED=true בסביבה מבודדת.' };
  const stage = match[1] === 'draft' ? 'CREATE_PAUSED' : 'ACTIVATE';
  try {
    flow = approveStage(flow, stage, String(client.id), match[2]);
    // Persist approval before attempting any external side effect.
    let revision = await save(client.id, flow, row.revision);
    const result = await runOne();
    const updated = await latest(client.id);
    flow = updated?.payload || flow;
    return { handled: true, reply: 'תוצאת סביבת Mock בלבד: ' + result.status + '\n' + JSON.stringify(flow.objects || {}) + (flow.status === 'AWAITING_ACTIVATION_APPROVAL' ? '\nלהפעלה נדרש אישור נפרד: /campaign-activate ' + flow.planHash : '') };
  } catch (error) { return { handled: true, reply: 'הפעולה נעצרה: ' + error.message }; }
}
module.exports = { handleLifecycleMessage };
