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
    FROM crm_leads WHERE client_id=$1 AND created_at>=NOW()-make_interval(days=>$2::int) GROUP BY status`, [clientId, days]);
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

// Meta spend for the period, from the Ads Insights API (metaInsights, cached with a sync time);
// null when no ad account is connected or readable. Never an estimate.
async function metaSpend(clientId, preset) {
  const r = await require('./metaInsights').safeAccountInsights(clientId, preset);
  if (!r) return null;
  const campaigns = {};
  for (const c of r.campaigns || []) campaigns[c.id] = { name: String(c.name || '').slice(0, 40), spend: c.spend, leads: c.leads };
  return { total: r.totals.spend, campaigns, currency: r.currency, impressions: r.totals.impressions, clicks: r.totals.clicks, metaLeads: r.totals.leads, costPerLead: r.totals.costPerLead, syncedAt: r.syncedAt };
}

// Source -> outcome: the same funnel per campaign, joined with that campaign's spend.
async function byCampaign(clientId, days, campaigns = {}) {
  const r = await db.query(`SELECT campaign_id, COUNT(*)::int AS leads,
      COUNT(*) FILTER (WHERE status IN ('APPOINTMENT','WON'))::int AS meetings,
      COUNT(*) FILTER (WHERE status='WON')::int AS won,
      COALESCE(SUM(CASE WHEN status='WON' AND currency='ILS' THEN revenue_minor END),0)::bigint AS revenue_minor
    FROM crm_leads WHERE client_id=$1 AND campaign_id IS NOT NULL AND created_at>=NOW()-make_interval(days=>$2::int)
    GROUP BY campaign_id ORDER BY COUNT(*) DESC LIMIT 10`, [clientId, days]);
  return r.rows.map((x) => {
    const spend = campaigns[x.campaign_id]?.spend ?? null;
    const won = x.won, leads = x.leads, revenue = Number(x.revenue_minor) / 100;
    return { id: x.campaign_id, name: campaigns[x.campaign_id]?.name || 'קמפיין ' + String(x.campaign_id).slice(-4), leads, meetings: x.meetings, won, revenue, spend,
      costPerLead: spend !== null && leads ? spend / leads : null, costPerCustomer: spend !== null && won ? spend / won : null };
  });
}

// A data-backed budget suggestion between campaigns; shown, never executed.
function budgetSuggestion(rows) {
  const enough = rows.filter((x) => x.leads >= 3 && x.spend !== null);
  if (enough.length < 2) return null;
  const best = [...enough].sort((a, b) => (b.won / b.leads) - (a.won / a.leads))[0];
  const worst = [...enough].sort((a, b) => (a.won / a.leads) - (b.won / b.leads))[0];
  if (best === worst || best.won === 0 || worst.won / worst.leads >= best.won / best.leads / 2) return null;
  return `״${best.name}״ סוגר ${Math.round(best.won / best.leads * 100)}% מהלידים לעומת ${Math.round(worst.won / worst.leads * 100)}% ב״${worst.name}״. כדאי לשקול להעביר אליו חלק מהתקציב. שום שינוי לא יבוצע בלי אישור שלך.`;
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
  if (f.staleUntouched > 0) steps.push(`יש ${f.staleUntouched} לידים שמחכים יותר מיום. כדאי לחזור אליהם היום, ליד שמחכה מתקרר מהר.`);
  if (spend > 0 && f.leads === 0) steps.push('הוצא כסף על פרסום אבל לא נכנסו לידים. כדאי לבדוק את הקמפיין, הקהל והטופס.');
  if (f.leads >= 5 && m.contactRate !== null && m.contactRate < 0.7) steps.push('פחות מ־70% מהלידים קיבלו מענה. מענה מהיר לכל ליד הוא הדרך הזולה ביותר להגדיל מכירות.');
  if (f.meetings > 0 && f.won === 0) steps.push('יש פגישות אבל עוד אין סגירות. כדאי לעדכן מי נסגר, ולבדוק את ההצעה והמחיר.');
  if (f.won > 0 && f.revenue === 0) steps.push('סומנו עסקאות שנסגרו בלי סכום. עדכון הסכום יאפשר לחשב אם הפרסום רווחי.');
  if (!steps.length && f.leads > 0) steps.push('הכול נראה טוב 👍 תמשיך לעדכן מה קורה עם כל ליד, ככה אדע להגיד לך מה באמת מביא כסף.');
  if (!steps.length) steps.push('עוד אין לידים בתקופה הזו. כשקמפיין יתחיל לרוץ, תראה כאן את כל הדרך מהפרסום ועד המכירה.');
  return steps.slice(0, 3);
}

async function build(clientId, preset = 'last_7d', { spendFor = metaSpend } = {}) {
  const days = PRESET_DAYS[preset];
  if (!days) throw Error('UNSUPPORTED_REPORT_PERIOD');
  const f = await funnel(clientId, days);
  const raw = await spendFor(clientId, preset);
  const spend = raw === null || raw === undefined ? null : typeof raw === 'number' ? raw : raw.total;
  const campaigns = await byCampaign(clientId, days, raw && typeof raw === 'object' ? raw.campaigns : {});
  const m = metrics(f, spend);
  // An ad account in another currency: never mix it with ILS revenue or show it as ₪.
  const foreign = raw && typeof raw === 'object' && raw.currency && raw.currency !== 'ILS';
  if (foreign) { m.costPerCustomer = null; m.revenuePerShekel = null; for (const c of campaigns) { c.costPerLead = null; c.costPerCustomer = null; } }
  const steps = nextSteps(f, m, spend || 0);
  const speed = await require('./leadSpeed').stats(clientId, days).catch(() => null);
  if (speed?.leads >= 3 && speed.avgMinutes > 60) steps.splice(f.staleUntouched > 0 ? 1 : 0, 0, `זמן התגובה הממוצע ללידים הוא ${speed.label}. מי שחוזר תוך 15 דקות סוגר הרבה יותר. ההודעה המוכנה בהתראה חוסכת את רוב הזמן.`);
  const suggestion = budgetSuggestion(campaigns);
  if (suggestion) steps.splice(1, 0, suggestion);
  // Every campaign that spent in the period, with its CRM results when there are any.
  const byId = Object.fromEntries(campaigns.map((x) => [x.id, x]));
  const metaCampaigns = Object.entries(raw && typeof raw === 'object' ? raw.campaigns : {}).map(([id, x]) => ({ id, name: x.name || 'קמפיין ' + id.slice(-4), spend: x.spend, leads: byId[id]?.leads || 0, won: byId[id]?.won || 0, revenue: byId[id]?.revenue || 0 })).sort((a, b) => b.spend - a.spend).slice(0, 20);
  // What Meta itself reports for the period (Insights), next to our CRM funnel.
  const ads = raw && typeof raw === 'object' ? { currency: raw.currency || null, impressions: raw.impressions ?? null, clicks: raw.clicks ?? null, leads: raw.metaLeads ?? null, costPerLead: raw.costPerLead ?? null, syncedAt: raw.syncedAt || null } : null;
  return { preset, days, funnel: f, spend, currency: ads?.currency || 'ILS', ads, metrics: m, speed, campaigns, metaCampaigns: require('./budgetControl').markWinners(metaCampaigns), nextSteps: steps.slice(0, 3) };
}

function format(report) {
  const { funnel: f, metrics: m, spend } = report;
  // Spend is in the ad account currency; revenue in the CRM is counted in ILS only.
  const money = report.currency && report.currency !== 'ILS' ? (v) => (v === null ? '—' : Math.round(v).toLocaleString('he-IL') + ' ' + report.currency) : ils;
  const mixed = report.currency && report.currency !== 'ILS';
  const lines = [`📊 הדוח העסקי שלך, ${report.days} הימים האחרונים`, ''];
  // The bottom line first: what the advertising brought in money, not clicks.
  if (f.won > 0) {
    const left = spend !== null ? f.revenue - spend : null;
    lines.push(`🏆 השורה התחתונה: ${f.won} מכירות` + (m.costPerCustomer !== null ? ` · ${ils(m.costPerCustomer)} עלות למכירה` : '') + (f.revenue ? ` · ${ils(f.revenue)} הכנסות` : '') + (left !== null && f.revenue ? ` · ${left >= 0 ? 'נשאר לך' : 'חסר'} ${ils(Math.abs(left))} אחרי הפרסום` : ''));
    lines.push('');
  }
  lines.push('💰 סכום שהוצא: ' + (spend === null ? 'אין חשבון פרסום מחובר (כדי לחבר, כתוב ״חבר את חשבון המודעות״)' : money(spend)));
  if (report.ads && report.ads.impressions !== null) lines.push(`👀 לפי Meta: ${Math.round(report.ads.impressions).toLocaleString('he-IL')} חשיפות, ${Math.round(report.ads.clicks).toLocaleString('he-IL')} קליקים, ${report.ads.leads} לידים` + (report.ads.costPerLead !== null ? ` (${money(report.ads.costPerLead)} לליד)` : ''));
  lines.push(`📥 לידים: ${f.leads}` + (m.costPerLead !== null && !mixed ? ` (${ils(m.costPerLead)} עלות לליד)` : ''));
  lines.push(`📞 קיבלו מענה: ${f.contacted} (${pct(m.contactRate)})`);
  if (report.speed?.leads) lines.push(`⏱ זמן תגובה ממוצע: ${report.speed.label}` + (report.speed.fastShare !== null ? ` (${pct(report.speed.fastShare)} תוך 15 דקות)` : ''));
  lines.push(`🤝 פגישות: ${f.meetings} (${pct(m.meetingRate)})`);
  lines.push(`✅ מכירות: ${f.won} (${pct(m.closeRate)})` + (m.costPerCustomer !== null ? `, ${ils(m.costPerCustomer)} עלות למכירה` : ''));
  lines.push('💵 הכנסות מהלידים: ' + ils(f.revenue) + (m.revenuePerShekel !== null ? ` (כל ₪1 בפרסום החזיר ₪${m.revenuePerShekel.toFixed(1)})` : ''));
  if (report.campaigns?.length) {
    lines.push('');
    lines.push('לפי קמפיין:');
    for (const c of report.campaigns.slice(0, 3)) {
      lines.push(`• ${c.name}: ${c.leads} לידים, ${c.won} מכירות` + (c.revenue ? `, ${ils(c.revenue)} הכנסות` : '') + (c.costPerCustomer !== null ? `, ${ils(c.costPerCustomer)} עלות למכירה` : c.costPerLead !== null ? `, ${ils(c.costPerLead)} עלות לליד` : ''));
    }
  }
  if (report.funnel.leads > 0 && report.funnel.won === 0) {
    lines.push('');
    lines.push('שים לב: עוד לא סימנת מכירות, אז אפשר למדוד לידים אבל עוד לא לדעת מאיזה קמפיין נוצרה הכנסה. כדי לסמן מכירה כתוב: הלידים שלי');
  }
  lines.push('');
  lines.push('מה כדאי לעשות עכשיו:');
  report.nextSteps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  lines.push('');
  lines.push('ההכנסות כאן לפני עלויות המוצר או השירות. לעדכון לידים כתוב: הלידים שלי');
  lines.push(require('./dashboardLink').hint('performance'));
  return lines.join('\n');
}

async function businessReport(clientId, preset = 'last_7d', options = {}) {
  return format(await build(clientId, preset, options));
}

module.exports = { build, format, businessReport, funnel, metrics, nextSteps, byCampaign, budgetSuggestion };
