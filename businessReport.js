'use strict';
// Business report: connects ad spend to leads, meetings, sales and revenue, in
// plain Hebrew, with the next actions an owner should take.
const db = require('./db');

const PRESET_DAYS = { last_7d: 7, last_14d: 14, last_30d: 30 };

// Lead funnel for leads created in the period, from the tenant CRM.
async function funnel(clientId, days) {
  const r = await db.query(`SELECT status, COUNT(*)::int AS n,
      COALESCE(SUM(CASE WHEN status='WON' AND currency='ILS' THEN revenue_minor END),0)::bigint AS revenue_minor,
      COUNT(*) FILTER (WHERE status='NEW' AND created_at<NOW()-INTERVAL '1 day')::int AS stale
    FROM crm_leads WHERE client_id=$1 AND created_at>=NOW()-make_interval(days=>$2) GROUP BY status`, [clientId, days]);
  const by = Object.fromEntries(r.rows.map((x) => [x.status, x]));
  const n = (s) => by[s]?.n || 0;
  const leads = r.rows.reduce((t, x) => t + x.n, 0);
  return {
    leads,
    untouched: n('NEW'),
    staleUntouched: by.NEW?.stale || 0,
    contacted: n('CONTACTED') + n('APPOINTMENT') + n('WON') + n('LOST'),
    meetings: n('APPOINTMENT') + n('WON'),
    won: n('WON'),
    lost: n('LOST'),
    revenue: Number(by.WON?.revenue_minor || 0) / 100
  };
}

// Meta spend for the period; null when no ad account is connected or readable.
async function metaSpend(clientId, preset) {
  try {
    const meta = require('./metaConnection');
    return await meta.context.run(String(clientId), async () => {
      const c = await meta.credentials(clientId);
      if (!c?.meta_ad_account_id) return null;
      const report = await require('./metaAds').getCampaignPerformance(c.meta_ad_account_id, preset);
      const spend = (report.data || []).reduce((t, row) => t + (Number(row.spend) || 0), 0);
      return Number.isFinite(spend) ? spend : null;
    });
  } catch { return null; }
}

function metrics(f, spend) {
  const div = (a, b) => (b > 0 && a !== null ? a / b : null);
  return {
    costPerLead: div(spend, f.leads),
    contactRate: div(f.contacted, f.leads),
    meetingRate: div(f.meetings, f.leads),
    closeRate: div(f.won, f.leads),
    costPerCustomer: div(spend, f.won),
    revenuePerShekel: div(f.revenue, spend)
  };
}

const ils = (v) => (v === null ? '—' : '₪' + Math.round(v).toLocaleString('he-IL'));
const pct = (v) => (v === null ? '—' : Math.round(v * 100) + '%');

// Deterministic next steps, most urgent first.
function nextSteps(f, m, spend) {
  const steps = [];
  if (f.staleUntouched > 0) steps.push(`יש ${f.staleUntouched} פניות שלא טופלו יותר מיום. כדאי לחזור אליהן היום, פנייה שמחכה מתקררת מהר.`);
  if (spend > 0 && f.leads === 0) steps.push('הייתה הוצאה על פרסום אבל לא נכנסו פניות. כדאי לבדוק את הקמפיין, הקהל והטופס.');
  if (f.leads >= 5 && m.contactRate !== null && m.contactRate < 0.7) steps.push('פחות מ־70% מהפניות קיבלו מענה. מענה מהיר לכל פנייה הוא הדרך הזולה ביותר להגדיל מכירות.');
  if (f.meetings > 0 && f.won === 0) steps.push('יש פגישות אבל עוד אין סגירות. כדאי לעדכן מי נסגר, ולבדוק את ההצעה והמחיר.');
  if (f.won > 0 && f.revenue === 0) steps.push('סומנו עסקאות שנסגרו בלי סכום. עדכון הסכום יאפשר לחשב אם הפרסום רווחי.');
  if (!steps.length && f.leads > 0) steps.push('המספרים יציבים. כדאי להמשיך לעדכן כל פנייה ב־CRM כדי שהדוח הבא יהיה מדויק יותר.');
  if (!steps.length) steps.push('עוד אין פניות בתקופה הזו. כשיתחיל קמפיין, הדוח יראה כאן את כל הדרך מהפרסום ועד המכירה.');
  return steps.slice(0, 3);
}

async function build(clientId, preset = 'last_7d', { spendFor = metaSpend } = {}) {
  const days = PRESET_DAYS[preset];
  if (!days) throw Error('UNSUPPORTED_REPORT_PERIOD');
  const f = await funnel(clientId, days);
  const spend = await spendFor(clientId, preset);
  const m = metrics(f, spend);
  return { preset, days, funnel: f, spend, metrics: m, nextSteps: nextSteps(f, m, spend || 0) };
}

function format(report) {
  const { funnel: f, metrics: m, spend } = report;
  const lines = [`📊 דוח עסקי ל־${report.days} הימים האחרונים`, ''];
  lines.push('💰 פרסום: ' + (spend === null ? 'אין חשבון מטא מחובר (אפשר לחבר עם /meta-connect)' : ils(spend)));
  lines.push(`📥 פניות: ${f.leads}` + (m.costPerLead !== null ? ` (${ils(m.costPerLead)} לפנייה)` : ''));
  lines.push(`📞 קיבלו מענה: ${f.contacted} (${pct(m.contactRate)})`);
  lines.push(`🤝 פגישות: ${f.meetings} (${pct(m.meetingRate)})`);
  lines.push(`✅ עסקאות שנסגרו: ${f.won} (${pct(m.closeRate)})` + (m.costPerCustomer !== null ? `, ${ils(m.costPerCustomer)} ללקוח` : ''));
  lines.push('💵 הכנסות מהפניות: ' + ils(f.revenue) + (m.revenuePerShekel !== null ? ` (כל ₪1 בפרסום החזיר ₪${m.revenuePerShekel.toFixed(1)})` : ''));
  lines.push('');
  lines.push('מה כדאי לעשות עכשיו:');
  report.nextSteps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  lines.push('');
  lines.push('ההכנסות כאן הן לפני עלויות המוצר או השירות. לעדכון פניות כתבו: לידים');
  return lines.join('\n');
}

async function businessReport(clientId, preset = 'last_7d', options = {}) {
  return format(await build(clientId, preset, options));
}

module.exports = { build, format, businessReport, funnel, metrics, nextSteps };
