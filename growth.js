'use strict';
// Growth: what turns leads into money and money into more customers, for every business type
// (verticalProfiles.js holds the per-type words):
//  1. Funnels: who a campaign is for and what its lead form asks; every lead carries its funnel.
//  2. Deal value in the business's own terms (real estate: price × commission %), so the
//     report's "נשאר לך אחרי הפרסום" is real money.
//  3. Team: new leads are routed to a member (round-robin or by area/item); members who opted
//     in on WhatsApp get the lead; per-member mini report; the owner sees everything.
//  4. After-sale loop: thank-you + Google review link, later a referral ask, and a profile-specific
//     reminder for past customers. The agent sends by itself only when the owner approved the
//     cadence once, the customer agreed to messages, and an approved WhatsApp template exists;
//     otherwise the owner gets a ready message to send from his own WhatsApp in one tap.
//     Every customer message offers "הסר"; opted-out customers are never contacted again.
const crypto = require('node:crypto');
const db = require('./db');
const { logger } = require('./logger');
const vp = require('./verticalProfiles');

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const digits = (v) => String(v || '').replace(/\D/g, '');
const clean = (s, max) => String(s || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
const firstName = (name) => (name && name !== 'ליד מ־Meta' ? clean(name, 60).split(' ')[0].slice(0, 30) : '');
const ils = (minor) => Math.round(Number(minor) / 100).toLocaleString('en-US') + ' ₪';
const fail = (code) => Error(code);
const quiet = (error) => (/^[A-Z_]+$/.test(error?.message || '') ? error.message : 'GROWTH_FAILED');
const OPT_OUT_LINE = 'לא רוצים לקבל מאיתנו הודעות? כתבו ״הסר״.';
const OPT_OUT = /^(?:הסר|הסירו|הסירו אותי|הסר אותי|להסיר|תסירו|תסירו אותי|stop|unsubscribe|לא מעוניין|לא מעוניינת|אל תשלחו לי)[.!\s]*$/i;

async function vertical(clientId) { return (await vp.detect(clientId)).key; }

// ---------- settings ----------
const DEFAULTS = { commission_pct: 2, rent_commission_pct: 100, review_url: null, routing: 'OWNER', rr_cursor: 0, outreach_approved_at: null, referral_days: 14, winback_days: null };
async function settings(clientId) {
  const row = (await db.query('SELECT * FROM growth_settings WHERE client_id=$1', [clientId])).rows[0];
  const s = { ...DEFAULTS, ...(row || {}) };
  s.commission_pct = Number(s.commission_pct); s.rent_commission_pct = Number(s.rent_commission_pct);
  return s;
}
function reviewUrl(v) {
  if (v === '' || v === null) return null;
  let u;
  try { u = new URL(String(v).trim()); } catch { throw fail('INVALID_REVIEW_URL'); }
  if (u.protocol !== 'https:' || u.href.length > 500 || u.username || u.password) throw fail('INVALID_REVIEW_URL');
  return u.href;
}
async function saveSettings(clientId, input = {}) {
  const allowed = ['commissionPct', 'rentCommissionPct', 'reviewUrl', 'routing', 'referralDays', 'winbackDays'];
  if (!input || typeof input !== 'object' || Object.keys(input).some((k) => !allowed.includes(k))) throw fail('INVALID_GROWTH_SETTINGS');
  const num = (v, lo, hi) => { if (v === undefined) return undefined; const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw fail('INVALID_GROWTH_SETTINGS'); return n; };
  const commission = num(input.commissionPct, 0, 100), rent = num(input.rentCommissionPct, 0, 300);
  const referral = input.referralDays === undefined ? undefined : Math.round(num(input.referralDays, 3, 180));
  const winback = input.winbackDays === undefined || input.winbackDays === null ? undefined : Math.round(num(input.winbackDays, 14, 730));
  if (input.routing !== undefined && !['OWNER', 'ROUND_ROBIN', 'AREA'].includes(input.routing)) throw fail('INVALID_GROWTH_SETTINGS');
  const url = input.reviewUrl === undefined ? undefined : reviewUrl(input.reviewUrl);
  await db.query(`INSERT INTO growth_settings(client_id) VALUES($1) ON CONFLICT(client_id) DO NOTHING`, [clientId]);
  await db.query(`UPDATE growth_settings SET commission_pct=COALESCE($2,commission_pct),rent_commission_pct=COALESCE($3,rent_commission_pct),
      review_url=CASE WHEN $4::boolean THEN $5 ELSE review_url END,routing=COALESCE($6,routing),referral_days=COALESCE($7,referral_days),
      winback_days=COALESCE($8,winback_days),updated_at=NOW() WHERE client_id=$1`,
  [clientId, commission ?? null, rent ?? null, url !== undefined, url ?? null, input.routing ?? null, referral ?? null, winback ?? null]);
  return settings(clientId);
}
// The owner approves the after-sale cadence once (it is part of what the agent does alone).
async function approveCadence(clientId, yes) {
  await db.query(`INSERT INTO growth_settings(client_id,outreach_approved_at) VALUES($1,CASE WHEN $2::boolean THEN NOW() END)
    ON CONFLICT(client_id) DO UPDATE SET outreach_approved_at=CASE WHEN $2::boolean THEN COALESCE(growth_settings.outreach_approved_at,NOW()) END,updated_at=NOW()`, [clientId, !!yes]);
  await db.query("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'GROWTH_CADENCE',$2)", [clientId, yes ? 'APPROVED' : 'REVOKED']).catch(() => {});
  return settings(clientId);
}
function cadenceText(profile, s) {
  const winback = s.winback_days || profile.winback.days;
  return ['אחרי כל עסקה שנסגרת:',
    '1. מיד: הודעת תודה ללקוח עם קישור לביקורת בגוגל.',
    `2. אחרי ${s.referral_days} ימים: בקשה עדינה להמליץ עלינו לחבר.`,
    `3. אחרי ${winback} ימים: תזכורת ללקוח (${profile.winback.owner}).`,
    'בכל הודעה ללקוח יש אפשרות להסיר את עצמו מהרשימה, ומי שהסיר לא יקבל יותר הודעות.'].join('\n');
}

// ---------- 1. funnels ----------
function funnelsFor(verticalKey, item = null) {
  const list = vp.get(verticalKey).funnels;
  if (!item) return list;
  const fit = list.filter((f) => !f.standalone && (!f.when || f.when(item)));
  return [...fit, ...list.filter((f) => !fit.includes(f))];
}
const funnel = (verticalKey, key) => vp.get(verticalKey).funnels.find((f) => f.key === key) || null;
const defaultFunnel = (verticalKey) => vp.get(verticalKey).funnels[0].key;
const itemFunnel = (item) => funnelsFor(item?.vertical, item)[0].key;
function funnelLabel(key) {
  for (const p of Object.values(vp.PROFILES)) { const f = p.funnels.find((x) => x.key === key); if (f) return f.label; }
  return null;
}
// The lead form for a funnel, in the shape metaLeadForms.validate accepts.
function formQuestions(verticalKey, key) {
  const f = funnel(verticalKey, key) || funnel(verticalKey, defaultFunnel(verticalKey));
  return [{ type: 'FULL_NAME' }, { type: 'PHONE' }, ...f.questions.map(([k, label]) => ({ type: 'CUSTOM', key: k, label }))];
}
function briefLine(verticalKey, key) {
  const f = funnel(verticalKey, key);
  if (!f) return '';
  return `משפך: ${f.label}. שאלות בטופס הלידים: שם, טלפון, ${f.questions.map(([, l]) => l).join(' ')}`;
}
async function funnelBrief(clientId, verticalKey, key) {
  const p = vp.get(verticalKey), f = funnel(verticalKey, key);
  if (!f) throw fail('UNKNOWN_FUNNEL');
  const facts = await require('./marketingStore').load(clientId).then((x) => (x ? require('./conversationFacts').all(x) : {})).catch(() => ({}));
  const rules = ['רק עובדות על העסק, בלי הבטחות ובלי ניסוחים מטעים.', 'פילוח לפי מיקום ותחומי עניין בלבד, בלי פילוח או ניסוח שמפלה לפי מוצא, דת, מין, מצב משפחתי או גיל.'];
  if (p.license) {
    const license = await require('./catalog').businessLicense(clientId, p);
    if (!license) return { blocked: 'LICENSE_MISSING' };
    rules.unshift(`בכל מודעה להציג "${p.license.adLine(license)}".`);
  }
  if (p.housingCategory) rules.push('קהל בישראל בלבד; אם הקהל עלול לכלול את ארה"ב, קנדה או האיחוד האירופי, לסמן קטגוריית מודעה מיוחדת HOUSING.');
  const biz = [facts.businessName && `העסק: ${clean(facts.businessName, 80)}`, facts.product && `מה העסק מציע: ${clean(facts.product, 200)}`].filter(Boolean).join('. ');
  return { text: `קמפיין לידים ב־Meta. ${biz ? biz + '. ' : ''}המסר: "${f.hook}". המטרה: ${f.goal}. ${briefLine(verticalKey, key)} ${rules.join(' ')}`.slice(0, 1990) };
}
// Which funnel to recommend first: one the business has not run in the last 60 days, standalone first.
async function suggest(clientId) {
  const key = await vertical(clientId), list = vp.get(key).funnels;
  const used = new Set((await db.query("SELECT DISTINCT funnel FROM growth_campaign_funnels WHERE client_id=$1 AND created_at>NOW()-INTERVAL '60 days'", [clientId])).rows.map((r) => r.funnel));
  const fresh = list.filter((f) => !used.has(f.key));
  const recommended = (fresh.find((f) => f.standalone) || fresh[0] || list[0]).key;
  return { vertical: key, recommended, funnels: list.map((f) => ({ key: f.key, label: f.label, hook: f.hook, goal: f.goal, standalone: !!f.standalone, questions: f.questions.map(([, l]) => l), used: used.has(f.key) })) };
}
async function rememberCampaign(clientId, { taskId = null, campaignId = null, funnel: key }) {
  if (!/^[a-z_]{2,40}$/.test(String(key || '')) || (taskId && !UUID.test(taskId)) || (campaignId && !/^\d{1,40}$/.test(String(campaignId)))) return;
  if (taskId && (await db.query('SELECT 1 FROM growth_campaign_funnels WHERE client_id=$1 AND task_id=$2 AND funnel=$3', [clientId, taskId, key])).rows.length) return;
  await db.query('INSERT INTO growth_campaign_funnels(client_id,task_id,campaign_id,funnel) VALUES($1,$2,$3,$4)', [clientId, taskId, campaignId ? String(campaignId) : null, key]);
}
// The funnel of a Meta campaign: known directly, or through the agent task that created it.
async function funnelForCampaign(clientId, campaignId) {
  if (!/^\d{1,40}$/.test(String(campaignId || ''))) return null;
  const direct = (await db.query('SELECT funnel FROM growth_campaign_funnels WHERE client_id=$1 AND campaign_id=$2 ORDER BY id DESC LIMIT 1', [clientId, String(campaignId)])).rows[0];
  if (direct) return direct.funnel;
  const open = (await db.query("SELECT id,task_id,funnel FROM growth_campaign_funnels WHERE client_id=$1 AND campaign_id IS NULL AND task_id IS NOT NULL AND created_at>NOW()-INTERVAL '120 days' ORDER BY id DESC LIMIT 20", [clientId])).rows;
  for (const row of open) {
    const task = (await db.query('SELECT state FROM agent_tasks WHERE client_id=$1 AND id=$2', [clientId, row.task_id])).rows[0];
    const ids = (task?.state?.steps || []).map((s) => s?.result?.approval?.actionId || s?.result?.actionId).filter((x) => typeof x === 'string');
    if (!ids.length) continue;
    const plan = (await db.query("SELECT execution_result FROM action_plans WHERE client_id=$1 AND id=ANY($2) AND intent IN ('CREATE_BUNDLE','CREATE_CAMPAIGN') AND status='VERIFIED' ORDER BY updated_at DESC LIMIT 1", [clientId, ids])).rows[0];
    const id = String(plan?.execution_result?.objects?.campaignId || plan?.execution_result?.id || '');
    if (!/^\d{1,40}$/.test(id)) continue;
    await db.query('UPDATE growth_campaign_funnels SET campaign_id=$2 WHERE id=$1', [row.id, id]);
    if (id === String(campaignId)) return row.funnel;
  }
  return null;
}
// Prepares a funnel campaign through the same agent task flow as an item campaign: a draft for
// the owner to review; creation and activation go through the existing approvals and work agreement.
async function prepareFunnelCampaign(clientId, key, { channel = 'WHATSAPP', requestId, send } = {}) {
  const v = await vertical(clientId), f = funnel(v, key);
  if (!f) return { handled: true, blocked: 'UNKNOWN_FUNNEL', reply: 'לא מצאתי את סוג הקמפיין הזה. אם תבקש ממני את סוגי הקמפיינים, אציג לך את האפשרויות.' };
  const brief = await funnelBrief(clientId, v, key);
  if (brief.blocked === 'LICENSE_MISSING') return { handled: true, blocked: brief.blocked, reply: 'כל מודעת נדל"ן חייבת להציג מספר רישיון תיווך. מה מספר הרישיון שלך? אחרי שתשלח לי אותו (למשל: רישיון תיווך 3141592), נכין את הקמפיין.' };
  const tasks = require('./taskAgent');
  const active = await tasks.active(clientId);
  if (active) return { handled: true, blocked: 'TASK_OPEN', reply: 'יש כרגע משימה פתוחה אחרת אצל הסוכן. כדי לא לערבב ביניהן, כדאי לסיים אותה או לבקש ממני לסגור אותה, ואז לבחור שוב את סוג הקמפיין.' };
  const run = send || ((message) => tasks.send(clientId, { message, requestId: requestId || `growth-funnel:${key}:${Date.now()}`, channel }, { dynamicRouting: process.env.DYNAMIC_CONVERSATION_ENABLED === 'true', deferPlanning: !tasks.enabled() }));
  const result = await run(brief.text);
  const taskId = result?.task?.id || (await tasks.active(clientId))?.id || null;
  await rememberCampaign(clientId, { taskId, funnel: key });
  await db.query("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'GROWTH_FUNNEL','PREPARED')", [clientId]).catch(() => {});
  return { ...result, handled: true, funnel: key, reply: `🎯 ${f.label}\n` + String(result?.reply || 'התחלתי להכין טיוטת קמפיין.') };
}

// ---------- 2. deal value ----------
function dealKind(verticalKey, lead, item) {
  const f = funnel(verticalKey, lead?.funnel);
  if (f?.dealKind) return f.dealKind;
  if (item?.attributes?.dealType === 'RENT') return 'RENT';
  return 'SALE';
}
function dealTerms(verticalKey, lead, s, item = null) {
  const p = vp.get(verticalKey), kind = dealKind(verticalKey, lead, item), commission = !!p.deal.commission;
  const pct = commission ? (kind === 'RENT' ? s.rent_commission_pct : s.commission_pct) : null;
  const question = commission
    ? `${p.deal.priceQuestion(kind)} ובכמה עמלה? ${kind === 'RENT' ? `(ברירת המחדל שלך: ${pct}% משכר דירה חודשי)` : `(ברירת המחדל שלך: ${pct}%)`}\nלמשל: ${kind === 'RENT' ? '6,500' : '2.9 מיליון'}${kind === 'RENT' ? '' : ' 1.5%'}`
    : `${p.deal.priceQuestion(kind)} למשל: 1,200`;
  return { vertical: p.key, kind, commission, defaultPct: pct, question, priceLabel: p.deal.priceQuestion(kind), revenueLabel: p.deal.revenueLabel };
}
// "2.9 מיליון 1.5%", "2,900,000", "6500", "עמלה 2%". Returns minor units (agorot).
function parseDeal(text, terms) {
  const t = String(text || '').trim();
  if (!t || t.length > 120 || /[?？]/.test(t)) return null;
  const pctMatch = t.match(/(\d{1,3}(?:[.,]\d{1,2})?)\s*%/);
  const pct = pctMatch ? Number(pctMatch[1].replace(',', '.')) : null;
  const rest = t.replace(/(\d{1,3}(?:[.,]\d{1,2})?)\s*%/g, ' ').replace(/עמלה|עמלת תיווך/g, ' ');
  let price = vp.parsePrice(rest);
  if (!price) { const m = rest.match(/(?:^|\s)(\d{1,3}(?:,\d{3})+|\d{1,10})(?:\.\d{1,2})?(?:\s*(?:₪|ש["״]?ח|שקל(?:ים)?))?\s*$/); if (m) price = Number(m[1].replace(/,/g, '')); }
  if (!price || price <= 0 || price > 1e10) return null;
  const commissionPct = terms.commission ? (pct ?? terms.defaultPct) : null;
  if (commissionPct !== null && (commissionPct < 0 || commissionPct > 300)) return null;
  const priceMinor = Math.round(price * 100);
  const revenueMinor = terms.commission ? Math.round(priceMinor * commissionPct / 100) : priceMinor;
  return { priceMinor, commissionPct, revenueMinor };
}
function dealText(terms, deal) {
  if (!terms.commission) return `נשמר ✅ ${terms.revenueLabel}: ${ils(deal.revenueMinor)}. זה נכנס להכנסות, ככה תראה כמה נשאר לך אחרי הפרסום.`;
  return `נשמר ✅ עסקה של ${ils(deal.priceMinor)}${terms.kind === 'RENT' ? ' לחודש' : ''}, עמלה ${deal.commissionPct}% = ${ils(deal.revenueMinor)} הכנסה לך.\nהעמלה היא מה שנספר כהכנסה, ככה "נשאר לך אחרי הפרסום" מדויק.`;
}
async function leadContext(clientId, leadId) {
  if (!UUID.test(String(leadId || ''))) throw fail('INVALID_LEAD');
  const lead = (await db.query('SELECT * FROM crm_leads WHERE client_id=$1 AND id=$2', [clientId, leadId])).rows[0];
  if (!lead) throw fail('LEAD_NOT_FOUND_OR_STALE');
  const item = lead.catalog_item_id ? (await db.query('SELECT vertical,attributes,status FROM catalog_items WHERE client_id=$1 AND id=$2', [clientId, lead.catalog_item_id])).rows[0] || null : null;
  return { lead, item };
}
async function termsFor(clientId, leadId) {
  const { lead, item } = await leadContext(clientId, leadId);
  return dealTerms(await vertical(clientId), lead, await settings(clientId), item);
}
// Records the deal on a lead and marks it closed. input: {text} or {price, commissionPct} (major units).
async function recordDeal(clientId, leadId, input = {}) {
  const { lead, item } = await leadContext(clientId, leadId);
  const terms = dealTerms(await vertical(clientId), lead, await settings(clientId), item);
  let deal;
  if (typeof input.text === 'string') deal = parseDeal(input.text, terms);
  else {
    const price = Number(input.price), pct = input.commissionPct === undefined || input.commissionPct === null || input.commissionPct === '' ? terms.defaultPct : Number(input.commissionPct);
    if (Number.isFinite(price) && price > 0 && price <= 1e10 && (!terms.commission || (Number.isFinite(pct) && pct >= 0 && pct <= 300))) {
      const priceMinor = Math.round(price * 100);
      deal = { priceMinor, commissionPct: terms.commission ? pct : null, revenueMinor: terms.commission ? Math.round(priceMinor * pct / 100) : priceMinor };
    }
  }
  if (!deal) throw fail('INVALID_DEAL');
  const updated = await require('./crmService').update(clientId, leadId, { status: 'WON', version: Number(lead.version), revenueMinor: deal.revenueMinor, currency: 'ILS' });
  await db.query('UPDATE crm_leads SET deal_value_minor=$3,commission_pct=$4,closed_at=COALESCE(closed_at,NOW()) WHERE client_id=$1 AND id=$2', [clientId, leadId, deal.priceMinor, deal.commissionPct]);
  await event(clientId, leadId, 'DEAL', terms.commission ? `${deal.priceMinor / 100} × ${deal.commissionPct}%` : String(deal.priceMinor / 100));
  return { lead: { ...updated, deal_value_minor: deal.priceMinor, commission_pct: deal.commissionPct }, deal, terms, text: dealText(terms, deal) };
}

// ---------- 3. team ----------
const MEMBER_FIELDS = ['name', 'phone', 'areas', 'itemIds', 'active'];
function memberInput(input, partial) {
  if (!input || typeof input !== 'object' || Object.keys(input).some((k) => !MEMBER_FIELDS.includes(k))) throw fail('INVALID_TEAM_MEMBER');
  const out = {};
  if (input.name !== undefined || !partial) { if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80) throw fail('INVALID_TEAM_MEMBER'); out.name = input.name.trim(); }
  if (input.phone !== undefined) {
    if (input.phone === null || input.phone === '') out.phone = null;
    else { const n = require('./leadAlert').waNumber(input.phone); if (!n) throw fail('INVALID_TEAM_PHONE'); out.phone = n; }
  }
  if (input.areas !== undefined) {
    const list = Array.isArray(input.areas) ? input.areas : String(input.areas || '').split(/[,،\n]/);
    out.areas = [...new Set(list.map((a) => clean(a, 40)).filter((a) => a.length >= 2))].slice(0, 20);
  }
  if (input.itemIds !== undefined) { if (!Array.isArray(input.itemIds) || input.itemIds.length > 100 || input.itemIds.some((x) => !UUID.test(String(x)))) throw fail('INVALID_TEAM_MEMBER'); out.itemIds = [...new Set(input.itemIds.map(String))]; }
  if (input.active !== undefined) { if (typeof input.active !== 'boolean') throw fail('INVALID_TEAM_MEMBER'); out.active = input.active; }
  return out;
}
const joinCode = () => String(crypto.randomInt(100000, 1000000));
async function addMember(clientId, input) {
  const m = memberInput(input, false);
  if (m.phone && (await db.query('SELECT 1 FROM clients WHERE id=$1 AND phone=$2', [clientId, m.phone])).rows.length) throw fail('TEAM_MEMBER_IS_OWNER');
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const row = (await db.query(`INSERT INTO team_members(id,client_id,name,phone,areas,item_ids,join_code) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7) RETURNING *`,
        [crypto.randomUUID(), clientId, m.name, m.phone ?? null, JSON.stringify(m.areas || []), JSON.stringify(m.itemIds || []), joinCode()])).rows[0];
      return view(row);
    } catch (error) {
      if (/team_members_phone/.test(error.message)) throw fail('TEAM_PHONE_EXISTS');
      if (!/team_members_join_code|duplicate key/.test(error.message) || attempt === 4) throw error;
    }
  }
  throw fail('TEAM_MEMBER_NOT_SAVED');
}
async function updateMember(clientId, id, input) {
  if (!UUID.test(String(id || ''))) throw fail('INVALID_TEAM_MEMBER');
  const m = memberInput(input, true);
  const row = (await db.query(`UPDATE team_members SET name=COALESCE($3,name),
      phone=CASE WHEN $4::boolean THEN $5 ELSE phone END,
      opted_in_at=CASE WHEN $4::boolean AND $5 IS DISTINCT FROM phone THEN NULL ELSE opted_in_at END,
      areas=COALESCE($6::jsonb,areas),item_ids=COALESCE($7::jsonb,item_ids),active=COALESCE($8,active),updated_at=NOW()
    WHERE client_id=$1 AND id=$2 RETURNING *`, [clientId, id, m.name ?? null, m.phone !== undefined, m.phone ?? null, m.areas ? JSON.stringify(m.areas) : null, m.itemIds ? JSON.stringify(m.itemIds) : null, m.active ?? null])).rows[0];
  if (!row) throw fail('TEAM_MEMBER_NOT_FOUND');
  return view(row);
}
function joinLink(code) {
  const n = digits(process.env.WHATSAPP_DISPLAY_NUMBER);
  return /^\d{8,15}$/.test(n) ? `https://wa.me/${n}?text=${encodeURIComponent('הצטרפות ' + code)}` : null;
}
function view(row) {
  return { id: row.id, name: row.name, phone: row.phone, areas: row.areas || [], itemIds: row.item_ids || [], active: row.active,
    notifications: row.opted_out_at ? 'STOPPED' : row.opted_in_at ? 'ON' : 'WAITING', joinCode: row.join_code, joinLink: joinLink(row.join_code), createdAt: row.created_at };
}
async function members(clientId) {
  return (await db.query('SELECT * FROM team_members WHERE client_id=$1 ORDER BY created_at,id', [clientId])).rows.map(view);
}
// Per-member mini report (assigned leads created in the last `days` days). memberId null = whole team.
async function teamReport(clientId, days = 30) {
  const rows = (await db.query(`SELECT m.id,m.name,m.active,
      COUNT(l.id)::int AS leads,
      COUNT(l.id) FILTER (WHERE l.status IN ('CONTACTED','APPOINTMENT','WON','LOST'))::int AS handled,
      COUNT(l.id) FILTER (WHERE l.status='NEW')::int AS waiting,
      COUNT(l.id) FILTER (WHERE l.status='WON')::int AS won,
      COALESCE(SUM(CASE WHEN l.status='WON' AND l.currency='ILS' THEN l.revenue_minor END),0)::bigint AS revenue_minor
    FROM team_members m LEFT JOIN crm_leads l ON l.assigned_member_id=m.id AND l.client_id=m.client_id AND l.created_at>=NOW()-make_interval(days=>$2::int)
    WHERE m.client_id=$1 GROUP BY m.id,m.name,m.active,m.created_at ORDER BY m.created_at,m.id`, [clientId, days])).rows;
  const unassigned = (await db.query(`SELECT COUNT(*)::int AS n FROM crm_leads WHERE client_id=$1 AND assigned_member_id IS NULL AND created_at>=NOW()-make_interval(days=>$2::int)`, [clientId, days])).rows[0].n;
  return { days, members: rows.map((r) => ({ id: r.id, name: r.name, active: r.active, leads: r.leads, handled: r.handled, waiting: r.waiting, won: r.won, revenue: Number(r.revenue_minor) / 100 })), unassigned };
}
const memberLine = (m) => `• ${m.name}: ${m.leads} לידים, ${m.handled} טופלו, ${m.waiting} מחכים, ${m.won} עסקאות` + (m.revenue ? `, ${Math.round(m.revenue).toLocaleString('en-US')} ₪` : '');
async function teamReportText(clientId) {
  const r = await teamReport(clientId);
  if (!r.members.length) return 'עוד אין אנשי צוות. אפשר להוסיף אותם בדשבורד, במסך "צוות".';
  return [`👥 דוח צוות, ${r.days} הימים האחרונים`, '', ...r.members.map(memberLine), '', `לידים שנשארו אצלך (לא הועברו): ${r.unassigned}`, require('./dashboardLink').hint('leads')].join('\n');
}
async function nextIndex(clientId, size) {
  const r = await db.query(`INSERT INTO growth_settings(client_id,rr_cursor) VALUES($1,1) ON CONFLICT(client_id) DO UPDATE SET rr_cursor=growth_settings.rr_cursor+1 RETURNING rr_cursor-1 AS i`, [clientId]);
  return Number(r.rows[0].i) % size;
}
// Who gets a new lead: by item or area when routing is AREA (falls back to round-robin), else round-robin.
async function route(clientId, lead, s) {
  if (s.routing === 'OWNER') return null;
  const list = (await db.query('SELECT * FROM team_members WHERE client_id=$1 AND active ORDER BY created_at,id', [clientId])).rows;
  if (!list.length) return null;
  let pool = list;
  if (s.routing === 'AREA') {
    let context = clean(lead.note, 500);
    if (lead.catalog_item_id) {
      const item = (await db.query('SELECT title,attributes FROM catalog_items WHERE client_id=$1 AND id=$2', [clientId, lead.catalog_item_id])).rows[0];
      if (item) context += ' ' + [item.title, item.attributes?.city, item.attributes?.neighbourhood, item.attributes?.address, item.attributes?.serviceArea].filter(Boolean).join(' ');
    }
    const byItem = lead.catalog_item_id ? list.filter((m) => (m.item_ids || []).includes(lead.catalog_item_id)) : [];
    const byArea = list.filter((m) => (m.areas || []).some((a) => a && context.includes(a)));
    if (byItem.length) pool = byItem; else if (byArea.length) pool = byArea;
  }
  return pool[await nextIndex(clientId, pool.length)];
}
async function outbox(clientId, recipient, payload, key) {
  const r = await db.query(`INSERT INTO whatsapp_outbox(id,client_id,dedupe_key,recipient,payload) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id`,
    [crypto.randomUUID(), clientId, crypto.createHash('sha256').update('growth:' + key).digest('hex'), recipient, JSON.stringify(payload)]);
  return r.rows.length ? r.rows[0].id : null;
}
const textPayload = (body) => ({ type: 'text', text: { body: String(body).slice(0, 4000), preview_url: false } });
function template(envName, params) {
  const name = process.env[envName];
  const allowed = String(process.env.WHATSAPP_APPROVED_TEMPLATES || '').split(',').map((x) => x.trim());
  if (!name || !/^[a-z0-9_]{1,512}$/.test(name) || !allowed.includes(name)) return null;
  return { type: 'template', template: { name, language: { code: process.env[envName + '_LANGUAGE'] || 'he' }, components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: clean(text, 900) || '-' })) }] } };
}
async function windowOpen(phone) {
  return !!(await db.query("SELECT last_inbound_at>NOW()-INTERVAL '23 hours' AS open FROM whatsapp_contacts WHERE phone=$1", [phone])).rows[0]?.open;
}
// The lead goes to the member's WhatsApp only if he opted in by writing the join code himself.
async function notifyMember(clientId, member, lead) {
  if (!member.phone || !member.opted_in_at || member.opted_out_at) return { status: 'NOT_OPTED_IN' };
  const business = await require('./leadAlert').businessNameFor(clientId);
  const label = funnelLabel(lead.funnel);
  const wa = require('./leadAlert').waNumber(lead.phone);
  const body = [`🔔 ליד חדש בשבילך${business ? ' מ' + business : ''}`, 'שם: ' + (clean(lead.name, 60) || 'לא צוין'), lead.phone && 'טלפון: ' + lead.phone, label && 'סוג: ' + label,
    wa && `לכתוב לו בוואטסאפ: https://wa.me/${wa}`, '', 'כדאי לחזור אליו בדקות הקרובות. "הדוח שלי" — הלידים שלך. "הפסק לידים" — הפסקת ההודעות.'].filter((x) => x !== null && x !== undefined && x !== false).join('\n');
  if (await windowOpen(member.phone)) return { status: (await outbox(clientId, member.phone, textPayload(body), `team-lead:${lead.id}:${member.id}`)) ? 'QUEUED' : 'DUPLICATE' };
  const t = template('WA_TEMPLATE_TEAM_LEAD', [firstName(member.name) || member.name, clean(lead.name, 60) || 'ליד חדש']);
  if (t) return { status: (await outbox(clientId, member.phone, t, `team-lead:${lead.id}:${member.id}`)) ? 'TEMPLATE_QUEUED' : 'DUPLICATE' };
  return { status: 'WINDOW_CLOSED' };
}
async function event(clientId, leadId, kind, detail) {
  await db.query('INSERT INTO lead_events(lead_id,client_id,kind,detail) VALUES($1,$2,$3,$4)', [leadId, clientId, kind, String(detail || '').slice(0, 300)]).catch(() => {});
}

// Called once for every new lead (crmService.create). Sets the funnel, routes it, notifies the member.
// Never throws: a lead is always saved and always reaches the owner.
async function onLeadCreated(clientId, lead) {
  const out = {};
  try {
    const v = await vertical(clientId);
    let key = lead.funnel || (lead.campaign_id ? await funnelForCampaign(clientId, lead.campaign_id) : null);
    if (!key && lead.catalog_item_id) {
      const item = (await db.query('SELECT vertical,attributes,status FROM catalog_items WHERE client_id=$1 AND id=$2', [clientId, lead.catalog_item_id])).rows[0];
      if (item) key = itemFunnel(item);
    }
    key = key || defaultFunnel(v);
    if (key !== lead.funnel) { await db.query('UPDATE crm_leads SET funnel=$3 WHERE client_id=$1 AND id=$2 AND funnel IS NULL', [clientId, lead.id, key]); out.funnel = key; }
    const s = await settings(clientId);
    const member = await route(clientId, { ...lead, funnel: key }, s);
    if (member) {
      await db.query('UPDATE crm_leads SET assigned_member_id=$3 WHERE client_id=$1 AND id=$2', [clientId, lead.id, member.id]);
      out.assigned_member_id = member.id;
      const n = await notifyMember(clientId, member, { ...lead, funnel: key });
      await event(clientId, lead.id, 'ASSIGNED', `${clean(member.name, 60)} · ${n.status}`);
    }
  } catch (error) { logger.warn('Growth lead setup skipped', { error: quiet(error) }); }
  return out;
}
async function assign(clientId, leadId, memberId) {
  if (!UUID.test(String(leadId || '')) || (memberId !== null && !UUID.test(String(memberId || '')))) throw fail('INVALID_LEAD');
  if (memberId && !(await db.query('SELECT 1 FROM team_members WHERE client_id=$1 AND id=$2 AND active', [clientId, memberId])).rows.length) throw fail('TEAM_MEMBER_NOT_FOUND');
  const lead = (await db.query('UPDATE crm_leads SET assigned_member_id=$3,updated_at=NOW() WHERE client_id=$1 AND id=$2 RETURNING *', [clientId, leadId, memberId])).rows[0];
  if (!lead) throw fail('LEAD_NOT_FOUND_OR_STALE');
  if (memberId) {
    const member = (await db.query('SELECT * FROM team_members WHERE client_id=$1 AND id=$2', [clientId, memberId])).rows[0];
    const n = await notifyMember(clientId, member, lead);
    await event(clientId, leadId, 'ASSIGNED', `${clean(member.name, 60)} · ${n.status}`);
    return { ok: true, notified: n.status };
  }
  await event(clientId, leadId, 'ASSIGNED', 'OWNER');
  return { ok: true };
}

// ---------- 4. after-sale loop ----------
async function onWon(clientId, lead) {
  try {
    await db.query('UPDATE crm_leads SET closed_at=COALESCE(closed_at,NOW()) WHERE client_id=$1 AND id=$2', [clientId, lead.id]);
    const wa = require('./leadAlert').waNumber(lead.phone);
    if (!wa) return { planned: 0 };
    const v = await vertical(clientId), s = await settings(clientId), p = vp.get(v);
    const winback = s.winback_days || p.winback.days;
    const plan = [['THANKS_REVIEW', 0], ['REFERRAL', s.referral_days], ['WINBACK', winback]];
    let planned = 0;
    for (const [kind, days] of plan) {
      const r = await db.query(`INSERT INTO growth_outreach(id,client_id,lead_id,kind,due_at,wa_phone) VALUES($1,$2,$3,$4,NOW()+make_interval(days=>$5::int),$6)
        ON CONFLICT(lead_id,kind) DO NOTHING RETURNING id`, [crypto.randomUUID(), clientId, lead.id, kind, days, wa]);
      planned += r.rows.length;
    }
    return { planned };
  } catch (error) { logger.warn('Growth after-sale plan skipped', { error: quiet(error) }); return { planned: 0 }; }
}
function customerText(kind, { name, business, reviewUrl: url, profile }) {
  const hi = name ? `היי ${name}` : 'היי';
  const from = business ? `ב${business}` : 'בנו';
  if (kind === 'THANKS_REVIEW') return `${hi}, תודה רבה שבחרתם ${from}! 🙏${url ? `\nאם הייתם מרוצים, נשמח מאוד לביקורת קצרה בגוגל: ${url}` : ''}\n${OPT_OUT_LINE}`;
  if (kind === 'REFERRAL') return `${hi}, מקווים שהכול מצוין 🙂\nאם יש לכם חבר או בן משפחה שיכול להיעזר בנו${business ? ` (${business})` : ''}, נשמח מאוד שתפנו אותו אלינו.\n${OPT_OUT_LINE}`;
  return `${hi}, ${profile.winback.customer}\n${OPT_OUT_LINE}`;
}
const KIND_HE = { THANKS_REVIEW: 'תודה + בקשת ביקורת', REFERRAL: 'בקשת המלצה לחבר', WINBACK: 'תזכורת ללקוח עבר' };
async function optedOut(clientId, wa) {
  return (await db.query('SELECT 1 FROM lead_optouts WHERE client_id=$1 AND wa_phone=$2', [clientId, wa])).rows.length > 0;
}
async function agreementPaused(clientId) {
  return (await db.query("SELECT 1 FROM authority_mandates WHERE client_id=$1 AND status='PAUSED' AND policy->>'kind'='WORK_AGREEMENT' LIMIT 1", [clientId]).catch(() => ({ rows: [] }))).rows.length > 0;
}
// Why the agent cannot send this one by itself (null = it can).
async function autoBlocker(clientId, row, s) {
  if (!s.outreach_approved_at) return 'NOT_APPROVED';
  if (await agreementPaused(clientId)) return 'PAUSED';
  if (row.customer_consent !== true) return 'NO_CONSENT';
  if (process.env.WHATSAPP_SEND_ENABLED !== 'true') return 'SENDING_DISABLED';
  if (!template('WA_TEMPLATE_CUSTOMER_FOLLOWUP', ['x', 'x'])) return 'NO_TEMPLATE';
  return null;
}
async function prepared(clientId, row) {
  const v = await vertical(clientId), s = await settings(clientId), p = vp.get(v);
  const business = await require('./leadAlert').businessNameFor(clientId);
  const body = customerText(row.kind, { name: firstName(row.name), business, reviewUrl: s.review_url, profile: p }).slice(0, 1000);
  return { v, s, p, business, body };
}
// Sends (or hands the owner) one planned customer message. Returns {status, text?}.
async function deliver(clientId, row, { owner = true } = {}) {
  if (await optedOut(clientId, row.wa_phone) || row.customer_consent === false) {
    await db.query("UPDATE growth_outreach SET status='OPTED_OUT',done_at=NOW() WHERE id=$1", [row.id]);
    return { status: 'OPTED_OUT' };
  }
  const { s, business, body } = await prepared(clientId, row); void business;
  const blocker = await autoBlocker(clientId, row, s);
  if (!blocker) {
    const t = template('WA_TEMPLATE_CUSTOMER_FOLLOWUP', [firstName(row.name) || 'שלום', body.split('\n').slice(0, -1).join(' ').replace(/^היי[^,]*,\s*/, '')]);
    await db.query(`INSERT INTO whatsapp_contacts(phone,last_inbound_at,opted_in) VALUES($1,to_timestamp(0),TRUE) ON CONFLICT(phone) DO UPDATE SET opted_in=TRUE`, [row.wa_phone]);
    const id = await outbox(clientId, row.wa_phone, t, `outreach:${row.id}`);
    await db.query("UPDATE growth_outreach SET status='SENT',body=$2,done_at=NOW() WHERE id=$1", [row.id, body]);
    await event(clientId, row.lead_id, 'OUTREACH', `${row.kind} SENT`);
    if (owner) await notify(clientId, `🤖 שלחתי ל${clean(row.name, 40) || 'הלקוח'} ${KIND_HE[row.kind]}, לפי מה שאישרת.\n״${body}״`, 'outreach-sent:' + row.id);
    return { status: id ? 'SENT' : 'DUPLICATE' };
  }
  await db.query("UPDATE growth_outreach SET status='OFFERED',body=$2,offered_at=NOW() WHERE id=$1", [row.id, body]);
  if (!owner) return { status: 'OFFERED', body, blocker };
  const link = `https://wa.me/${row.wa_phone}?text=${encodeURIComponent(body)}`;
  const lines = [`${row.kind === 'WINBACK' ? '🔁' : row.kind === 'REFERRAL' ? '🤝' : '⭐'} ${KIND_HE[row.kind]} ל${clean(row.name, 40) || 'הלקוח'}`,
    row.kind === 'THANKS_REVIEW' && !s.review_url ? 'עוד אין לי קישור לביקורות שלך בגוגל. אם תשלח לי אותו פעם אחת, אוסיף אותו לכל הודעת תודה.' : null,
    'הודעה מוכנה, נשלחת מהוואטסאפ שלך בלחיצה:', `״${body}״`, link, '',
    blocker === 'NO_CONSENT' && s.outreach_approved_at ? 'אם הלקוח הסכים לקבל ממך הודעות, סמן את זה ואשלח בעצמי בפעם הבאה.' : null,
    'אחרי ששלחת, תעדכן אותי בכפתור למטה. אפשר גם לדלג על ההודעה הזו.'].filter((x) => x !== null);
  const buttons = [{ title: '✅ שלחתי', text: '/growth-done ' + row.id }, { title: 'דלג', text: '/growth-skip ' + row.id }];
  if (blocker === 'NO_CONSENT' && s.outreach_approved_at) buttons.push({ title: 'הלקוח הסכים', text: '/growth-consent ' + row.lead_id });
  await require('./marketingStore').update(clientId, null, (p) => { p.growthLast = row.id; return { handled: false, changed: true }; }).catch(() => {});
  const r = await notify(clientId, lines.join('\n'), 'outreach:' + row.id, buttons);
  return { status: 'OFFERED', notice: r.status, blocker };
}
async function notify(clientId, text, key, buttons = null) {
  return require('./leadConcierge').notifyOwner(clientId, text, 'growth:' + key, { buttons, decisionKey: 'growth_outreach' });
}
// One due message per business per run, so the owner is never flooded.
async function runDue({ now = new Date(), limit = 100, clientId = null } = {}) {
  if (!db.configured()) return { handled: 0 };
  const rows = (await db.query(`SELECT DISTINCT ON (o.client_id) o.*,l.name,l.customer_consent,l.status AS lead_status
    FROM growth_outreach o JOIN crm_leads l ON l.id=o.lead_id AND l.client_id=o.client_id
    WHERE o.status='PLANNED' AND o.due_at<=$1 AND (o.offered_at IS NULL OR o.offered_at<$1::timestamptz-INTERVAL '24 hours') AND ($3::bigint IS NULL OR o.client_id=$3)
    ORDER BY o.client_id,o.due_at LIMIT $2`, [now, limit, clientId])).rows;
  let handled = 0;
  for (const row of rows) {
    try {
      if (row.lead_status !== 'WON') { await db.query("UPDATE growth_outreach SET status='SKIPPED',done_at=NOW() WHERE id=$1", [row.id]); continue; }
      const r = await deliver(row.client_id, row);
      if (r.status === 'OFFERED' && r.notice && r.notice !== 'QUEUED') await db.query("UPDATE growth_outreach SET status='PLANNED' WHERE id=$1", [row.id]); // owner not reachable now: try again tomorrow
      handled++;
    } catch (error) { logger.warn('Growth outreach failed', { error: quiet(error) }); }
  }
  return { handled };
}
async function markOutreach(clientId, id, status) {
  if (!UUID.test(String(id || '')) || !['LINK_GIVEN', 'SKIPPED'].includes(status)) throw fail('INVALID_OUTREACH');
  const row = (await db.query("UPDATE growth_outreach SET status=$3,done_at=NOW() WHERE client_id=$1 AND id=$2 AND status IN ('PLANNED','OFFERED') RETURNING *", [clientId, id, status])).rows[0];
  if (row) await event(clientId, row.lead_id, 'OUTREACH', `${row.kind} ${status}`);
  return row || null;
}
async function setConsent(clientId, leadId, consent) {
  if (!UUID.test(String(leadId || '')) || typeof consent !== 'boolean') throw fail('INVALID_LEAD');
  // Unchecking means "not confirmed" (the owner keeps sending himself), never an opt-out: only the customer opts out.
  const lead = (await db.query('UPDATE crm_leads SET customer_consent=CASE WHEN $3::boolean THEN TRUE ELSE NULL END WHERE client_id=$1 AND id=$2 AND customer_consent IS DISTINCT FROM FALSE RETURNING id', [clientId, leadId, consent])).rows[0];
  if (!lead) throw fail('LEAD_NOT_FOUND_OR_STALE');
  return { ok: true };
}
async function optOut(clientId, leadId, wa) {
  if (wa) await db.query('INSERT INTO lead_optouts(client_id,wa_phone) VALUES($1,$2) ON CONFLICT DO NOTHING', [clientId, wa]);
  await db.query("UPDATE growth_outreach SET status='OPTED_OUT',done_at=NOW() WHERE client_id=$1 AND status IN ('PLANNED','OFFERED') AND (lead_id=$2 OR wa_phone=$3)", [clientId, leadId, wa || null]);
  if (leadId) await db.query('UPDATE crm_leads SET customer_consent=FALSE WHERE client_id=$1 AND id=$2', [clientId, leadId]);
}
async function outreachList(clientId) {
  return (await db.query(`SELECT o.id,o.lead_id,o.kind,o.status,o.due_at,o.body,o.wa_phone,l.name FROM growth_outreach o JOIN crm_leads l ON l.id=o.lead_id AND l.client_id=o.client_id
    WHERE o.client_id=$1 AND (o.status IN ('PLANNED','OFFERED') OR o.done_at>NOW()-INTERVAL '30 days') ORDER BY CASE WHEN o.status IN ('PLANNED','OFFERED') THEN 0 ELSE 1 END,o.due_at LIMIT 50`, [clientId])).rows
    .map((r) => ({ id: r.id, leadId: r.lead_id, kind: r.kind, kindLabel: KIND_HE[r.kind], status: r.status, dueAt: r.due_at, name: r.name, link: r.status === 'OFFERED' && r.body ? `https://wa.me/${r.wa_phone}?text=${encodeURIComponent(r.body)}` : null }));
}
// What the dashboard's growth screen shows.
async function overview(clientId) {
  const v = await vertical(clientId), s = await settings(clientId), p = vp.get(v);
  return {
    vertical: v, settings: { commissionPct: s.commission_pct, rentCommissionPct: s.rent_commission_pct, reviewUrl: s.review_url, routing: s.routing, referralDays: s.referral_days, winbackDays: s.winback_days || p.winback.days, cadenceApproved: !!s.outreach_approved_at },
    commission: !!p.deal.commission, cadence: cadenceText(p, s), autoSend: { template: !!template('WA_TEMPLATE_CUSTOMER_FOLLOWUP', ['x', 'x']), sending: process.env.WHATSAPP_SEND_ENABLED === 'true' },
    funnels: (await suggest(clientId)), outreach: await outreachList(clientId)
  };
}

// ---------- inbound: team members and customers who got an after-sale message ----------
async function reply(clientId, phone, body, key) { await outbox(clientId, phone, textPayload(body), key); }
async function routeInbound(message) {
  if (!db.configured()) return false;
  const from = digits(message?.from);
  if (!/^\d{8,15}$/.test(from)) return false;
  if ((await db.query('SELECT 1 FROM clients WHERE phone=$1', [from])).rows.length) return false;
  const text = clean(message.type === 'text' ? message.text?.body : message.type === 'button' ? (message.button?.text || message.button?.payload) : message.type === 'interactive' ? (message.interactive?.button_reply?.title || message.interactive?.list_reply?.title) : '', 500);
  const join = text.match(/^הצטרפות\s*(\d{6})$/);
  let member = null;
  if (join) member = (await db.query('SELECT * FROM team_members WHERE join_code=$1 AND phone=$2 AND active', [join[1], from])).rows[0] || null;
  if (!member) member = (await db.query('SELECT * FROM team_members WHERE phone=$1 AND active AND opted_in_at IS NOT NULL ORDER BY opted_in_at DESC LIMIT 1', [from])).rows[0] || null;
  const customer = member ? null : (await db.query(`SELECT o.client_id,o.lead_id,l.name FROM growth_outreach o JOIN crm_leads l ON l.id=o.lead_id AND l.client_id=o.client_id
    WHERE o.wa_phone=$1 AND o.status='SENT' AND o.done_at>NOW()-INTERVAL '60 days' ORDER BY o.done_at DESC LIMIT 1`, [from])).rows[0];
  if (!member && !customer) return false;
  try { await require('./whatsappDelivery').recordInbound(message); } catch { /* invalid timestamp: still handle */ }
  if (!await require('./rateLimit').take('growth-inbound:' + from, 20)) return true;
  const id = message.id || crypto.randomUUID();
  if (member) {
    const business = await require('./leadAlert').businessNameFor(member.client_id);
    if (join && member.join_code === join[1]) {
      await db.query('UPDATE team_members SET opted_in_at=NOW(),opted_out_at=NULL,updated_at=NOW() WHERE id=$1', [member.id]);
      await db.query(`INSERT INTO whatsapp_contacts(phone,last_inbound_at,opted_in) VALUES($1,NOW(),TRUE) ON CONFLICT(phone) DO UPDATE SET opted_in=TRUE`, [from]);
      await reply(member.client_id, from, `שלום ${firstName(member.name) || member.name} 👋 מעכשיו תקבל כאן לידים חדשים${business ? ' של ' + business : ''}.\n"הדוח שלי" — הלידים שלך מ־30 הימים האחרונים.\n"הפסק לידים" — הפסקת ההודעות.`, 'join:' + id);
      await notify(member.client_id, `✅ ${clean(member.name, 40)} הצטרף לצוות בוואטסאפ ויקבל לידים שמועברים אליו.`, 'joined:' + member.id + ':' + id);
      return true;
    }
    if (/^(?:הפסק לידים|הפסק|עצור|הסר|stop|(?:(?:אני רוצה|רוצה)\s+)?(?:להפסיק|תפסיק)(?: לקבל| לשלוח לי)? לידים|תפסיק)[.!\s]*$/i.test(text)) {
      await db.query('UPDATE team_members SET opted_out_at=NOW(),updated_at=NOW() WHERE id=$1', [member.id]);
      await reply(member.client_id, from, 'הפסקתי לשלוח לך לידים. לחזרה, שלח שוב את קוד ההצטרפות.', 'stop:' + id);
      await notify(member.client_id, `ℹ️ ${clean(member.name, 40)} ביקש להפסיק לקבל לידים בוואטסאפ. הלידים שלו עדיין מסומנים עליו בדשבורד.`, 'member-stop:' + id);
      return true;
    }
    if (/^(?:הדוח שלי|דוח|הלידים שלי|(?:(?:אני רוצה|רוצה)\s+לראות|(?:תראה|תשלח|תציג)(?: לי)?) את (?:ה)?(?:דוח|לידים)(?: שלי)?|מה (?:עם )?הלידים שלי)[?.!\s]*$/.test(text)) {
      const r = await teamReport(member.client_id);
      const m = r.members.find((x) => x.id === member.id);
      const leads = (await db.query("SELECT name,phone,status FROM crm_leads WHERE client_id=$1 AND assigned_member_id=$2 AND status IN ('NEW','CONTACTED','APPOINTMENT') ORDER BY created_at DESC LIMIT 5", [member.client_id, member.id])).rows;
      const LABEL = { NEW: 'חדש', CONTACTED: 'בטיפול', APPOINTMENT: 'נקבעה פגישה' };
      await reply(member.client_id, from, [`📋 הדוח שלך, 30 הימים האחרונים`, memberLine(m || { name: member.name, leads: 0, handled: 0, waiting: 0, won: 0, revenue: 0 }), ...(leads.length ? ['', 'פתוחים עכשיו:', ...leads.map((l) => `• ${clean(l.name, 40)}${l.phone ? ' · ' + l.phone : ''} — ${LABEL[l.status]}`)] : [])].join('\n'), 'report:' + id);
      return true;
    }
    await reply(member.client_id, from, `כאן אני שולח לך לידים${business ? ' של ' + business : ''}. אם תרצה לראות את הדוח שלך או להפסיק לקבל לידים, רק תגיד לי. לכל השאר, דבר עם ${business || 'בעל העסק'} ישירות.`, 'help:' + id);
    return true;
  }
  if (OPT_OUT.test(text)) {
    await optOut(customer.client_id, customer.lead_id, from);
    await reply(customer.client_id, from, 'הוסרת ✅ לא נשלח לך יותר הודעות.', 'optout:' + id);
    await notify(customer.client_id, `🚫 ${clean(customer.name, 40) || 'לקוח'} ביקש להסיר את עצמו. לא אשלח לו יותר הודעות.`, 'customer-optout:' + id);
    return true;
  }
  await notify(customer.client_id, `💬 ${clean(customer.name, 40) || 'לקוח'} השיב להודעה שנשלחה בשמך: ״${clean(text, 400) || '(הודעה שאינה טקסט)'}״\nכדאי לחזור אליו מהוואטסאפ שלך.`, 'customer-reply:' + id);
  return true;
}

module.exports = {
  settings, saveSettings, approveCadence, cadenceText, reviewUrl,
  funnelsFor, funnel, defaultFunnel, itemFunnel, funnelLabel, formQuestions, briefLine, funnelBrief, suggest, rememberCampaign, funnelForCampaign, prepareFunnelCampaign,
  dealTerms, parseDeal, dealText, termsFor, recordDeal,
  addMember, updateMember, members, teamReport, teamReportText, route, notifyMember, onLeadCreated, assign, joinLink,
  onWon, customerText, deliver, runDue, markOutreach, setConsent, optOut, outreachList, overview, routeInbound, OPT_OUT_LINE, KIND_HE
};
