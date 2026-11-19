'use strict';
// What the owner should do today, the setup checklist, a daily trend and the
// campaign list: one place that turns data into the next action.
const db = require('./db');
const GUARD_HE = { ACCOUNT: 'בעיה בחשבון המודעות', DELIVERY: 'קמפיין לא מוצג', WASTE: 'קמפיין מוציא כסף בלי פניות', WINNER: 'קמפיין מצליח, אפשר להגדיל', FATIGUE: 'המודעה נשחקת, כדאי לרענן' };

async function withMeta(clientId, work) {
  try {
    const meta = require('./metaConnection');
    return await meta.context.run(String(clientId), async () => {
      const c = await meta.credentials(clientId);
      if (!c?.meta_ad_account_id) return null;
      return await work(c.meta_ad_account_id);
    });
  } catch { return null; }
}

async function today(clientId) {
  const items = [];
  const approvals = (await db.query("SELECT COUNT(*)::int n FROM approvals WHERE client_id=$1 AND status='PENDING' AND expires_at>NOW()", [clientId])).rows[0].n;
  if (approvals) items.push({ kind: 'APPROVAL', urgency: 3, text: approvals === 1 ? 'פעולה אחת מחכה לאישור שלך' : `${approvals} פעולות מחכות לאישור שלך`, screen: 'approvals' });
  const waiting = (await db.query("SELECT COUNT(*)::int n, MIN(created_at) oldest FROM crm_leads WHERE client_id=$1 AND status='NEW' AND created_at<NOW()-INTERVAL '15 minutes'", [clientId])).rows[0];
  if (waiting.n) items.push({ kind: 'LEADS_WAITING', urgency: 3, text: waiting.n === 1 ? 'ליד אחד מחכה למענה' : `${waiting.n} לידים מחכים למענה`, detail: 'פנייה בדקות הראשונות מגדילה מאוד את הסיכוי לסגור', screen: 'leads' });
  const guard = (await db.query("SELECT DISTINCT ON (campaign_id,kind) campaign_id,kind FROM campaign_guard_alerts WHERE client_id=$1 AND sent_at>NOW()-INTERVAL '3 days' ORDER BY campaign_id,kind,sent_at DESC LIMIT 5", [clientId])).rows;
  for (const g of guard) items.push({ kind: 'GUARD_' + g.kind, urgency: g.kind === 'WINNER' ? 2 : 3, text: GUARD_HE[g.kind], screen: 'campaign' });
  const stale = (await db.query("SELECT COUNT(*)::int n FROM crm_leads WHERE client_id=$1 AND status IN ('CONTACTED','APPOINTMENT') AND updated_at<NOW()-INTERVAL '3 days'", [clientId])).rows[0].n;
  if (stale) items.push({ kind: 'LEADS_STALE', urgency: 2, text: `${stale} פניות בטיפול לא עודכנו 3 ימים`, detail: 'מה קרה איתן? עדכון קצר עוזר לדעת איזה קמפיין מביא כסף', screen: 'pipeline' });
  const noAmount = (await db.query("SELECT COUNT(*)::int n FROM crm_leads WHERE client_id=$1 AND status='WON' AND revenue_minor IS NULL", [clientId])).rows[0].n;
  if (noAmount) items.push({ kind: 'WON_NO_AMOUNT', urgency: 1, text: `${noAmount} עסקאות נסגרו בלי סכום`, detail: 'עם הסכום נוכל לחשב כמה החזיר כל שקל בפרסום', screen: 'leads' });
  const reminders = (await db.query(`SELECT COUNT(*)::int n FROM workspace_items WHERE client_id=$1 AND kind='tasks' AND payload->>'status'='OPEN' AND (payload->>'date') IS NOT NULL AND left(payload->>'date',10)<=to_char(NOW() AT TIME ZONE 'Asia/Jerusalem','YYYY-MM-DD')`, [clientId]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;
  if (reminders) items.push({ kind: 'TASKS_DUE', urgency: 2, text: reminders === 1 ? 'משימה אחת להיום' : `${reminders} משימות להיום`, screen: 'tasks' });
  return items.sort((a, b) => b.urgency - a.urgency);
}

// First-run setup: what is done and what is next.
async function checklist(clientId) {
  const c = (await db.query(`SELECT c.meta_ad_account_id, EXISTS(SELECT 1 FROM meta_connections m WHERE m.client_id=c.id AND m.expires_at>NOW()) AS connected,
    EXISTS(SELECT 1 FROM meta_lead_sources s WHERE s.client_id=c.id) AS leads,
    EXISTS(SELECT 1 FROM action_plans p WHERE p.client_id=c.id AND p.intent IN ('CREATE_BUNDLE','CREATE_CAMPAIGN') AND p.status IN ('APPROVED','VERIFIED')) AS campaign
    FROM clients c WHERE c.id=$1`, [clientId])).rows[0] || {};
  const steps = [
    { id: 'meta', title: 'לחבר את חשבון הפרסום של Meta', done: !!(c.connected && c.meta_ad_account_id), screen: 'integrations' },
    { id: 'campaign', title: 'להכין קמפיין ראשון עם הסוכן', done: !!c.campaign, screen: 'agent' },
    { id: 'leads', title: 'לחבר טופס לידים כדי שכל פנייה תיכנס לכאן', done: !!c.leads, screen: 'integrations' }
  ];
  return { steps, done: steps.filter((s) => s.done).length, total: steps.length };
}

// Daily leads (CRM) and spend (Meta) for the last N days, and the change vs the N days before.
async function trend(clientId, days = 14) {
  const rows = (await db.query(`SELECT to_char(d,'YYYY-MM-DD') AS day, COALESCE(n,0)::int AS leads FROM generate_series((NOW() AT TIME ZONE 'Asia/Jerusalem')::date-($2::int-1),(NOW() AT TIME ZONE 'Asia/Jerusalem')::date,'1 day') d
    LEFT JOIN (SELECT (created_at AT TIME ZONE 'Asia/Jerusalem')::date AS day, COUNT(*) n FROM crm_leads WHERE client_id=$1 GROUP BY 1) l ON l.day=d ORDER BY d`, [clientId, days])).rows;
  const previous = (await db.query(`SELECT COUNT(*)::int n FROM crm_leads WHERE client_id=$1 AND created_at>=NOW()-make_interval(days=>$2::int*2) AND created_at<NOW()-make_interval(days=>$2::int)`, [clientId, days])).rows[0].n;
  const spend = await withMeta(clientId, async (account) => {
    const r = await require('./metaConnection').tenantRead('/' + account + '/insights', { fields: 'spend', time_increment: 1, date_preset: days === 30 ? 'last_30d' : 'last_14d', limit: 100 });
    return Object.fromEntries((r.data || []).map((x) => [x.date_start, Number(x.spend) || 0]));
  });
  const series = rows.map((r) => ({ day: r.day, leads: r.leads, spend: spend ? (spend[r.day] || 0) : null }));
  const current = series.reduce((t, x) => t + x.leads, 0);
  return { days, series, leads: current, previousLeads: previous, change: previous ? (current - previous) / previous : null };
}

// Campaigns in the connected account with their delivery status.
async function campaigns(clientId) {
  const list = await withMeta(clientId, async (account) => (await require('./metaAds').getCampaigns(account)).data || []);
  if (!list) return { connected: false, campaigns: [] };
  return { connected: true, campaigns: list.filter((c) => /^\d{1,40}$/.test(String(c.id))).map((c) => ({ id: String(c.id), name: String(c.name || '').slice(0, 80), status: c.effective_status || c.status, dailyBudget: c.daily_budget ? Number(c.daily_budget) / 100 : null })) };
}

module.exports = { today, checklist, trend, campaigns, GUARD_HE };
