'use strict';
// Work agreement (הסכם עבודה): the owner sets once what the agent may do alone and what always
// needs approval. Storage and enforcement live in scopedAuthority.js (one mandate row, the same
// audit, the same authority_uses ledger, the same re-check right before execution). This module
// holds what surrounds it: readiness before any approval (F1), approval lifetime by action type
// (F3), "act or ask" for agent-initiated actions, the activation question after a campaign is
// created (F8), and the WhatsApp setup with button questions.
const db = require('./db');
const authority = require('./scopedAuthority');

const SYMBOL = { ILS: '₪', USD: '$', EUR: '€' };
const money = (v, cur = 'ILS') => Math.round(Number(v)).toLocaleString('en-US') + ' ' + (SYMBOL[cur] || cur);
const ALLOW_HE = {
  pauseLosing: 'לעצור קמפיין שמפסיד כסף',
  lowerBudget: 'להוריד תקציב לקמפיין חלש',
  shiftBudget: 'להעביר תקציב בין הקמפיינים שלך, בתוך התקרה',
  refreshCreatives: 'לרענן מודעות שנשחקו',
  organicPosts: 'לפרסם פוסטים אורגניים בסגנון שאישרת',
  answerLeads: 'לענות ללידים',
  activateNew: 'להפעיל קמפיין חדש בלי לשאול (בתוך התקרה)'
};
const ALWAYS_ASK_HE = ['הפעלה ראשונה של קמפיין חדש', 'כל חריגה מתקרת ההוצאה', 'כל התחייבות כספית חדשה', 'מחיקה של כל דבר', 'כל פעולה שאי אפשר לבטל'];
const PRESETS = {
  all: { pauseLosing: true, lowerBudget: true, shiftBudget: true, refreshCreatives: true, organicPosts: true, answerLeads: true, activateNew: false },
  protect: { pauseLosing: true, lowerBudget: true, shiftBudget: false, refreshCreatives: false, organicPosts: false, answerLeads: true, activateNew: false },
  none: { pauseLosing: false, lowerBudget: false, shiftBudget: false, refreshCreatives: false, organicPosts: false, answerLeads: false, activateNew: false }
};

// ---------- F3: approval lifetime by what the action does ----------
function actionClass(plan) {
  if (['PAUSE_CAMPAIGN', 'PAUSE_AD'].includes(plan?.intent)) return 'PROTECTIVE';
  if (plan?.intent === 'CHANGE_BUDGET') {
    const next = Number(plan.parameters?.dailyBudgetMinor), cur = Number(plan.review?.currentDailyBudgetMinor);
    return Number.isFinite(next) && Number.isFinite(cur) && cur > 0 && next < cur ? 'PROTECTIVE' : 'SPENDING';
  }
  if (['ACTIVATE_BUNDLE', 'RESUME_CAMPAIGN'].includes(plan?.intent)) return 'SPENDING';
  return 'NEUTRAL';
}
const clamp = (v, lo, hi, d) => { const n = Number(v); return Math.max(lo, Math.min(hi, Number.isFinite(n) && n > 0 ? n : d)); };
// Protecting money stays valid for hours; spending more keeps a short window; creating paused things sits between.
function ttlMs(plan) {
  const cls = actionClass(plan);
  if (cls === 'PROTECTIVE') return clamp(process.env.APPROVAL_PROTECTIVE_TTL_HOURS, 1, 48, 12) * 3600000;
  if (cls === 'SPENDING') return clamp(process.env.APPROVAL_TTL_MINUTES, 1, 30, 10) * 60000;
  return clamp(process.env.APPROVAL_NEUTRAL_TTL_MINUTES, 10, 1440, 120) * 60000;
}

// ---------- F1: readiness before asking for any approval ----------
const notReady = (reply) => Object.assign(Error('NOT_READY'), { reply });
async function assertReady(clientId) {
  // A system-wide write lock is an operator switch, not something the owner can fix; the executor
  // answers it in plain Hebrew. Everything the owner can fix is checked here, before the approval.
  const meta = require('./metaConnection');
  let c;
  try { c = await meta.credentials(clientId); } catch {
    throw notReady('✋ לפני שאני מבקש ממך אישור: חשבון הפרסום שלך ב־Meta לא מחובר (או שהחיבור פג).\nהצעד הבא: כתוב "חבר את מטא" ואשלח לך קישור אישי לחיבור. זה לוקח דקה.');
  }
  if (!c.meta_ad_account_id) throw notReady('✋ לפני שאני מבקש ממך אישור: עוד לא בחרת באיזה חשבון מודעות לעבוד.\nהצעד הבא: כתוב "החשבונות שלי" ובחר את החשבון של העסק.');
  let perms = null;
  try { perms = await meta.graph('/me/permissions', c.token); } catch (error) {
    if (error.message === 'META_TOKEN_EXPIRED') throw notReady('✋ לפני שאני מבקש ממך אישור: החיבור ל־Meta פג.\nהצעד הבא: כתוב "חבר את מטא" ואשלח לך קישור לחיבור מחדש.');
    perms = null; // could not check now; the execution re-checks right before any write
  }
  if (perms && !perms.data?.some((p) => p.permission === 'ads_management' && p.status === 'granted'))
    throw notReady('✋ לפני שאני מבקש ממך אישור: החיבור ל־Meta מאפשר לי רק לראות נתונים, לא לשנות קמפיינים.\nהצעד הבא: כתוב "חבר הרשאת יצירת קמפיינים" ובמסך של Meta סמן גם ניהול מודעות.');
  return true;
}

// ---------- Spend picture for the ceiling check ----------
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
function daysLeftInMonth(now = new Date()) {
  const [y, m, d] = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }).split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate() - d + 1;
}
// Month-to-date spend and today's committed daily budgets (running campaigns + running ad sets).
async function spendContext(clientId) {
  const meta = require('./metaConnection');
  return meta.context.run(String(clientId), async () => {
    const c = await meta.credentials(clientId);
    if (!c.meta_ad_account_id) return null;
    const acc = c.meta_ad_account_id, read = (p, q) => meta.tenantRead(p, q), active = JSON.stringify(['ACTIVE']);
    const month = (await read('/' + acc + '/insights', { fields: 'spend', date_preset: 'this_month' })).data || [];
    const campaigns = (await read('/' + acc + '/campaigns', { fields: 'id,daily_budget', effective_status: active, limit: 100 })).data || [];
    const adsets = (await read('/' + acc + '/adsets', { fields: 'id,daily_budget', effective_status: active, limit: 200 })).data || [];
    return { monthSpend: month.reduce((t, r) => t + num(r.spend), 0), committedDailyMinor: [...campaigns, ...adsets].reduce((t, x) => t + num(x.daily_budget), 0), daysLeft: daysLeftInMonth() };
  });
}

const ASK_WHY = {
  NO_AGREEMENT: null, PAUSED: 'הפעולות האוטומטיות עצורות כרגע, אז אני שואל אותך.',
  NOT_ALLOWED: 'זה לא ברשימת הדברים שהסוכן עושה לבד לפי הסכם העבודה, אז אני שואל אותך.',
  ABOVE_DAILY: 'זה מעל התקציב היומי המקסימלי לקמפיין שקבעת בהסכם העבודה, אז אני שואל אותך.',
  ABOVE_CEILING: 'זה יעבור את תקרת ההוצאה החודשית שקבעת בהסכם העבודה, אז אני שואל אותך.',
  SPEND_UNKNOWN: 'לא הצלחתי לבדוק כרגע כמה כבר הוצא החודש, אז ליתר ביטחון אני שואל אותך.',
  ALWAYS_ASK: null, BUDGET_UNKNOWN: null, CURRENCY: null
};

// Agent-initiated action: inside the agreement act and report, outside it prepare an approval and ask.
// Returns {autonomous:true, ok, text} or {autonomous:false, approval, askWhy}.
async function proposeOrAct(clientId, input, { reason } = {}) {
  const approval = await require('./approvalEngine').createApprovalForClient(clientId, input);
  const plan = approval.actionPlan;
  const row = await activeRow(clientId);
  if (!row || plan.taskId) return { autonomous: false, approval, askWhy: row ? null : null };
  const needsSpend = actionClass(plan) === 'SPENDING';
  const ctx = needsSpend ? await spendContext(clientId).catch(() => null) : {};
  const decision = authority.agreementDecision(row, plan, ctx || {});
  if (!decision.ok) return { autonomous: false, approval, askWhy: ASK_WHY[decision.why] || null };
  const authorized = await require('./metaConnection').context.run(String(clientId), () => authority.authorizeByAgreement(clientId, plan, ctx || {}, reason || plan.summary));
  if (!authorized) return { autonomous: false, approval, askWhy: null };
  const result = await require('./metaConnection').context.run(String(clientId), () => require('./actionExecutor').executeApprovedForClient(clientId, plan));
  return { autonomous: true, ok: !!result.ok, result, actionId: plan.id, text: report(plan, result, reason) };
}
async function activeRow(clientId) {
  return (await db.query("SELECT * FROM authority_mandates WHERE client_id=$1 AND status IN ('ACTIVE','PAUSED') AND policy->>'kind'='WORK_AGREEMENT' ORDER BY created_at DESC LIMIT 1", [clientId])).rows[0] || null;
}
function report(plan, result, reason) {
  const what = (require('./actionPlan').INTENT_HE[plan.intent] || 'פעולה') + (plan.target?.campaignName ? `: "${plan.target.campaignName}"` : '');
  return (result.ok ? '🤖 עשיתי לבד, לפי הסכם העבודה שלך:\n' : '⚠️ ניסיתי לבצע לבד לפי הסכם העבודה, וזה לא הושלם:\n') + `• ${what}` + (reason ? `\nלמה: ${reason}` : '') +
    (result.ok ? '\nזה מופיע ב"מה עשיתי ולמה".' : '\n' + (result.message || 'לא בוצע שינוי.')) + '\nלעצירת כל הפעולות האוטומטיות כתוב: עצור את כל הפעולות האוטומטיות';
}

// ---------- F8: after a campaign is created paused ----------
// Ask "להפעיל עכשיו?" with the cost line, unless the agreement already authorizes activation.
async function offerActivation(clientId, createdPlan, writeResult) {
  const o = writeResult?.objects || {};
  if (!o.campaignId || !o.adsetIds?.length || !o.adIds?.length) return { ok: false, text: 'הקמפיין נוצר ואומת במצב מושהה. לא הופעל פרסום.' };
  const input = require('./actionPlan').createActionPlan({ intent: 'ACTIVATE_BUNDLE', summary: 'הפעלת הקמפיין שנוצר ואומת במצב מושהה', target: { accountId: createdPlan.target.accountId, campaignId: String(o.campaignId) }, parameters: { adsetIds: o.adsetIds.map(String), adIds: o.adIds.map(String) } });
  let r;
  try { r = await proposeOrAct(clientId, input, { reason: 'הסכם העבודה מאפשר להפעיל קמפיין חדש בתוך התקרה' }); } catch (error) {
    return { ok: false, text: 'הקמפיין מוכן ומושהה. לא הופעל פרסום.\n\n' + (error.reply || 'הכנת שאלת ההפעלה לא הושלמה; אפשר להפעיל אותו מהדשבורד במסך הקמפיינים.') };
  }
  if (r.autonomous) return { ok: r.ok, autonomous: true, text: r.text };
  const { formatActionPlan } = require('./actionPlan');
  return { ok: true, approval: r.approval, text: ACTIVATION_QUESTION + '\n\n' + formatActionPlan(r.approval.actionPlan) };
}
const ACTIVATION_QUESTION = 'הקמפיין מוכן ומושהה. להפעיל עכשיו?';

// ---------- Re-offer the same action with fresh numbers (expired / superseded tap) ----------
async function reoffer(clientId, actionId) {
  const row = (await db.query(`SELECT a.status,a.expires_at,p.payload,p.status AS plan_status FROM approvals a JOIN action_plans p ON p.id=a.action_id AND p.client_id=a.client_id
    WHERE a.client_id=$1 AND a.action_id=$2 ORDER BY a.created_at DESC LIMIT 1`, [clientId, String(actionId)])).rows[0];
  if (!row || row.plan_status !== 'PROPOSED' || row.payload?.taskId) return null;
  if (!(row.status === 'SUPERSEDED' || (row.status === 'PENDING' && new Date(row.expires_at) <= new Date()))) return null;
  const old = row.payload, t = old.target || {}, params = JSON.parse(JSON.stringify(old.parameters || {}));
  delete params.currency; delete params.dailyBudgetMinor;
  for (const s of params.adSets || []) { delete s.currency; delete s.dailyBudgetMinor; }
  const input = require('./actionPlan').createActionPlan({ intent: old.intent, summary: old.summary, target: { accountId: t.accountId, ...(t.campaignId ? { campaignId: t.campaignId } : {}), ...(t.adsetId ? { adsetId: t.adsetId } : {}) }, parameters: params });
  const fresh = await require('./approvalEngine').createApprovalForClient(clientId, input);
  await db.query("UPDATE approvals SET status='EXPIRED' WHERE client_id=$1 AND action_id=$2 AND status IN ('PENDING','SUPERSEDED')", [clientId, String(actionId)]);
  await db.query("UPDATE action_plans SET status='CANCELLED',updated_at=NOW() WHERE client_id=$1 AND id=$2 AND status='PROPOSED'", [clientId, String(actionId)]);
  return fresh;
}
const REOFFER_INTRO = 'תוקף האישור הקודם פג, אז בדקתי שוב את המספרים מול Meta. זו אותה פעולה, מעודכנת:';

// ---------- Text ----------
function summaryText(a) {
  if (!a) return 'עוד אין הסכם עבודה. כתוב "הסכם עבודה" ואשאל אותך כמה שאלות קצרות.';
  const yes = Object.entries(ALLOW_HE).filter(([k]) => a.allow[k]).map(([, v]) => '✅ ' + v);
  const lines = ['📜 *הסכם העבודה שלך*' + (a.paused ? ' — ⏸ הפעולות האוטומטיות עצורות' : ''), '',
    `💰 תקרת הוצאה חודשית על פרסום: ${money(a.monthlyCeiling, a.currency)}`, `📅 תקציב יומי מקסימלי לקמפיין: ${money(a.maxDailyPerCampaign, a.currency)}`, '',
    '*הסוכן עושה לבד ומדווח לך:*', ...(yes.length ? yes : ['— כלום. הסוכן שואל אותך על כל דבר.']), '',
    '*תמיד ישאל אותך קודם:*', ...ALWAYS_ASK_HE.map((x) => '✋ ' + x)];
  if (a.styleNotes) lines.push('', '🎨 סגנון: ' + a.styleNotes);
  if (a.forbiddenTopics?.length) lines.push('🚫 נושאים אסורים: ' + a.forbiddenTopics.join(', '));
  lines.push('', 'הסוכן אף פעם לא מוציא יותר מהתקרה בלי אישור שלך.');
  return lines.join('\n');
}

// ---------- WhatsApp: set once with button questions ----------
const SHOW = /^(?:הסכם\s+(?:ה)?עבודה|ההסכם שלי|מה ההסכם(?: שלי)?|מה הסוכן יכול לעשות לבד\??)[?]?$/u;
const EDIT = /^(?:עדכן|תעדכן|לעדכן|שנה|לשנות|הגדר|להגדיר)(?: את)? (?:ה)?הסכם(?: ה)?(?:עבודה)?$/u;
const PAUSE = /^(?:עצור|תעצור|לעצור) את כל הפעולות האוטומטיות|^(?:עצור|תעצור) (?:את )?(?:כל )?הפעולות האוטומטיות$/u;
const RESUME = /^(?:חדש|תחדש|לחדש|הפעל מחדש|תפעיל מחדש|להחזיר|תחזיר) את (?:כל )?הפעולות האוטומטיות$/u;
const SKIP = /^(?:אין|לא|דלג|תדלג|אין, תמשיך|בלי)$/u;
const CANCEL = /^(?:בטל|ביטול|עזוב|לא עכשיו|בטל את ההגדרה)$/u;
const STEPS = ['monthly', 'daily', 'scope', 'style', 'forbidden', 'confirm'];
const QUESTIONS = {
  monthly: ['שאלה 1 מ־5: כמה מקסימום להוציא על פרסום בחודש, בכל הקמפיינים יחד?\nאפשר לבחור או לכתוב סכום.', [['1,500 ₪ בחודש', 'תקרה חודשית 1500'], ['3,000 ₪ בחודש', 'תקרה חודשית 3000'], ['5,000 ₪ בחודש', 'תקרה חודשית 5000']]],
  daily: ['שאלה 2 מ־5: ומה התקציב היומי המקסימלי לקמפיין אחד?', [['50 ₪ ליום', 'מקסימום יומי 50'], ['100 ₪ ליום', 'מקסימום יומי 100'], ['200 ₪ ליום', 'מקסימום יומי 200']]],
  scope: ['שאלה 3 מ־5: מה הסוכן יכול לעשות לבד, בלי לשאול אותך?\n\n*הכול ברשימה:* לעצור קמפיין מפסיד, להוריד תקציב, להעביר תקציב בין הקמפיינים בתוך התקרה, לרענן מודעות, לפרסם פוסטים בסגנון שאישרת ולענות ללידים.\n*רק להגן על הכסף:* לעצור קמפיין מפסיד, להוריד תקציב ולענות ללידים.\n\nהפעלה של קמפיין חדש, חריגה מהתקרה, מחיקה וכל התחייבות כספית חדשה תמיד יחכו לאישור שלך.', [['הכול ברשימה', 'הסוכן יעשה הכול ברשימה'], ['רק להגן על הכסף', 'הסוכן רק יגן על הכסף'], ['כלום, תמיד לשאול', 'הסוכן ישאל תמיד']]],
  style: ['שאלה 4 מ־5: יש סגנון שחשוב לך בפוסטים ובמודעות? (למשל: רציני, בלי אימוג׳ים, פונים בגוף שני)\nכתוב בחופשיות, או לחץ "אין".', [['אין', 'אין']]],
  forbidden: ['שאלה 5 מ־5: יש נושאים שאסור לגעת בהם? כתוב אותם עם פסיקים, או לחץ "אין".', [['אין', 'אין']]]
};
function numberIn(text) { const m = String(text).replace(/(\d),(?=\d{3}(?!\d))/g, '$1').match(/\d{1,7}(?:\.\d{1,2})?/); return m ? Number(m[0]) : null; }

async function ask(clientId, step, draft, prefix = '') {
  const ui = require('./conversationUi');
  if (step === 'confirm') {
    const summary = (prefix ? prefix + '\n\n' : '') + summaryText({ ...draft, paused: false });
    return withSummary(summary, await ui.prepareChoices(clientId, 'לאשר את הסכם העבודה הזה?', [{ title: 'מאשר את ההסכם', text: 'מאשר את הסכם העבודה' }, { title: 'להתחיל מחדש', text: 'עדכן את הסכם העבודה' }, { title: 'ביטול', text: 'בטל' }], 'work_agreement'));
  }
  const [body, buttons] = QUESTIONS[step];
  return ui.prepareChoices(clientId, (prefix ? prefix + '\n\n' : '') + body, buttons.map(([title, text]) => ({ title, text })), 'work_agreement');
}
// The full summary goes first as its own message; the buttons follow with a short question.
const withSummary = (summary, ui) => ({ ...ui, leadingText: summary, text: summary + '\n\n' + ui.text });
async function setupState(clientId, change) {
  return require('./marketingStore').update(clientId, null, (p) => { const before = JSON.stringify(p.agreementSetup || null); const out = change(p); return { handled: false, changed: JSON.stringify(p.agreementSetup || null) !== before, out }; });
}

// Returns {reply} or a ready interactive {text, interactivePayload}, or null when the text is not ours.
async function handleText(clientId, text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (!db.configured() || !t || t.length > 300) return null;
  const run = (work) => authority.withWhatsAppOwner(clientId, work);
  if (PAUSE.test(t)) {
    const a = await authority.getAgreement(clientId);
    if (!a) return { text: 'אין כרגע פעולות אוטומטיות: עוד לא הוגדר הסכם עבודה, אז הסוכן שואל אותך על כל פעולה.' };
    await run(() => authority.pauseAll(clientId));
    return { text: '⏸ עצרתי את כל הפעולות האוטומטיות. מעכשיו הסוכן שואל אותך על כל פעולה, וכל פעולה אוטומטית שעוד לא בוצעה נחסמה.\nלהחזרה כתוב: חדש את הפעולות האוטומטיות' };
  }
  if (RESUME.test(t)) {
    const a = await authority.getAgreement(clientId);
    if (!a) return { text: 'עוד אין הסכם עבודה. כתוב "הסכם עבודה" כדי להגדיר אחד.' };
    await run(() => authority.resumeAll(clientId));
    return { text: '▶️ הפעולות האוטומטיות חזרו לפעול, בדיוק לפי הסכם העבודה.\n\n' + summaryText({ ...a, paused: false }) };
  }
  const profile = await require('./marketingStore').load(clientId).catch(() => null);
  const setup = profile?.agreementSetup;
  if (SHOW.test(t) && !setup) {
    const a = await authority.getAgreement(clientId);
    if (!a) return start(clientId);
    return withSummary(summaryText(a), await require('./conversationUi').prepareChoices(clientId, 'מה תרצה לעשות עם ההסכם?', [{ title: 'לעדכן את ההסכם', text: 'עדכן את הסכם העבודה' }, a.paused ? { title: 'לחדש פעולות', text: 'חדש את הפעולות האוטומטיות' } : { title: 'לעצור הכול', text: 'עצור את כל הפעולות האוטומטיות' }], 'work_agreement'));
  }
  if (EDIT.test(t)) return start(clientId);
  if (!setup) return null;
  if (CANCEL.test(t)) { await setupState(clientId, (p) => { delete p.agreementSetup; }); return { text: 'בסדר, לא שיניתי כלום בהסכם העבודה.' }; }
  const draft = { ...setup.draft };
  const next = (step, prefix) => setupState(clientId, (p) => { p.agreementSetup = { step, draft }; }).then(() => ask(clientId, step, draft, prefix));
  if (setup.step === 'monthly' || setup.step === 'daily') {
    const n = numberIn(t);
    if (!n || n <= 0) {
      if (t.length > 40) { await setupState(clientId, (p) => { delete p.agreementSetup; }); return null; }
      return ask(clientId, setup.step, draft, 'צריך סכום בשקלים, למשל 3000.');
    }
    if (setup.step === 'monthly') { draft.monthlyCeiling = n; return next('daily'); }
    if (n > draft.monthlyCeiling) return ask(clientId, 'daily', draft, `התקציב היומי לא יכול להיות גדול מהתקרה החודשית (${money(draft.monthlyCeiling)}).`);
    draft.maxDailyPerCampaign = n; return next('scope');
  }
  if (setup.step === 'scope') {
    const key = /הכול|הכל/.test(t) ? 'all' : /להגן|יגן|הגנה/.test(t) ? 'protect' : /כלום|תמיד|ישאל/.test(t) ? 'none' : null;
    if (!key) return ask(clientId, 'scope', draft, 'בחר אחת מהאפשרויות:');
    draft.allow = { ...PRESETS[key] }; return next('style');
  }
  if (setup.step === 'style') { draft.styleNotes = SKIP.test(t) ? '' : t.slice(0, 1000); return next('forbidden'); }
  if (setup.step === 'forbidden') { draft.forbiddenTopics = SKIP.test(t) ? [] : t.split(/[,،\n]/).map((x) => x.trim().slice(0, 80)).filter(Boolean).slice(0, 20); return next('confirm'); }
  if (setup.step === 'confirm') {
    if (!/^מאשר/.test(t)) return ask(clientId, 'confirm', draft, 'לאשר את ההסכם, להתחיל מחדש או לבטל?');
    const saved = await run(() => authority.setAgreement(clientId, { monthlyCeiling: draft.monthlyCeiling, maxDailyPerCampaign: draft.maxDailyPerCampaign, allow: draft.allow, styleNotes: draft.styleNotes || '', forbiddenTopics: draft.forbiddenTopics || [] }));
    await setupState(clientId, (p) => { delete p.agreementSetup; });
    return { text: 'סגרנו ✅ הסכם העבודה נשמר.\n\n' + summaryText(saved) + '\n\nכל מה שהסוכן עושה לבד יופיע ב"מה עשיתי ולמה" עם הסיבה.\nלעצירה מיידית של הכול כתוב: עצור את כל הפעולות האוטומטיות' };
  }
  return null;
}
async function start(clientId) {
  const a = await authority.getAgreement(clientId);
  const draft = a ? { monthlyCeiling: a.monthlyCeiling, maxDailyPerCampaign: a.maxDailyPerCampaign, allow: a.allow, styleNotes: a.styleNotes, forbiddenTopics: a.forbiddenTopics } : {};
  await setupState(clientId, (p) => { p.agreementSetup = { step: 'monthly', draft }; });
  return ask(clientId, 'monthly', draft, 'בוא נסגור הסכם עבודה, פעם אחת: מה הסוכן עושה לבד ומה תמיד מחכה לאישור שלך. 5 שאלות קצרות.');
}

module.exports = { actionClass, ttlMs, assertReady, spendContext, daysLeftInMonth, proposeOrAct, offerActivation, reoffer, summaryText, handleText, ACTIVATION_QUESTION, REOFFER_INTRO, ALLOW_HE, ALWAYS_ASK_HE, PRESETS, ASK_WHY };
