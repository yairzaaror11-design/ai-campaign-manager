'use strict';
// "החזר למצב הקודם": next to each budget change, pause and activation in "מה עשיתי ולמה"
// (dashboard + WhatsApp), valid for 24 hours. The undo is a new, ordinary action plan and goes
// through the same rules as any other action: protective undos (pause, lower budget) may run
// alone only if the work agreement allows it; anything that spends again (resume, raise budget,
// re-activate) always waits for the owner's approval.
const db = require('./db');
const copy = require('./onboardingCopy');

const INTENTS = ['CHANGE_BUDGET', 'PAUSE_CAMPAIGN', 'RESUME_CAMPAIGN', 'ACTIVATE_BUNDLE'];
const WINDOW_HOURS = 24;
const ID = /^[A-Za-z0-9-]{6,64}$/;

// The opposite action, or null when it cannot be undone in one tap.
function reverse(plan) {
  const t = plan?.target || {}, name = t.campaignName || '';
  if (!t.accountId || !t.campaignId) return null;
  const target = { accountId: t.accountId, campaignId: String(t.campaignId), ...(name ? { campaignName: name } : {}) };
  const label = name ? ` "${String(name).slice(0, 80)}"` : '';
  if (plan.intent === 'CHANGE_BUDGET') {
    const was = Number(plan.review?.currentDailyBudgetMinor);
    if (!Number.isFinite(was) || was <= 0) return null;
    return { intent: 'CHANGE_BUDGET', summary: `החזרת התקציב היומי${label} למצב הקודם (${(was / 100).toLocaleString('en-US')} ₪)`, target: { ...target, ...(t.adsetId ? { adsetId: t.adsetId } : {}) }, parameters: { dailyBudget: String(was / 100) } };
  }
  if (plan.intent === 'PAUSE_CAMPAIGN') return { intent: 'RESUME_CAMPAIGN', summary: `החזרה למצב הקודם: הפעלה מחדש של הקמפיין${label}`, target, parameters: {} };
  if (plan.intent === 'RESUME_CAMPAIGN' || plan.intent === 'ACTIVATE_BUNDLE') return { intent: 'PAUSE_CAMPAIGN', summary: `החזרה למצב הקודם: עצירת הקמפיין${label}`, target, parameters: {} };
  return null;
}
// Does the undo start or raise spending? (source = the action being undone)
function spendsAgain(r, source) {
  if (r.intent === 'RESUME_CAMPAIGN' || r.intent === 'ACTIVATE_BUNDLE') return true;
  if (r.intent !== 'CHANGE_BUDGET') return false;
  const set = Number(source?.parameters?.dailyBudgetMinor) || Number(source?.parameters?.dailyBudget) * 100;
  const back = Number(r.parameters?.dailyBudget) * 100;
  return !(Number.isFinite(set) && set > 0 && Number.isFinite(back) && back < set);
}

// Undoable actions of the last 24 hours, newest first.
async function list(clientId) {
  const rows = (await db.query(`SELECT p.id,p.intent,p.payload,p.updated_at FROM action_plans p
    WHERE p.client_id=$1 AND p.status='VERIFIED' AND p.intent=ANY($2::text[]) AND p.updated_at>NOW()-($3::int*INTERVAL '1 hour')
      AND p.payload->>'undoOf' IS NULL
      AND NOT EXISTS (SELECT 1 FROM undo_actions u WHERE u.client_id=p.client_id AND u.source_action_id=p.id)
    ORDER BY p.updated_at DESC LIMIT 20`, [clientId, INTENTS, WINDOW_HOURS])).rows;
  return rows.filter((r) => reverse(r.payload)).map((r) => ({ actionId: r.id, intent: r.intent, at: r.updated_at, until: new Date(new Date(r.updated_at).getTime() + WINDOW_HOURS * 3600000), what: reverse(r.payload).summary }));
}
async function undoableIds(clientId) { try { return new Set((await list(clientId)).map((x) => x.actionId)); } catch { return new Set(); } }

// Prepare (and, only if the agreement allows a protective undo, run) the undo of one action.
// Returns {ok, mode:'auto'|'approval', approval?, text} or {ok:false, reason, text}.
async function undo(clientId, actionId, { channel = 'WHATSAPP' } = {}) {
  if (!ID.test(String(actionId || ''))) return { ok: false, reason: 'NOT_FOUND', text: copy.undoNotFound };
  const row = (await db.query('SELECT id,intent,payload,status,updated_at FROM action_plans WHERE client_id=$1 AND id=$2', [clientId, String(actionId)])).rows[0];
  if (!row || row.status !== 'VERIFIED' || !INTENTS.includes(row.intent) || row.payload?.undoOf) return { ok: false, reason: 'NOT_FOUND', text: copy.undoNotFound };
  if (Date.now() - new Date(row.updated_at).getTime() > WINDOW_HOURS * 3600000) return { ok: false, reason: 'EXPIRED', text: copy.undoExpired };
  const r = reverse(row.payload);
  if (!r) return { ok: false, reason: 'NOT_SUPPORTED', text: copy.undoNotSupported };
  const claim = await db.query('INSERT INTO undo_actions(client_id,source_action_id,channel) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING source_action_id', [clientId, row.id, channel]);
  if (!claim.rows.length) return { ok: false, reason: 'ALREADY', text: copy.undoAlready };
  try {
    const input = require('./actionPlan').createActionPlan({ ...r, summary: r.summary });
    input.undoOf = row.id;
    const meta = require('./metaConnection');
    let result;
    if (spendsAgain(input, row.payload)) {
      // Spending again is never automatic, whatever the agreement says.
      const approval = await meta.context.run(String(clientId), () => require('./approvalEngine').createApprovalForClient(clientId, input));
      result = { ok: true, mode: 'approval', approval, spending: true };
    } else {
      const out = await meta.context.run(String(clientId), () => require('./workAgreement').proposeOrAct(clientId, input, { reason: 'ביקשת להחזיר למצב הקודם' }));
      result = out.autonomous ? { ok: !!out.ok, mode: 'auto', actionId: out.actionId, text: out.ok ? copy.undoDoneAuto : out.text } : { ok: true, mode: 'approval', approval: out.approval };
    }
    const undoId = result.approval?.actionId || result.actionId || null;
    await db.query('UPDATE undo_actions SET undo_action_id=$3 WHERE client_id=$1 AND source_action_id=$2', [clientId, row.id, undoId]);
    await db.query("INSERT INTO tenant_audit(client_id,action_id,event,result) VALUES($1,$2,'UNDO_REQUESTED',$3)", [clientId, row.id, result.mode.toUpperCase()]);
    if (result.mode === 'approval') {
      const { formatActionPlan } = require('./actionPlan');
      result.text = copy.undoNeedsApproval + '\n\n' + formatActionPlan(result.approval.actionPlan) + (result.spending ? '\n\n' + copy.undoSpendingNote : '');
    }
    return result;
  } catch (error) {
    // Nothing was prepared: release the claim so the owner can try again.
    await db.query('DELETE FROM undo_actions WHERE client_id=$1 AND source_action_id=$2 AND undo_action_id IS NULL', [clientId, row.id]);
    return { ok: false, reason: 'FAILED', text: error?.reply || copy.undoFailed };
  }
}

// ---------- WhatsApp ----------
const REQUEST = /^(?:החזר|תחזיר|להחזיר|בטל(?:י)?)(?: את זה)? (?:ל)?(?:ה)?מצב (?:ה)?קודם[.!?]?$|^(?:undo|בטל את (?:ה)?שינוי(?: האחרון)?)$/iu;
const PICK = /^(?:(?:החזר|תחזיר)\s+)?(\d{1,2})$/u;
async function handleText(clientId, text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (!db.configured() || !t || t.length > 60) return null;
  const pick = t.match(PICK);
  if (!REQUEST.test(t) && !pick) return null;
  const store = require('./marketingStore');
  if (pick) {
    const p = await store.load(clientId).catch(() => null), menu = p?.undoMenu;
    // A bare number counts only right after the list (10 minutes); "החזר N" for an hour.
    const fresh = /^\d/.test(t) ? 600000 : 3600000;
    const id = menu && Date.now() - menu.at < fresh ? menu.ids[Number(pick[1]) - 1] : null;
    if (!id) return null; // not ours: "החזר 2" means something else when no list was shown
    return undo(clientId, id, { channel: 'WHATSAPP' });
  }
  const items = await list(clientId);
  if (!items.length) return { ok: false, text: copy.undoListEmpty };
  if (items.length === 1) return undo(clientId, items[0].actionId, { channel: 'WHATSAPP' });
  const shown = items.slice(0, 5);
  await store.update(clientId, null, (p) => { p.undoMenu = { ids: shown.map((x) => x.actionId), at: Date.now() }; return { handled: false, changed: true }; });
  return { ok: true, mode: 'list', text: [copy.undoListTitle, ...shown.map((x, i) => `${i + 1}. ${x.what}`), '', copy.undoHow(1)].join('\n') };
}

module.exports = { INTENTS, WINDOW_HOURS, reverse, list, undoableIds, undo, handleText, REQUEST };
