'use strict';
// "ההמלצה של היום": every business morning SCORPIO looks at ad spend, leads and real
// sales, picks the ONE change with the biggest expected revenue impact and sends it
// on WhatsApp: what to change, why (real numbers) and what it should bring.
// Quiet days stay quiet. Anything touching Meta becomes an approval in the existing
// approval engine; nothing is executed without the owner's explicit approval.
const db = require('./db');
const { logger } = require('./logger');

const enabled = () => process.env.DAILY_ADVICE_ENABLED !== 'false';
const RULES = {
  cooldownDays: 3, // the same recommendation is never repeated within this window
  approveWithinDays: 2, // older advice is stale: the numbers have moved
  minWeeklyImpact: 100, // ₪ per week; below that the day is skipped
  learningDays: 3,
  shiftMinAgeDays: 7, shiftShare: 0.2, shiftMinRatio: 1.5, shiftMinLeads: 3, shiftMinSales: 2, shiftMinLoserSpend: 100, dampening: 0.7,
  wasteMinSpend: 150, wasteCplMultiple: 2.5, minImpressions: 3000,
  fatigueFrequency: 3.5, fatigueCtrDrop: 0.75, fatigueMinImpressions: 2000,
  followUpMin: 2, defaultCloseRate: 0.1
};
const KINDS = ['SHIFT_BUDGET', 'PAUSE_WASTE', 'REFRESH_CREATIVE', 'FOLLOW_UP_LEADS', 'ADD_REVENUE'];
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const SYMBOL = { ILS: '₪', USD: '$', EUR: '€' };
const money = (v, cur = 'ILS') => Math.round(v).toLocaleString('en-US') + ' ' + (SYMBOL[cur] || cur || '');
const short = (s) => String(s || 'הקמפיין').replace(/\s+/g, ' ').trim().slice(0, 40);
// A cautious range: never promise more than the estimate, show the low end too.
function range(x) {
  const hi = Math.max(1, Math.round(x)), lo = Math.max(1, Math.floor(x * 0.6));
  return lo === hi ? `בערך ${hi}` : `בערך ${lo}–${hi}`;
}

function israelTime(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((x) => [x.type, x.value]));
  return { weekday: p.weekday, hour: Number(p.hour), day: `${p.year}-${p.month}-${p.day}` };
}
// Sunday–Thursday, 09:00–11:00 Israel time.
function morning(now = new Date()) {
  const t = israelTime(now);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'].includes(t.weekday) && t.hour >= 9 && t.hour < 11;
}

// What a lead and a sale are worth for this business, from its own CRM (last 90 days).
function value(data) {
  const crm = data.crm || {};
  const avgDeal = crm.wonWithRevenue90 > 0 && crm.revenue90 > 0 ? crm.revenue90 / crm.wonWithRevenue90 : null;
  const closeRate = crm.leads90 >= 10 && crm.won90 > 0 ? crm.won90 / crm.leads90 : null;
  const hasSales = !!(avgDeal && closeRate);
  return { avgDeal, closeRate, hasSales, perLead: hasSales ? avgDeal * closeRate : (data.cpl30 || null) };
}

// Pure decision: every meaningful recommendation, highest expected weekly revenue impact first.
function candidates(data = {}) {
  const out = [], cur = data.currency || 'ILS', v = value(data), cpl30 = data.cpl30 || null;
  const guard = new Set(data.guardRecent || []);
  const active = (data.campaigns || []).filter((c) => c.status === 'ACTIVE' && num(c.ageDays) >= RULES.learningDays);
  const m = (x) => money(x, cur);

  for (const c of active) {
    if (c.leads7 === 0 && c.spend7 >= Math.max(RULES.wasteMinSpend, cpl30 ? cpl30 * RULES.wasteCplMultiple : 0) && c.impressions7 >= RULES.minImpressions && !guard.has('WASTE:' + c.id)) {
      out.push({ kind: 'PAUSE_WASTE', key: 'PAUSE_WASTE:' + c.id, impact: c.spend7,
        title: `לעצור את הקמפיין "${short(c.name)}"`,
        why: `בשבוע האחרון הוא הוציא ${m(c.spend7)} ועוד לא הביא אף ליד.` + (cpl30 ? ` אצלך עלות לליד היא בממוצע ${m(cpl30)}.` : ''),
        impactText: `חיסכון של בערך ${m(c.spend7)} בשבוע, שאפשר להעביר למה שכן מביא לקוחות.`,
        action: { type: 'META', steps: [{ intent: 'PAUSE_CAMPAIGN', campaignId: c.id, summary: `השהיית הקמפיין "${short(c.name)}" שמוציא כסף בלי לידים` }] } });
    }
  }

  // Move budget from the expensive campaign to the cheap one: by cost per SALE when the CRM knows sales, else by cost per lead.
  const budgeted = active.filter((c) => num(c.ageDays) >= RULES.shiftMinAgeDays && c.dailyBudget > 0);
  const salesMode = v.hasSales && budgeted.filter((c) => c.won30 >= 1 && c.spend30 > 0).length >= 2;
  const priced = budgeted.map((c) => ({ c, cost: salesMode ? (c.won30 >= 1 && c.spend30 > 0 ? c.spend30 / c.won30 : null) : (c.leads7 >= 1 && c.spend7 > 0 ? c.spend7 / c.leads7 : null) })).filter((x) => x.cost);
  const winners = priced.filter((x) => salesMode ? x.c.won30 >= RULES.shiftMinSales : x.c.leads7 >= RULES.shiftMinLeads).sort((a, b) => a.cost - b.cost);
  const losers = priced.filter((x) => x.c.spend7 >= RULES.shiftMinLoserSpend).sort((a, b) => b.cost - a.cost);
  const best = winners[0], worst = losers.find((x) => best && x.c.id !== best.c.id);
  if (best && worst && worst.cost >= best.cost * RULES.shiftMinRatio) {
    const move = Math.max(10, Math.round(worst.c.dailyBudget * RULES.shiftShare));
    const extra = move * 7 * (1 / best.cost - 1 / worst.cost) * RULES.dampening; // extra sales or leads per week
    const unitValue = salesMode ? (best.c.revenue30 > 0 ? best.c.revenue30 / best.c.won30 : v.avgDeal) : (v.perLead || best.cost);
    const A = short(worst.c.name), B = short(best.c.name);
    if (move < worst.c.dailyBudget && extra > 0) {
      const monthly = extra < 1;
      out.push({ kind: 'SHIFT_BUDGET', key: `SHIFT_BUDGET:${worst.c.id}:${best.c.id}`, impact: extra * unitValue,
        title: `להעביר ${m(move)} ביום מ"${A}" ל"${B}"`,
        why: salesMode
          ? `ב"${B}" מכירה עולה לך ${m(best.cost)} (${best.c.won30} מכירות בחודש` + (best.c.revenue30 > 0 ? `, ${m(best.c.revenue30)} הכנסות` : '') + `), וב"${A}" עלות למכירה היא ${m(worst.cost)}.`
          : `ב"${B}" ליד עולה ${m(best.cost)} (${best.c.leads7} לידים השבוע), וב"${A}" ${m(worst.cost)} (${worst.c.leads7} לידים, ${m(worst.c.spend7)} שהוצאו).`,
        impactText: `${range(monthly ? extra * 4.3 : extra)} ${salesMode ? 'מכירות נוספות' : 'לידים נוספים'} ${monthly ? 'בחודש' : 'בשבוע'}, באותו תקציב כולל.` + (salesMode ? ` זה בערך ${m(extra * unitValue)} הכנסות נוספות בשבוע.` : ''),
        action: { type: 'META', steps: [
          { intent: 'CHANGE_BUDGET', campaignId: worst.c.id, dailyBudget: Math.round(worst.c.dailyBudget - move), summary: `הורדת התקציב היומי של "${A}" מ־${m(worst.c.dailyBudget)} ל־${m(worst.c.dailyBudget - move)}` },
          { intent: 'CHANGE_BUDGET', campaignId: best.c.id, dailyBudget: Math.round(best.c.dailyBudget + move), summary: `הגדלת התקציב היומי של "${B}" מ־${m(best.c.dailyBudget)} ל־${m(best.c.dailyBudget + move)}` }
        ] } });
    }
  }

  for (const c of active) {
    if (num(c.ageDays) < RULES.shiftMinAgeDays || guard.has('FATIGUE:' + c.id)) continue;
    if (c.frequency7 >= RULES.fatigueFrequency && c.ctr30 > 0 && c.ctr7 > 0 && c.ctr7 <= c.ctr30 * RULES.fatigueCtrDrop && c.impressions7 >= RULES.fatigueMinImpressions) {
      const recovered = Math.max(1, c.leads7) * (c.ctr30 / c.ctr7 - 1) * 0.5;
      out.push({ kind: 'REFRESH_CREATIVE', key: 'REFRESH_CREATIVE:' + c.id, impact: recovered * (v.perLead || 0),
        title: `לרענן את המודעה בקמפיין "${short(c.name)}"`,
        why: `אותם אנשים ראו אותה בממוצע ${c.frequency7.toFixed(1)} פעמים, ופחות לוחצים: ירידה של ${Math.round((1 - c.ctr7 / c.ctr30) * 100)}% לעומת החודש.`,
        impactText: `מודעה חדשה עם זווית אחרת יכולה להחזיר ${range(recovered)} לידים בשבוע, לפני שהעלות לליד מטפסת.`,
        action: { type: 'TEXT', text: `תכין לי מודעה חדשה עם זווית אחרת לקמפיין ${short(c.name)}`, button: 'תכין מודעה חדשה' } });
    }
  }

  const crm = data.crm || {};
  const waiting = num(crm.waitingCount);
  if (waiting >= RULES.followUpMin) {
    const close = v.closeRate || RULES.defaultCloseRate, saved = waiting * close * 0.5; // a lead nobody calls back mostly goes cold
    const names = (crm.waitingNames || []).map((n) => String(n || '').trim().split(/\s+/)[0]).filter(Boolean).slice(0, 2);
    const who = names.length ? names.join(', ') + (waiting > names.length ? ` ועוד ${waiting - names.length}` : '') : `${waiting} לידים`;
    out.push({ kind: 'FOLLOW_UP_LEADS', key: 'FOLLOW_UP_LEADS', impact: Math.max(RULES.minWeeklyImpact, v.hasSales ? saved * v.avgDeal : waiting * 0.5 * (v.perLead || 0)),
      title: `לחזור היום ל־${waiting} לידים שמחכים יותר מיום`,
      why: `${who} השאירו פרטים ועוד לא קיבלו מענה.` + (v.hasSales ? ` אצלך בערך 1 מכל ${Math.max(2, Math.round(1 / v.closeRate))} לידים קונה, בממוצע ב־${m(v.avgDeal)}.` : ' ליד שמחכה מתקרר מהר, ומי שחוזר ראשון בדרך כלל סוגר.'),
      impactText: v.hasSales && saved >= 0.8 ? `${range(saved)} עסקאות שלא יתקררו, בערך ${m(saved * v.avgDeal)}.` : v.hasSales ? `סיכוי טוב לעסקה נוספת, בערך ${m(v.avgDeal)}.` : 'חזרה היום משפרת מאוד את הסיכוי שלפחות אחד מהם יהפוך ללקוח.',
      action: { type: 'TEXT', text: 'הלידים שלי', button: 'לראות את הלידים' } });
  }

  const noAmount = num(crm.wonNoAmount);
  if (noAmount >= 2 || (noAmount >= 1 && !v.hasSales)) {
    out.push({ kind: 'ADD_REVENUE', key: 'ADD_REVENUE', impact: RULES.minWeeklyImpact,
      title: noAmount === 1 ? 'לעדכן כמה שילם הלקוח שסגר' : `לעדכן כמה שילמו ${noAmount} הלקוחות שסגרו`,
      why: `${noAmount === 1 ? 'עסקה אחת סומנה' : noAmount + ' עסקאות סומנו'} כנסגרו בלי סכום. בלי הסכום אי אפשר לחשב עלות למכירה והחזר על הפרסום.`,
      impactText: 'מעכשיו אדע להגיד לך איזה קמפיין באמת מביא כסף, לא רק לידים.',
      action: { type: 'TEXT', text: 'הלידים שלי', button: 'לעדכן סכומים' } });
  }
  return out.filter((x) => Number.isFinite(x.impact) && x.impact >= RULES.minWeeklyImpact).sort((a, b) => b.impact - a.impact);
}

function message(advice) {
  return `☀️ ההמלצה של היום\n*${advice.title}*\n\n📊 למה: ${advice.why}\n💡 מה זה ייתן: ${advice.impactText}` + (advice.action.type === 'META' ? '\n\nשום שינוי לא יבוצע ב־Meta בלי אישור שלך.' : '');
}
const buttons = (advice, id) => [
  { title: advice.action.type === 'META' ? 'להכין לאישור' : advice.action.button, text: `/advice-yes ${id}` },
  { title: 'לא עכשיו', text: `/advice-later ${id}` },
  { title: 'דשבורד ביצועים', text: `/advice-dash ${id}` }
];

// Read-only data: Meta spend and leads per campaign (when connected) joined with CRM outcomes.
async function loadMeta(clientId) {
  const meta = require('./metaConnection');
  return meta.context.run(String(clientId), async () => {
    const c = await meta.credentials(clientId);
    if (!c?.meta_ad_account_id) return null;
    const acc = c.meta_ad_account_id, read = (path, params) => meta.tenantRead(path, params);
    const account = await read('/' + acc, { fields: 'currency' });
    const list = (await read('/' + acc + '/campaigns', { fields: 'id,name,effective_status,daily_budget,created_time', effective_status: JSON.stringify(['ACTIVE']), limit: 50 })).data || [];
    const by = {};
    for (const preset of ['last_7d', 'last_30d']) {
      const rows = list.length ? (await read('/' + acc + '/insights', { level: 'campaign', fields: 'campaign_id,spend,impressions,ctr,frequency,actions', date_preset: preset, limit: 100 })).data || [] : [];
      by[preset] = Object.fromEntries(rows.map((r) => [String(r.campaign_id), r]));
    }
    return { currency: account.currency || 'ILS', list, by };
  });
}

async function load(clientId, { metaLoader = loadMeta } = {}) {
  const leadsOf = require('./campaignGuard').leadsOf;
  let metaData = null;
  try { metaData = await metaLoader(clientId); } catch { metaData = null; } // CRM-only advice still works
  const q = (sql) => db.query(sql, [clientId]).then((r) => r.rows);
  const crm30 = await q(`SELECT campaign_id, COUNT(*)::int AS leads, COUNT(*) FILTER (WHERE created_at>NOW()-INTERVAL '7 days')::int AS leads7,
      COUNT(*) FILTER (WHERE status='WON')::int AS won, COALESCE(SUM(CASE WHEN status='WON' AND currency='ILS' THEN revenue_minor END),0)::bigint AS revenue_minor
    FROM crm_leads WHERE client_id=$1 AND campaign_id IS NOT NULL AND created_at>NOW()-INTERVAL '30 days' GROUP BY campaign_id`);
  const crmBy = Object.fromEntries(crm30.map((r) => [String(r.campaign_id), r]));
  const [totals] = await q(`SELECT COUNT(*)::int AS leads, COUNT(*) FILTER (WHERE status='WON')::int AS won,
      COUNT(*) FILTER (WHERE status='WON' AND revenue_minor IS NOT NULL AND currency='ILS')::int AS won_with_revenue,
      COUNT(*) FILTER (WHERE status='WON' AND revenue_minor IS NULL)::int AS won_no_amount,
      COALESCE(SUM(CASE WHEN status='WON' AND currency='ILS' THEN revenue_minor END),0)::bigint AS revenue_minor
    FROM crm_leads WHERE client_id=$1 AND created_at>NOW()-INTERVAL '90 days'`);
  const waiting = await q(`SELECT name FROM crm_leads WHERE client_id=$1 AND status='NEW' AND created_at<NOW()-INTERVAL '24 hours' AND created_at>NOW()-INTERVAL '14 days' ORDER BY created_at LIMIT 50`);
  const guardRecent = (await q(`SELECT DISTINCT kind, campaign_id FROM campaign_guard_alerts WHERE client_id=$1 AND sent_at>NOW()-INTERVAL '3 days'`)).map((r) => r.kind + ':' + r.campaign_id);
  const crm = { leads90: totals.leads, won90: totals.won, wonWithRevenue90: totals.won_with_revenue, revenue90: Number(totals.revenue_minor) / 100, wonNoAmount: totals.won_no_amount, waitingCount: waiting.length, waitingNames: waiting.map((r) => r.name) };
  if (!metaData) return { currency: 'ILS', campaigns: [], cpl30: null, crm, guardRecent };
  const now = Date.now(), all30 = Object.values(metaData.by.last_30d);
  const spend30 = all30.reduce((t, r) => t + num(r.spend), 0), leads30 = all30.reduce((t, r) => t + leadsOf(r), 0);
  const campaigns = metaData.list.filter((c) => /^\d{1,40}$/.test(String(c.id))).map((c) => {
    const d7 = metaData.by.last_7d[c.id] || {}, d30 = metaData.by.last_30d[c.id] || {}, k = crmBy[c.id] || {};
    return { id: String(c.id), name: c.name, status: c.effective_status, ageDays: c.created_time ? (now - new Date(c.created_time)) / 864e5 : 365,
      dailyBudget: num(c.daily_budget) / 100, spend7: num(d7.spend), leads7: Math.max(leadsOf(d7), num(k.leads7)), impressions7: num(d7.impressions), ctr7: num(d7.ctr), frequency7: num(d7.frequency),
      spend30: num(d30.spend), ctr30: num(d30.ctr), won30: num(k.won), revenue30: num(k.revenue_minor) / 100 };
  });
  return { currency: metaData.currency, campaigns, cpl30: leads30 > 0 ? spend30 / leads30 : null, crm, guardRecent };
}

// Owners with an open WhatsApp window (wrote in the last 24h) not yet advised today.
async function dueClients(day, only, limit = 100) {
  return (await db.query(`SELECT c.id, c.phone FROM clients c
    JOIN whatsapp_contacts w ON w.phone=c.phone AND w.last_inbound_at>NOW()-INTERVAL '24 hours'
    WHERE NOT EXISTS (SELECT 1 FROM daily_advice_runs r WHERE r.client_id=c.id AND r.day=$1::date)
      AND ($2::bigint[] IS NULL OR c.id=ANY($2::bigint[]))
    LIMIT $3`, [day, only || null, limit])).rows;
}

const inContext = (client, eventId, work) => require('./metaConnection').context.run(String(client.id), () =>
  require('./whatsappDelivery').messageContext.run({ eventId, sequence: 0 }, work));

async function adviseOne(client, day, loader) {
  const task = await require('./taskAgent').active(client.id).catch(() => null);
  if (task?.status === 'WAITING_APPROVAL' || await require('./leadCheckins').ownerBusy(client.id)) return 'BUSY'; // try again later this morning
  const claim = await db.query('INSERT INTO daily_advice_runs(client_id,day) VALUES($1,$2::date) ON CONFLICT DO NOTHING RETURNING client_id', [client.id, day]);
  if (!claim.rows.length) return 'ALREADY_RAN';
  const finish = async (result) => { await db.query('UPDATE daily_advice_runs SET result=$3 WHERE client_id=$1 AND day=$2::date', [client.id, day, result]); return result; };
  // One proactive message per morning: if the campaign guard already alerted, today's advice waits.
  if ((await db.query("SELECT 1 FROM campaign_guard_alerts WHERE client_id=$1 AND sent_at>NOW()-INTERVAL '12 hours' LIMIT 1", [client.id])).rows.length) return finish('GUARD_SENT');
  const recent = new Set((await db.query('SELECT advice_key FROM daily_advice WHERE client_id=$1 AND sent_at>NOW()-make_interval(days=>$2::int)', [client.id, RULES.cooldownDays])).rows.map((r) => r.advice_key));
  const pick = candidates(await loader(client.id)).find((x) => !recent.has(x.key));
  if (!pick) return finish('QUIET');
  const saved = await db.query(`INSERT INTO daily_advice(client_id,day,advice_key,kind,title,body,impact_text,impact_weekly,action) VALUES($1,$2::date,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT DO NOTHING RETURNING id`,
    [client.id, day, pick.key, pick.kind, pick.title, message(pick), pick.impactText, Math.round(pick.impact), JSON.stringify(pick.action)]);
  if (!saved.rows.length) return finish('ALREADY_RAN');
  const id = saved.rows[0].id;
  await inContext(client, `advice:${client.id}:${day}`, async () => {
    const ui = await require('./conversationUi').prepareChoices(client.id, message(pick), buttons(pick, id), 'guard_alert');
    await require('./whatsapp').safeSend(client.phone, ui.text, ui);
  });
  return finish('SENT');
}

async function runDue({ now = new Date(), loader = load, approve, onlyClientIds } = {}) {
  if (!enabled() || !db.configured()) return { status: 'NOT_DUE' };
  const continued = await continueShifts({ approve, onlyClientIds }).catch(() => { logger.warn('Daily advice follow-up skipped', { error: 'ADVICE_CONTINUE_FAILED' }); return []; });
  if (!morning(now)) return { status: 'NOT_DUE', continued };
  const day = israelTime(now).day, results = [];
  for (const client of await dueClients(day, onlyClientIds)) {
    try { results.push(await adviseOne(client, day, loader)); } catch (error) {
      logger.warn('Daily advice skipped', { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'ADVICE_FAILED' });
      results.push('FAILED');
    }
  }
  return { status: 'RAN', results, continued };
}

// Raise the approval for one Meta step of an advice. The step counter is claimed
// first, so two workers can never raise the same approval twice.
async function proposeStep(client, row, index, { approve, intro = '' } = {}) {
  const steps = row.action.steps || [], s = steps[index];
  const claim = await db.query("UPDATE daily_advice SET step=$3, status='APPROVED', responded_at=COALESCE(responded_at,NOW()) WHERE id=$1 AND step=$2 RETURNING id", [row.id, row.step, index + 1]);
  if (!claim.rows.length) return 'RACED';
  let approval;
  try {
    const { createActionPlan } = require('./actionPlan');
    const plan = createActionPlan({ intent: s.intent, summary: s.summary, target: { campaignId: String(s.campaignId) }, parameters: s.intent === 'CHANGE_BUDGET' ? { dailyBudget: String(s.dailyBudget) } : {} });
    approval = await (approve || require('./approvalEngine').createApprovalForClient)(client.id, plan);
  } catch (error) {
    await db.query('UPDATE daily_advice SET step=$2 WHERE id=$1 AND step=$3', [row.id, row.step, index + 1]);
    throw error;
  }
  await db.query('UPDATE daily_advice SET action_ids=array_append(action_ids,$2) WHERE id=$1', [row.id, String(approval.actionId)]);
  const stepNote = steps.length > 1 && index === 0 ? `\n\nשלב 1 מתוך ${steps.length}. אחרי שזה יבוצע, אכין לאישור את השלב הבא.` : '';
  const ui = await require('./conversationUi').prepareApproval(client.id, approval, (intro ? intro + '\n\n' : '') + require('./actionPlan').formatActionPlan(approval.actionPlan) + stepNote);
  await require('./whatsapp').safeSend(client.phone, ui.text, ui);
  return 'PROPOSED';
}

// After the owner approved step 1 of a budget move and Meta verified it, raise step 2.
async function continueShifts({ approve, onlyClientIds } = {}) {
  const rows = (await db.query(`SELECT d.*, c.phone FROM daily_advice d
    JOIN clients c ON c.id=d.client_id
    JOIN whatsapp_contacts w ON w.phone=c.phone AND w.last_inbound_at>NOW()-INTERVAL '24 hours'
    JOIN action_plans p ON p.client_id=d.client_id AND p.id=d.action_ids[cardinality(d.action_ids)] AND p.status='VERIFIED'
    WHERE d.status='APPROVED' AND d.step>0 AND d.step<jsonb_array_length(d.action->'steps') AND d.sent_at>NOW()-make_interval(days=>$1::int)
      AND ($2::bigint[] IS NULL OR d.client_id=ANY($2::bigint[]))
    LIMIT 50`, [RULES.approveWithinDays, onlyClientIds || null])).rows;
  const results = [];
  for (const row of rows) {
    const client = { id: row.client_id, phone: row.phone };
    try {
      const task = await require('./taskAgent').active(client.id).catch(() => null);
      if (task?.state?.steps?.some((x) => x.status === 'WAITING_APPROVAL')) { results.push('BUSY'); continue; }
      const done = row.action.steps[row.step - 1];
      results.push(await inContext(client, `advice-step:${row.id}:${row.step}`, () => proposeStep(client, row, row.step, { approve, intro: `✅ ${done.summary}: בוצע ואומת מול Meta.\nעכשיו השלב הבא:` })));
    } catch (error) {
      logger.warn('Daily advice step skipped', { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'ADVICE_STEP_FAILED' });
      results.push('FAILED');
    }
  }
  return results;
}

// The owner's answer to the advice buttons. Returns null for any other text;
// { route } hands a follow-up request back to the normal conversation.
async function handleReply(from, text, { approve } = {}) {
  const match = /^\/advice-(yes|later|dash) (\d{1,18})$/.exec(String(text || ''));
  if (!match || !db.configured()) return null;
  const client = await require('./clientStore').getOrCreateClient(from);
  const say = (t, ui) => require('./whatsapp').safeSend(from, t, ui);
  const row = (await db.query('SELECT * FROM daily_advice WHERE id=$1 AND client_id=$2', [match[2], client.id])).rows[0];
  if (!row) { await say('ההמלצה הזו כבר לא זמינה. אפשר לכתוב לי מה תרצה לבדוק.'); return { handled: true }; }
  if (match[1] === 'dash') {
    const link = await require('./dashboardLink').handle(client.id, 'דשבורד ביצועים');
    await say(link?.reply || 'הדשבורד עדיין לא זמין כרגע.');
    return { handled: true };
  }
  if (match[1] === 'later') {
    await db.query("UPDATE daily_advice SET status='DISMISSED', responded_at=NOW() WHERE id=$1 AND status='SENT'", [row.id]);
    await say('בסדר גמור 👍 לא אחזור על זה בימים הקרובים.');
    return { handled: true };
  }
  if (Date.now() - new Date(row.sent_at) > RULES.approveWithinDays * 864e5) { await say('ההמלצה הזו כבר ישנה והנתונים השתנו מאז. בבוקר העסקים הבא אשלח המלצה מעודכנת.'); return { handled: true }; }
  if (row.action.type === 'TEXT') {
    await db.query("UPDATE daily_advice SET status='APPROVED', responded_at=NOW() WHERE id=$1", [row.id]);
    return { handled: true, route: row.action.text };
  }
  const task = await require('./taskAgent').active(client.id).catch(() => null);
  if (task?.state?.steps?.some((s) => s.status === 'WAITING_APPROVAL')) { await say('יש משימה שמחכה לאישור שלך. סיימו או בטלו אותה קודם, כדי ששום אישור לא יידרס.'); return { handled: true }; }
  // Re-raise the current step if its approval was not completed (e.g. it expired), else the next one.
  let index = row.step;
  if (row.step > 0) {
    const last = row.action_ids[row.action_ids.length - 1];
    const verified = last && (await db.query("SELECT 1 FROM action_plans WHERE client_id=$1 AND id=$2 AND status='VERIFIED'", [client.id, last])).rows.length;
    if (!verified) index = row.step - 1;
  }
  if (index >= row.action.steps.length) { await say('השינוי הזה כבר בוצע ✅'); return { handled: true }; }
  try { await proposeStep(client, row, index, { approve }); } catch (error) {
    logger.warn('Daily advice approval not prepared', { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'ADVICE_APPROVAL_FAILED' });
    await say('לא הצלחתי להכין את השינוי מול Meta כרגע. אפשר לנסות שוב בעוד כמה דקות.');
  }
  return { handled: true };
}

// An approval raised from a daily advice may be approved even while a task owns the conversation.
async function ownsApproval(clientId, actionId) {
  return (await db.query('SELECT 1 FROM daily_advice WHERE client_id=$1 AND $2=ANY(action_ids)', [clientId, String(actionId)])).rows.length > 0;
}

// The latest open advice for the dashboard home "today" card.
async function todayItem(clientId) {
  const row = (await db.query("SELECT kind,title,impact_text FROM daily_advice WHERE client_id=$1 AND status IN ('SENT','APPROVED') AND sent_at>NOW()-make_interval(days=>$2::int) ORDER BY sent_at DESC LIMIT 1", [clientId, RULES.approveWithinDays])).rows[0];
  if (!row) return null;
  return { kind: 'DAILY_ADVICE', urgency: 2, text: '💡 ההמלצה של היום: ' + row.title, detail: row.impact_text, screen: ['FOLLOW_UP_LEADS', 'ADD_REVENUE'].includes(row.kind) ? 'leads' : 'performance' };
}

module.exports = { enabled, morning, israelTime, value, candidates, message, buttons, load, runDue, continueShifts, handleReply, ownsApproval, todayItem, RULES, KINDS };
