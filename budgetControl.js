'use strict';
// Budget control from the dashboard: change a campaign's daily budget, or duplicate a
// winning campaign (paused) with a new budget. Both are only PREPARED here as action
// plans; nothing reaches Meta until the owner approves the exact plan.
const SYMBOL = { ILS: '₪', USD: '$', EUR: '€' };
const shekel = (v, cur = 'ILS') => (SYMBOL[cur] || '') + Math.round(v).toLocaleString('en-US');
const MAX_DAILY = 100000;

// Where the budget of this campaign lives: on the campaign (CBO) or on its one ad set.
async function budgetTarget(clientId, campaignId) {
  const meta = require('./metaConnection');
  return meta.context.run(String(clientId), async () => {
    const c = await meta.credentials(clientId);
    if (!c?.meta_ad_account_id) return { ok: false, reply: 'צריך קודם לבחור חשבון מודעות.' };
    const campaign = await require('./metaAds').getCampaign(campaignId);
    const name = String(campaign.name || campaignId).slice(0, 80);
    if (campaign.lifetime_budget && !campaign.daily_budget) return { ok: false, name, reply: 'לקמפיין הזה יש תקציב לכל התקופה ולא תקציב יומי. את זה עדיף לשנות דרך העוזר, שיסביר מה ישתנה.' };
    if (campaign.daily_budget) return { ok: true, name, level: 'CAMPAIGN', currentMinor: Number(campaign.daily_budget), accountId: c.meta_ad_account_id };
    const sets = ((await meta.tenantRead('/' + campaignId + '/adsets', { fields: 'id,name,daily_budget,lifetime_budget,effective_status', limit: 20 })).data || [])
      .filter((s) => !['ARCHIVED', 'DELETED'].includes(s.effective_status));
    if (sets.length === 1 && sets[0].daily_budget && /^\d+$/.test(String(sets[0].id))) return { ok: true, name, level: 'ADSET', adsetId: String(sets[0].id), currentMinor: Number(sets[0].daily_budget), accountId: c.meta_ad_account_id };
    if (sets.length > 1) return { ok: false, name, reply: `בקמפיין הזה יש ${sets.length} קהלים, ולכל אחד תקציב משלו. כדי לא לנחש איך לחלק, בקשו מהעוזר "תשנה תקציב לקמפיין ${name}" והוא יכין חלוקה לאישור.` };
    return { ok: false, name, reply: 'לא מצאתי תקציב יומי לקמפיין הזה.' };
  });
}

// Current budget for the dashboard dialog.
async function info(clientId, campaignId) {
  if (!/^\d{1,40}$/.test(String(campaignId || ''))) throw Error('INVALID_CAMPAIGN_ACTION');
  const t = await budgetTarget(clientId, campaignId);
  if (!t.ok) return { ok: false, name: t.name, reply: t.reply };
  return { ok: true, name: t.name, level: t.level, currentDailyBudget: t.currentMinor / 100, capDaily: await require('./spendCap').get(clientId).catch(() => null) };
}

function parseBudget(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 && n <= MAX_DAILY ? n : null;
}

async function blockedByTask(clientId) {
  const task = await require('./taskAgent').active(clientId);
  return task?.state?.steps?.some((s) => s.status === 'WAITING_APPROVAL') ? 'יש משימה שמחכה לאישור שלך. סיימו או בטלו אותה קודם, כדי ששום אישור לא יידרס.' : null;
}

async function propose(clientId, plan) {
  const { formatActionPlan } = require('./actionPlan');
  try {
    const approval = await require('./approvalEngine').createApprovalForClient(clientId, plan);
    return { ok: true, actionId: approval.actionId, summary: formatActionPlan(approval.actionPlan), expiresAt: approval.expiresAt };
  } catch (error) {
    if (error.reply) return { ok: false, reply: error.reply };
    throw error;
  }
}

// "שינוי תקציב": prepare a CHANGE_BUDGET plan for approval.
async function prepareBudgetChange(clientId, campaignId, dailyBudget) {
  if (!/^\d{1,40}$/.test(String(campaignId || ''))) throw Error('INVALID_CAMPAIGN_ACTION');
  const amount = parseBudget(dailyBudget);
  if (!amount) return { ok: false, reply: `צריך תקציב יומי בשקלים, בין 1 ל־${MAX_DAILY.toLocaleString('en-US')}.` };
  const blocked = await blockedByTask(clientId); if (blocked) return { ok: false, reply: blocked };
  const t = await budgetTarget(clientId, campaignId);
  if (!t.ok) return { ok: false, reply: t.reply };
  const current = t.currentMinor / 100;
  if (Math.round(current) === amount) return { ok: false, reply: `זה כבר התקציב היומי של הקמפיין (${shekel(current)}).` };
  const { createActionPlan } = require('./actionPlan');
  return propose(clientId, createActionPlan({ intent: 'CHANGE_BUDGET',
    summary: `${amount > current ? 'הגדלת' : 'הורדת'} התקציב היומי של "${t.name}" מ־${shekel(current)} ל־${shekel(amount)}`,
    target: { accountId: t.accountId, campaignId: String(campaignId), ...(t.adsetId ? { adsetId: t.adsetId } : {}) },
    parameters: { dailyBudget: String(amount) } }));
}

// Meta copies up to 3 ads in one synchronous deep copy.
const MAX_COPY_ADS = 3;

// "שכפל קמפיין מנצח": prepare a DUPLICATE_CAMPAIGN plan (copy stays PAUSED).
async function prepareDuplicate(clientId, campaignId, dailyBudget) {
  if (!/^\d{1,40}$/.test(String(campaignId || ''))) throw Error('INVALID_CAMPAIGN_ACTION');
  const amount = parseBudget(dailyBudget);
  if (!amount) return { ok: false, reply: `צריך תקציב יומי לעותק בשקלים, בין 1 ל־${MAX_DAILY.toLocaleString('en-US')}.` };
  const blocked = await blockedByTask(clientId); if (blocked) return { ok: false, reply: blocked };
  const t = await budgetTarget(clientId, campaignId);
  if (!t.ok) return { ok: false, reply: t.reply };
  const meta = require('./metaConnection');
  const ads = await meta.context.run(String(clientId), async () => ((await meta.tenantRead('/' + campaignId + '/ads', { fields: 'id,effective_status', limit: 10 })).data || []).filter((a) => !['ARCHIVED', 'DELETED'].includes(a.effective_status)));
  if (!ads.length) return { ok: false, reply: 'אין בקמפיין הזה מודעות לשכפל.' };
  if (ads.length > MAX_COPY_ADS) return { ok: false, reply: `בקמפיין הזה ${ads.length} מודעות, ו־Meta משכפלת בבת אחת עד ${MAX_COPY_ADS}. בקשו מהעוזר "תשכפל את ${t.name}" והוא יבנה עותק עם המודעות הכי טובות.` };
  const { createActionPlan } = require('./actionPlan');
  return propose(clientId, createActionPlan({ intent: 'DUPLICATE_CAMPAIGN',
    summary: `שכפול הקמפיין המנצח "${t.name}" לקמפיין חדש ומושהה, עם תקציב יומי של ${shekel(amount)}`,
    target: { accountId: t.accountId, campaignId: String(campaignId), ...(t.adsetId ? { adsetId: t.adsetId } : {}) },
    parameters: { dailyBudget: String(amount) } }));
}

// Winners: enough results and a clearly better cost per sale (when sales are known)
// or cost per lead than the account average over the same period.
function markWinners(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const total = (k) => list.reduce((t, x) => t + (Number(x[k]) || 0), 0);
  const spend = total('spend'), leads = total('leads'), won = total('won');
  const avgSale = won >= 2 ? spend / won : null, avgLead = leads >= 3 ? spend / leads : null;
  return list.map((x) => {
    const s = Number(x.spend) || 0;
    let winner = null;
    if (avgSale && x.won >= 2 && s > 0 && s / x.won <= avgSale * 0.8) winner = { by: 'SALE', cost: s / x.won, average: avgSale };
    else if (avgLead && x.leads >= 3 && s > 0 && s / x.leads <= avgLead * 0.8) winner = { by: 'LEAD', cost: s / x.leads, average: avgLead };
    // Only when the campaign beats the others, not when it is the whole account.
    if (winner && list.filter((y) => (Number(y.spend) || 0) > 0).length < 2) winner = null;
    return winner ? { ...x, winner } : x;
  });
}

module.exports = { info, prepareBudgetChange, prepareDuplicate, markWinners, budgetTarget, MAX_COPY_ADS };
