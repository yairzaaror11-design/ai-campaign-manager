'use strict';
// SCORPIO's daily media-buyer routine. Read-only checks of every active campaign:
// account/delivery problems, money spent without leads, winners worth scaling and
// worn-out creative. It only ever *proposes*: pausing needs the owner's approval
// button, scaling and new creative go through the normal approved task flow.
const db = require('./db');
const { logger } = require('./logger');

const enabled = () => process.env.CAMPAIGN_GUARD_ENABLED !== 'false';
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const SYMBOL = { ILS: '₪', USD: '$', EUR: '€' };
const money = (v, cur) => Math.round(v) + ' ' + (SYMBOL[cur] || cur || '');
const RULES = { learningHours: 72, minImpressions: 3000, wasteMinSpend: 150, wasteCplMultiple: 2.5, winnerMinLeads: 5, winnerCplRatio: 0.7, winnerMinAgeDays: 7, fatigueFrequency: 3.5, fatigueCtrDrop: 0.7, alertCooldownDays: 3, burnBudgetShare: 0.75, burnMinSpend: 20, highCplMultiple: 3, highCplMinSpend: 50, middayHour: 12, intradaySlots: [12, 16], intradayCooldownHours: 20 };
const INTRADAY_KINDS = ['SPEND_CAP', 'BURN_NO_LEADS', 'HIGH_CPL'];
const LEAD_ACTIONS = ['lead', 'onsite_conversion.lead_grouped', 'leadgen_grouped', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.messaging_conversation_started_7d'];
function leadsOf(row) {
  const counts = (row?.actions || []).filter((a) => LEAD_ACTIONS.includes(a.action_type)).map((a) => num(a.value));
  return counts.length ? Math.max(...counts) : 0;
}
const ACCOUNT_STATUS = { 2: 'חשבון הפרסום הושבת על ידי Meta', 3: 'יש חוב פתוח בחשבון הפרסום (התשלום לא עבר)', 7: 'חשבון הפרסום בבדיקה של Meta', 8: 'יש תשלום שממתין לסגירה', 9: 'חשבון הפרסום בתקופת חסד בגלל תשלום' };

// Pure decision: what does a professional media buyer flag right now?
function evaluate({ account = {}, campaigns = [], now = new Date() }) {
  const findings = [], cur = account.currency || 'ILS';
  if (account.account_status && account.account_status !== 1) {
    findings.push({ kind: 'ACCOUNT', campaignId: 'account', priority: 0, text: `⚠️ ${ACCOUNT_STATUS[account.account_status] || 'יש בעיה בחשבון הפרסום'}.\nכל עוד זה ככה, הקמפיינים לא רצים ואתה מפספס פניות.\nכדאי להיכנס לחשבון הפרסום ב־Meta ולסדר את זה. אם צריך, אסביר בדיוק מה ללחוץ.` });
    return findings;
  }
  const cpl30 = account.leads30 > 0 ? account.spend30 / account.leads30 : null;
  for (const c of campaigns) {
    const name = String(c.name || 'הקמפיין').slice(0, 40);
    const ageHours = c.created_time ? (now - new Date(c.created_time)) / 36e5 : 1e9;
    if (['WITH_ISSUES', 'DISAPPROVED'].includes(c.effective_status)) {
      findings.push({ kind: 'DELIVERY', campaignId: c.id, priority: 1, text: `⚠️ הקמפיין "${name}" ${c.effective_status === 'DISAPPROVED' ? 'נדחה על ידי Meta' : 'נתקע ולא מציג מודעות'}.\nבינתיים הוא לא מביא פניות. כתוב לי "מה הבעיה בקמפיין ${name}" ואבדוק מה צריך לתקן.`, choices: [{ title: 'תבדוק מה הבעיה', text: `מה הבעיה בקמפיין ${name}` }] });
      continue;
    }
    if (c.effective_status !== 'ACTIVE' || ageHours < RULES.learningHours) continue;
    const d7 = c.d7 || {}, d3 = c.d3 || {}, d30 = c.d30 || {};
    const spend7 = num(d7.spend), leads7 = Math.max(leadsOf(d7), num(c.crmLeads7)), imp7 = num(d7.impressions);
    const wasteAt = Math.max(RULES.wasteMinSpend, cpl30 ? cpl30 * RULES.wasteCplMultiple : 0);
    if (leads7 === 0 && spend7 >= wasteAt && imp7 >= RULES.minImpressions) {
      findings.push({ kind: 'WASTE', campaignId: c.id, campaignName: name, priority: 2, pause: true, text: `💸 הקמפיין "${name}" הוציא ${money(spend7, cur)} בשבוע האחרון ועוד לא הביא אף פנייה.\nמנהל קמפיינים היה עוצר אותו עכשיו ובודק את המודעה או את ההצעה, לפני שממשיכים לשלם.` + (cpl30 ? `\nלהשוואה: בחודש האחרון פנייה עלתה לך בממוצע ${money(cpl30, cur)}.` : '') });
      continue;
    }
    const cpl7 = leads7 ? spend7 / leads7 : null;
    if (cpl7 && cpl30 && leads7 >= RULES.winnerMinLeads && cpl7 <= cpl30 * RULES.winnerCplRatio && ageHours >= RULES.winnerMinAgeDays * 24) {
      const daily = num(c.daily_budget) / 100, extra = daily ? daily * 0.2 * 30 : null;
      findings.push({ kind: 'WINNER', campaignId: c.id, priority: 3, text: `🚀 הקמפיין "${name}" עובד מצוין: ${leads7} פניות השבוע, ${money(cpl7, cur)} לפנייה (הממוצע שלך ${money(cpl30, cur)}).\nזה הזמן להגדיל בזהירות, 20% בכל פעם, כדי לקבל עוד פניות באותו מחיר.` + (extra ? `\nתוספת של 20% = בערך ${money(extra, cur)} בחודש, כ־${Math.max(1, Math.round(extra / cpl7))} פניות נוספות לפי המחיר הנוכחי.` : ''), choices: [{ title: 'להגדיל ב־20%', text: `תגדיל את התקציב של הקמפיין ${name} ב־20%` }, { title: 'להשאיר ככה', text: 'להשאיר את התקציב ככה' }] });
      continue;
    }
    const freq = num(d7.frequency), ctr3 = num(d3.ctr), ctr30 = num(d30.ctr);
    if (freq >= RULES.fatigueFrequency && ctr30 > 0 && ctr3 > 0 && ctr3 <= ctr30 * RULES.fatigueCtrDrop && num(d3.impressions) >= 2000) {
      findings.push({ kind: 'FATIGUE', campaignId: c.id, priority: 4, text: `🔁 המודעות בקמפיין "${name}" מתחילות להישחק: אותם אנשים ראו אותן בממוצע ${freq.toFixed(1)} פעמים, ופחות לוחצים (ירידה של ${Math.round((1 - ctr3 / ctr30) * 100)}%).\nבדרך כלל זה הזמן להוסיף מודעה חדשה עם זווית אחרת, לפני שהמחיר לפנייה עולה.`, choices: [{ title: 'תכין מודעה חדשה', text: `תכין לי מודעה חדשה עם זווית אחרת לקמפיין ${name}` }, { title: 'לא עכשיו', text: 'לא עכשיו' }] });
    }
  }
  return findings.sort((a, b) => a.priority - b.priority);
}

async function load(clientId) {
  const meta = require('./metaConnection');
  return meta.context.run(String(clientId), async () => {
    const c = await meta.credentials(clientId);
    if (!c.meta_ad_account_id) return null;
    const acc = c.meta_ad_account_id, read = (path, params) => meta.tenantRead(path, params);
    const account = await read('/' + acc, { fields: 'account_status,currency' });
    const list = (await read('/' + acc + '/campaigns', { fields: 'id,name,effective_status,daily_budget,created_time', effective_status: JSON.stringify(['ACTIVE', 'WITH_ISSUES', 'DISAPPROVED']), limit: 50 })).data || [];
    if (!list.length) return { account, campaigns: [] };
    const fields = 'campaign_id,spend,impressions,ctr,frequency,actions';
    const byPreset = {};
    for (const preset of ['last_3d', 'last_7d', 'last_30d']) {
      const rows = (await read('/' + acc + '/insights', { level: 'campaign', fields, date_preset: preset, limit: 100 })).data || [];
      byPreset[preset] = Object.fromEntries(rows.map((r) => [String(r.campaign_id), r]));
    }
    const all30 = Object.values(byPreset.last_30d);
    account.spend30 = all30.reduce((t, r) => t + num(r.spend), 0);
    account.leads30 = all30.reduce((t, r) => t + leadsOf(r), 0);
    const crm = (await db.query(`SELECT campaign_id, COUNT(*)::int AS n FROM crm_leads WHERE client_id=$1 AND campaign_id IS NOT NULL AND created_at>NOW()-INTERVAL '7 days' GROUP BY campaign_id`, [clientId])).rows;
    const crmBy = Object.fromEntries(crm.map((r) => [String(r.campaign_id), r.n]));
    return { account, accountId: acc, campaigns: list.map((x) => ({ ...x, d3: byPreset.last_3d[x.id], d7: byPreset.last_7d[x.id], d30: byPreset.last_30d[x.id], crmLeads7: crmBy[x.id] || 0 })) };
  });
}

async function recentlyAlerted(clientId, f) {
  const hours = INTRADAY_KINDS.includes(f.kind) ? RULES.intradayCooldownHours : RULES.alertCooldownDays * 24;
  return (await db.query(`SELECT 1 FROM campaign_guard_alerts WHERE client_id=$1 AND campaign_id=$2 AND kind=$3 AND sent_at>NOW()-make_interval(hours=>$4::int)`, [clientId, String(f.campaignId), f.kind, hours])).rows.length > 0;
}

async function send(client, finding, accountId) {
  const meta = require('./metaConnection');
  return meta.context.run(String(client.id), () => require('./whatsappDelivery').messageContext.run({ eventId: `guard:${client.id}:${finding.kind}:${finding.campaignId}:${new Date().toISOString().slice(0, 10)}`, sequence: 0 }, async () => {
    let actionId = null;
    if (finding.pause) {
      const { createActionPlan, formatActionPlan } = require('./actionPlan');
      // Work agreement: if the owner allowed "לעצור קמפיין שמפסיד כסף", the agent pauses and reports; otherwise it asks.
      const outcome = await require('./workAgreement').proposeOrAct(client.id, createActionPlan({ intent: 'PAUSE_CAMPAIGN', summary: finding.pauseSummary || `השהיית הקמפיין "${finding.campaignName}" שמוציא כסף בלי פניות`, target: { accountId, campaignId: finding.campaignId } }), { reason: String(finding.text || '').split('\n')[0].slice(0, 300) });
      actionId = outcome.autonomous ? outcome.actionId : outcome.approval.actionId;
      await db.query('INSERT INTO campaign_guard_alerts(client_id,campaign_id,kind,action_id) VALUES($1,$2,$3,$4)', [client.id, String(finding.campaignId), finding.kind, actionId]);
      if (outcome.autonomous) { await require('./whatsapp').safeSend(client.phone, finding.text + '\n\n' + outcome.text); return outcome.ok ? 'PAUSED_BY_AGREEMENT' : 'AGREEMENT_ACTION_FAILED'; }
      const approval = outcome.approval;
      const ui = await require('./conversationUi').prepareApproval(client.id, approval, finding.text + '\n\n' + formatActionPlan(approval.actionPlan) + (outcome.askWhy ? '\n' + outcome.askWhy : ''));
      await require('./whatsapp').safeSend(client.phone, ui.text, ui);
      return 'PROPOSED_PAUSE';
    }
    await db.query('INSERT INTO campaign_guard_alerts(client_id,campaign_id,kind) VALUES($1,$2,$3)', [client.id, String(finding.campaignId), finding.kind]);
    if (finding.choices?.length) {
      const ui = await require('./conversationUi').prepareChoices(client.id, finding.text, finding.choices, 'guard_alert');
      await require('./whatsapp').safeSend(client.phone, ui.text, ui);
    } else await require('./whatsapp').safeSend(client.phone, finding.text);
    return 'ALERTED';
  }));
}

// Owners with a Meta connection and an open WhatsApp window, not yet reviewed today.
async function dueClients(limit = 100) {
  return (await db.query(`SELECT c.id, c.phone FROM clients c
    JOIN meta_connections m ON m.client_id=c.id AND m.expires_at>NOW()
    JOIN whatsapp_contacts w ON w.phone=c.phone AND w.last_inbound_at>NOW()-INTERVAL '24 hours'
    WHERE c.meta_ad_account_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM campaign_guard_runs r WHERE r.client_id=c.id AND r.day=(NOW() AT TIME ZONE 'Asia/Jerusalem')::date)
    LIMIT $1`, [limit])).rows;
}

async function runDue({ now = new Date(), loader = load, intradayLoader = loadToday } = {}) {
  if (!enabled() || !db.configured() || !require('./leadCheckins').businessHours(now)) return { status: 'NOT_DUE' };
  const daily = await runDaily({ now, loader });
  return { ...daily, intraday: await runIntraday({ now, loader: intradayLoader }) };
}

async function runDaily({ now, loader }) {
  const results = [];
  for (const client of await dueClients()) {
    try {
      const task = await require('./taskAgent').active(client.id).catch(() => null);
      if (task?.status === 'WAITING_APPROVAL' || await require('./leadCheckins').ownerBusy(client.id)) { results.push('BUSY'); continue; }
      const claim = await db.query(`INSERT INTO campaign_guard_runs(client_id,day) VALUES($1,(NOW() AT TIME ZONE 'Asia/Jerusalem')::date) ON CONFLICT DO NOTHING RETURNING client_id`, [client.id]);
      if (!claim.rows.length) { results.push('ALREADY_RAN'); continue; }
      const data = await loader(client.id);
      if (!data) { results.push('NO_ACCOUNT'); continue; }
      let sent = 'QUIET';
      for (const f of evaluate({ ...data, now })) {
        if (await recentlyAlerted(client.id, f)) continue;
        sent = await send(client, f, data.accountId); break; // one message per owner per day
      }
      results.push(sent);
    } catch (error) {
      logger.warn('Campaign guard skipped', { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'GUARD_FAILED' });
      results.push('FAILED');
    }
  }
  return { status: 'RAN', results };
}

// ---- Spend safety: a midday look at today's money (the owner's cap and runaway campaigns).
const israelHour = (now) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }).format(now));

// Pure decision on today's numbers. Proposes pausing, never pauses.
function evaluateToday({ account = {}, campaigns = [], cap = null, now = new Date() }) {
  const findings = [], cur = account.currency || 'ILS';
  if (account.account_status && account.account_status !== 1) return findings;
  const cpl30 = account.leads30 > 0 ? account.spend30 / account.leads30 : null;
  const midday = israelHour(now) >= RULES.middayHour;
  let total = 0;
  for (const c of campaigns) {
    const spend = num(c.today?.spend), leads = Math.max(leadsOf(c.today), num(c.crmLeadsToday)), budget = num(c.dailyBudget);
    total += spend;
    if (c.effective_status !== 'ACTIVE') continue;
    const name = String(c.name || 'הקמפיין').slice(0, 40);
    if (midday && leads === 0 && budget > 0 && spend >= budget * RULES.burnBudgetShare && spend >= RULES.burnMinSpend) {
      findings.push({ kind: 'BURN_NO_LEADS', campaignId: c.id, campaignName: name, priority: 1, pause: true,
        pauseSummary: `השהיית הקמפיין "${name}" שהוציא היום ${money(spend, cur)} בלי פניות`,
        text: `🚨 שים לב: הקמפיין "${name}" כבר הוציא היום ${money(spend, cur)} מתוך תקציב יומי של ${money(budget, cur)} (${Math.round((spend / budget) * 100)}%), ועוד אין אף פנייה.\nזה לא נראה כמו יום רגיל. אני ממליץ לעצור אותו עכשיו ולבדוק מה קרה, לפני שהיום נגמר.\nלא עצרתי כלום בלי אישור שלך.` });
      continue;
    }
    const cpl = leads ? spend / leads : null;
    if (cpl && cpl30 && cpl >= cpl30 * RULES.highCplMultiple && spend >= Math.max(RULES.highCplMinSpend, cpl30 * RULES.highCplMultiple)) {
      findings.push({ kind: 'HIGH_CPL', campaignId: c.id, campaignName: name, priority: 2, pause: true,
        pauseSummary: `השהיית הקמפיין "${name}" שהעלות לליד בו היום גבוהה מאוד`,
        text: `⚠️ הקמפיין "${name}" יקר היום בצורה חריגה: עלות לליד ${money(cpl, cur)}, בערך פי ${Math.round(cpl / cpl30)} מהממוצע שלך בחודש האחרון (${money(cpl30, cur)}).\nסכום שהוצא היום: ${money(spend, cur)}, לידים: ${leads}.\nאפשר לעצור אותו להיום ולבדוק. לא עצרתי כלום בלי אישור שלך.` });
    }
  }
  if (cap && total > cap) {
    findings.push({ kind: 'SPEND_CAP', campaignId: 'account', priority: 0,
      text: `💰 היום כבר הוצאו ${money(total, cur)} על פרסום, מעל תקרת ההוצאה היומית שקבעת (${money(cap, cur)}).\nלא עצרתי כלום בלי אישור שלך. אם תרצה לעצור קמפיין, כתוב לי "תעצור את הקמפיין" ואת השם שלו.\nאם התקרה נמוכה מדי, כתוב "תקרה יומית" ומספר חדש.` });
  }
  return findings.sort((a, b) => a.priority - b.priority);
}

async function loadToday(clientId) {
  const meta = require('./metaConnection');
  return meta.context.run(String(clientId), async () => {
    const c = await meta.credentials(clientId);
    if (!c.meta_ad_account_id) return null;
    const acc = c.meta_ad_account_id, read = (path, params) => meta.tenantRead(path, params);
    const account = await read('/' + acc, { fields: 'account_status,currency' });
    const list = (await read('/' + acc + '/campaigns', { fields: 'id,name,effective_status,daily_budget', effective_status: JSON.stringify(['ACTIVE']), limit: 50 })).data || [];
    if (!list.length) return { account, accountId: acc, campaigns: [] };
    // SCORPIO sets budgets on the ad sets; campaign budgets (CBO) win when present.
    const sets = (await read('/' + acc + '/adsets', { fields: 'campaign_id,daily_budget', effective_status: JSON.stringify(['ACTIVE']), limit: 200 })).data || [];
    const setBudget = {};
    for (const s of sets) setBudget[s.campaign_id] = (setBudget[s.campaign_id] || 0) + num(s.daily_budget);
    const rows = (await read('/' + acc + '/insights', { level: 'campaign', fields: 'campaign_id,spend,actions', date_preset: 'today', limit: 100 })).data || [];
    const today = Object.fromEntries(rows.map((r) => [String(r.campaign_id), r]));
    const month = ((await read('/' + acc + '/insights', { fields: 'spend,actions', date_preset: 'last_30d' })).data || [])[0] || {};
    account.spend30 = num(month.spend); account.leads30 = leadsOf(month);
    const crm = (await db.query(`SELECT campaign_id, COUNT(*)::int AS n FROM crm_leads WHERE client_id=$1 AND campaign_id IS NOT NULL AND created_at>=date_trunc('day', NOW() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem' GROUP BY campaign_id`, [clientId])).rows;
    const crmBy = Object.fromEntries(crm.map((r) => [String(r.campaign_id), r.n]));
    return { account, accountId: acc, campaigns: list.map((x) => ({ ...x, dailyBudget: (num(x.daily_budget) || setBudget[x.id] || 0) / 100, today: today[x.id], crmLeadsToday: crmBy[x.id] || 0 })) };
  });
}

// Owners with active Meta + open WhatsApp window, and a midday slot not yet checked today.
async function dueToday(slot, limit = 100) {
  return (await db.query(`SELECT c.id, c.phone FROM clients c
    JOIN meta_connections m ON m.client_id=c.id AND m.expires_at>NOW()
    JOIN whatsapp_contacts w ON w.phone=c.phone AND w.last_inbound_at>NOW()-INTERVAL '24 hours'
    WHERE c.meta_ad_account_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM campaign_guard_intraday_runs r WHERE r.client_id=c.id AND r.day=(NOW() AT TIME ZONE 'Asia/Jerusalem')::date AND r.slot=$1)
    LIMIT $2`, [slot, limit])).rows;
}

async function runIntraday({ now = new Date(), loader = loadToday } = {}) {
  const hour = israelHour(now), slot = [...RULES.intradaySlots].reverse().find((h) => hour >= h);
  if (!enabled() || !db.configured() || !slot || !require('./leadCheckins').businessHours(now)) return { status: 'NOT_DUE' };
  const results = [];
  for (const client of await dueToday(slot)) {
    try {
      // Creating a pause approval would supersede a pending one, so wait for a calm moment.
      const task = await require('./taskAgent').active(client.id).catch(() => null);
      if (task?.status === 'WAITING_APPROVAL' || await require('./leadCheckins').ownerBusy(client.id)) { results.push('BUSY'); continue; }
      const claim = await db.query(`INSERT INTO campaign_guard_intraday_runs(client_id,day,slot) VALUES($1,(NOW() AT TIME ZONE 'Asia/Jerusalem')::date,$2) ON CONFLICT DO NOTHING RETURNING client_id`, [client.id, slot]);
      if (!claim.rows.length) { results.push('ALREADY_RAN'); continue; }
      const data = await loader(client.id);
      if (!data) { results.push('NO_ACCOUNT'); continue; }
      const cap = await require('./spendCap').get(client.id);
      const sent = [];
      let proposed = false;
      for (const f of evaluateToday({ ...data, cap, now })) {
        if ((f.pause && proposed) || await recentlyAlerted(client.id, f)) continue;
        sent.push(await send(client, f, data.accountId));
        if (f.pause) proposed = true; // one pause button at a time
      }
      results.push(sent.length ? sent.join('+') : 'QUIET');
    } catch (error) {
      logger.warn('Spend guard skipped', { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'GUARD_FAILED' });
      results.push('FAILED');
    }
  }
  return { status: 'RAN', results };
}

// A pause proposal raised by the guard may be approved even while a task owns the conversation.
async function ownsApproval(clientId, actionId) {
  return (await db.query('SELECT 1 FROM campaign_guard_alerts WHERE client_id=$1 AND action_id=$2', [clientId, String(actionId)])).rows.length > 0;
}

module.exports = { enabled, evaluate, evaluateToday, runDue, runIntraday, ownsApproval, leadsOf, RULES };
