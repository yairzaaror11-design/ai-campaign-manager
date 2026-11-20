'use strict';
// Lead concierge: when a lead fills a Meta lead form (they asked to be contacted),
// the agent sends them a first WhatsApp message in the business's name, asks up to
// 4 short qualification questions, offers 3 viewing slots and books one. The owner
// sees every message, can take over at any time, and gets one summary card.
//
// Safety: the lead conversation is deterministic (no AI text), so it never promises a
// price, availability or terms. Questions about those, a request for a person, or any
// sign of distress/complaint hand the lead to the owner. "הסר" stops all contact.
// Off unless LEAD_CONCIERGE_ENABLED=true and the owner opted in for his business.
const crypto = require('node:crypto');
const db = require('./db');
const { logger } = require('./logger');

const TZ = 'Asia/Jerusalem';
const ACTIVE_DAYS = 60; // inbound from a lead is routed to its conversation this long
const enabled = () => process.env.LEAD_CONCIERGE_ENABLED === 'true';
const digits = (v) => String(v || '').replace(/\D/g, '');
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const clean = (s, max) => String(s || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
const firstName = (name) => (name && name !== 'ליד מ־Meta' ? clean(name, 60).split(' ')[0].slice(0, 30) : '');

// ---------- words ----------
const OPT_OUT = /^(?:הסר|הסירו|הסירו אותי|הסר אותי|להסיר|תסירו|תסירו אותי|stop|unsubscribe|לא מעוניין|לא מעוניינת|לא מעוניינים|אל תפנו אליי|אל תשלחו לי)[.!\s]*$/i;
const DISTRESS = /(תלונ|להתלונן|הטרד|מטריד|ספאם|spam|עורך דין|עו״ד|תביעה|לתבוע|נוכל|רמאי|חוצפה|נמאס|מאוכזב|כועס|עצבני|גרוע|מצוקה|דיכאון|להתאבד|לא רוצה לחיות|חירום|מאיפה יש לכם|מי נתן לכם|איך השגתם)/i;
const ASK_HUMAN = /(נציג|לדבר עם (?:מישהו|בן אדם|אדם|המתווך|המתווכת|הסוכן|הסוכנת)|שיחזרו אליי|תתקשרו|תתקשר|שיתקשרו)/;
const ARE_YOU_BOT = /(בוט|רובוט|אדם אמיתי|בן אדם אמיתי|אתה אמיתי|את אמיתית|מערכת אוטומטית|בינה מלאכותית|\bAI\b|עם מי אני מדבר|מי זה\??$|מי מדבר)/i;
const COMMERCIAL = /(מחיר|כמה עולה|כמה זה עולה|עמלה|דמי תיווך|הנחה|עדיין זמין|עדיין רלוונטי|עדיין פנוי|הנכס פנוי|תנאים|חוזה|משא ומתן|גמיש במחיר|להוריד במחיר|ארנונה|ועד בית|מתי אפשר להיכנס|כמה מטר|כמה חדרים|באיזו קומה)/;

// ---------- questions (at most 4 per lead, by business type) ----------
const profiles = require('./conciergeProfiles');
const MAX_QUESTIONS = 4;
const MORTGAGE_LABEL = { APPROVED: 'משכנתא מאושרת', IN_PROGRESS: 'משכנתא בתהליך', NO: 'עוד בלי אישור משכנתא', NOT_NEEDED: 'בלי משכנתא' };
const TIMING_LABEL = { NOW: 'מיידי', '1-3': 'בחודשים הקרובים', '3-6': 'בעוד כמה חודשים', BROWSING: 'רק בודקים' };
const REAL_ESTATE_TIMING = { '1-3': 'בעוד 1–3 חודשים', '3-6': 'בעוד 3–6 חודשים' };

// The question definition as shown to the lead (body/options may depend on earlier answers).
function questionFor(key, answers, vertical = 'real_estate') {
  const q = profiles.get(vertical).questions.find((x) => x.key === key);
  if (!q) return null;
  const opts = typeof q.options === 'function' ? q.options(answers) : q.options;
  return { key, free: !!q.free, body: typeof q.body === 'function' ? q.body(answers) : q.body, options: opts.map(([title, value, points]) => ({ title, value, ...(points ? { points } : {}) })) };
}

// The next question to ask, or null when qualification is complete.
function nextQuestion(answers, asked, vertical = 'real_estate') {
  if (asked >= MAX_QUESTIONS) return null;
  const profile = profiles.get(vertical);
  if (profile.stop?.(answers)) return null;
  for (const q of profile.questions) {
    if (answers[q.key]) continue;
    if (q.ask && !q.ask(answers)) continue;
    return q.key;
  }
  return null;
}

// Free-text answers: buttons are best, but typed words work too.
function matchAnswer(key, text, choices, { free = false } = {}) {
  const t = clean(text, 200);
  const norm = (s) => s.replace(/[׳'"״().,!?\s–-]/g, '');
  const n = norm(t);
  if (/^[1-9]$/.test(t) && choices[Number(t) - 1]) return choices[Number(t) - 1];
  const exact = choices.find((c) => norm(c.title) === n);
  if (exact) return exact;
  const pick = (value) => choices.find((c) => c.value === value) || null;
  if (key === 'intent') {
    if (/(לקנות|קנייה|קניה|קונה|רכישה|לרכוש)/.test(t)) return { title: 'קנייה', value: 'BUY' };
    if (/(לשכור|שכירות|שוכר)/.test(t)) return { title: 'שכירות', value: 'RENT', points: 1 };
    if (/(למכור|מוכר|מכירה|להשכיר את)/.test(t)) return { title: 'מוכרים נכס', value: 'SELL', points: 2 };
  }
  if (key === 'timing') {
    if (/(מיד|עכשיו|כמה שיותר מהר|דחוף|החודש|השבוע)/.test(t)) return pick('NOW') || { title: 'מיידי', value: 'NOW', points: 3 };
    if (/(בודק|סתם|לא בטוח|לא דחוף|בעתיד)/.test(t)) return pick('BROWSING') || { title: 'רק בודקים כרגע', value: 'BROWSING', points: -2 };
  }
  if (key === 'mortgage') {
    if (/^(?:כן|יש|יש לי|יש לנו)(?:\s|,|$)/.test(t) || /אישור עקרוני/.test(t) && !/אין|לא/.test(t)) return { title: 'יש אישור עקרוני', value: 'APPROVED', points: 2 };
    if (/(בתהליך|בבדיקה|מחכים)/.test(t)) return { title: 'בתהליך', value: 'IN_PROGRESS', points: 1 };
    if (/(מזומן|הון עצמי|לא צריך|לא צריכים|בלי משכנתא)/.test(t)) return { title: 'לא צריך משכנתא', value: 'NOT_NEEDED', points: 2 };
    if (/^(?:לא|עוד לא|אין)(?:\s|,|$)/.test(t)) return { title: 'עוד לא', value: 'NO' };
  }
  if (!free || /[?？]/.test(t) || t.length < 2 || t.length > 60 || /\d{6,}/.test(t)) return null;
  if (key === 'budget' && !/\d/.test(t)) return null;
  return { title: t, value: t };
}

// hot / warm / cold from the answers' points (timing, mortgage, intent...) plus a known budget.
function score(answers) {
  let points = 0;
  for (const [key, a] of Object.entries(answers || {})) {
    if (!a || typeof a !== 'object') continue;
    if (Number.isFinite(a.points)) points += a.points;
    if (key === 'budget' && a.value !== 'UNKNOWN') points += 1;
  }
  return points >= 4 ? 'HOT' : points >= 2 ? 'WARM' : 'COLD';
}
const SCORE_LABEL = { HOT: '🔥 ליד חם', WARM: '🙂 ליד פושר', COLD: '❄️ ליד קר' };

// ---------- time & availability ----------
const DAY_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const DAY_WORDS = { 'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3, 'חמישי': 4, 'שישי': 5, 'שבת': 6, 'א': 0, 'ב': 1, 'ג': 2, 'ד': 3, 'ה': 4, 'ו': 5, 'ש': 6 };

function offsetMinutes(date) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' }).formatToParts(date).find((p) => p.type === 'timeZoneName')?.value || '';
  const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}
function localParts(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map((x) => [x.type, x.value]));
  const y = Number(p.year), mo = Number(p.month), d = Number(p.day);
  return { y, mo, d, h: Number(p.hour), mi: Number(p.minute), weekday: new Date(Date.UTC(y, mo - 1, d)).getUTCDay() };
}
function zonedToUtc(y, mo, d, h, mi) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - offsetMinutes(new Date(guess)) * 60000;
  const second = guess - offsetMinutes(new Date(t)) * 60000;
  if (second !== t) t = second;
  return new Date(t);
}
const pad = (n) => String(n).padStart(2, '0');
function slotLabel(date) {
  const p = localParts(date);
  return `יום ${DAY_SHORT[p.weekday]} ${p.d}.${p.mo} · ${pad(p.h)}:${pad(p.mi)}`;
}
function shortWhen(date) {
  const p = localParts(date);
  return `ביום ${DAY_SHORT[p.weekday]} ${pad(p.h)}:${pad(p.mi)}`;
}
const timeOf = (s) => { const m = String(s).match(/^(\d{1,2}):(\d{2})$/); return m && Number(m[1]) <= 23 && Number(m[2]) <= 59 ? Number(m[1]) * 60 + Number(m[2]) : null; };

function validAvailability(list) {
  if (!Array.isArray(list) || list.length > 7) return null;
  const out = [];
  for (const w of list) {
    if (!w || !Array.isArray(w.days) || !w.days.length || w.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return null;
    const start = timeOf(w.start), end = timeOf(w.end);
    if (start === null || end === null || end - start < 15) return null;
    out.push({ days: [...new Set(w.days)].sort(), start: w.start.padStart(5, '0'), end: w.end.padStart(5, '0') });
  }
  return out;
}

// "א-ה 10:00-18:00", "ראשון עד חמישי 10-18", "א׳–ה׳ 16:00–20:00"
function parseAvailability(text) {
  const t = String(text || '').replace(/[׳']/g, '').replace(/–|—/g, '-');
  const day = '(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת|[אבגדהוש])';
  const m = t.match(new RegExp(`(?:ימים\\s+|יום\\s+)?${day}\\s*(?:-|עד)\\s*(?:יום\\s+)?${day}\\s*,?\\s*(?:בין\\s+|בשעות\\s+|משעה\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*(?:-|עד)\\s*(\\d{1,2})(?::(\\d{2}))?`));
  if (!m) return null;
  const from = DAY_WORDS[m[1]], to = DAY_WORDS[m[2]];
  if (from === undefined || to === undefined || to < from) return null;
  const days = []; for (let d = from; d <= to; d++) days.push(d);
  return validAvailability([{ days, start: `${pad(m[3])}:${m[4] || '00'}`, end: `${pad(m[5])}:${m[6] || '00'}` }]);
}
function availabilityText(list) {
  return (list || []).map((w) => {
    const days = w.days.length > 1 && w.days.at(-1) - w.days[0] === w.days.length - 1 ? `${DAY_SHORT[w.days[0]]}–${DAY_SHORT[w.days.at(-1)]}` : w.days.map((d) => DAY_SHORT[d]).join(', ');
    return `${days} ${w.start}–${w.end}`;
  }).join('; ');
}

// Up to `count` free slots in the next 8 days, at least 3 hours from now, one per day first.
function freeSlots(availability, slotMinutes, booked, { now = new Date(), count = 3 } = {}) {
  const taken = new Set((booked || []).map((d) => new Date(d).getTime()));
  const earliest = now.getTime() + 3 * 3600000;
  const byDay = [];
  const today = localParts(now);
  for (let i = 0; i < 8; i++) {
    const base = new Date(Date.UTC(today.y, today.mo - 1, today.d + i));
    const y = base.getUTCFullYear(), mo = base.getUTCMonth() + 1, d = base.getUTCDate(), weekday = base.getUTCDay();
    const slots = [];
    for (const w of availability || []) {
      if (!w.days.includes(weekday)) continue;
      for (let m = timeOf(w.start); m + slotMinutes <= timeOf(w.end); m += slotMinutes) {
        const at = zonedToUtc(y, mo, d, Math.floor(m / 60), m % 60);
        if (at.getTime() >= earliest && !taken.has(at.getTime())) slots.push(at);
      }
    }
    if (slots.length) byDay.push(slots.sort((a, b) => a - b));
  }
  const picked = [];
  for (const day of byDay) { if (picked.length < count) picked.push(day[0]); }
  for (const day of byDay) for (const s of day.slice(1)) if (picked.length < count) picked.push(s);
  return picked.sort((a, b) => a - b);
}

// ---------- settings ----------
async function settings(clientId) {
  return (await db.query('SELECT * FROM lead_concierge_settings WHERE client_id=$1', [clientId])).rows[0] || null;
}
async function saveSettings(clientId, { enabled: on, availability, slotMinutes, vertical } = {}) {
  if (vertical !== undefined && vertical !== null && !profiles.KEYS.includes(vertical)) throw Error('INVALID_CONCIERGE_SETTINGS');
  if (on !== undefined && typeof on !== 'boolean') throw Error('INVALID_CONCIERGE_SETTINGS');
  let avail = null;
  if (availability !== undefined) { avail = validAvailability(availability); if (!avail) throw Error('INVALID_AVAILABILITY'); }
  if (slotMinutes !== undefined && (!Number.isInteger(slotMinutes) || slotMinutes < 15 || slotMinutes > 240)) throw Error('INVALID_CONCIERGE_SETTINGS');
  const r = await db.query(`INSERT INTO lead_concierge_settings(client_id,enabled,decided_at,availability,slot_minutes,vertical)
    VALUES($1,COALESCE($2,FALSE),CASE WHEN $2::boolean IS NULL THEN NULL ELSE NOW() END,COALESCE($3::jsonb,'[]'::jsonb),COALESCE($4,60),$5)
    ON CONFLICT(client_id) DO UPDATE SET enabled=COALESCE($2,lead_concierge_settings.enabled),
      decided_at=CASE WHEN $2::boolean IS NULL THEN lead_concierge_settings.decided_at ELSE NOW() END,
      availability=COALESCE($3::jsonb,lead_concierge_settings.availability),slot_minutes=COALESCE($4,lead_concierge_settings.slot_minutes),vertical=COALESCE($5,lead_concierge_settings.vertical),updated_at=NOW()
    RETURNING *`, [clientId, on ?? null, avail ? JSON.stringify(avail) : null, slotMinutes ?? null, vertical ?? null]);
  await db.query("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'LEAD_CONCIERGE_SETTINGS',$2)", [clientId, r.rows[0].enabled ? 'ON' : 'OFF']);
  return r.rows[0];
}

// ---------- business facts ----------
// Which question set fits this business: the owner's choice, then a shared vertical
// profile (verticalProfiles.js, if present), then the owner's own business description.
async function verticalFor(clientId, facts) {
  const chosen = (await db.query('SELECT vertical FROM lead_concierge_settings WHERE client_id=$1', [clientId])).rows[0]?.vertical;
  if (profiles.KEYS.includes(chosen)) return chosen;
  try {
    const vp = require('./verticalProfiles');
    const found = vp.profileFor ? await vp.profileFor(clientId) : vp.forClient ? await vp.forClient(clientId) : vp.detect ? vp.detect(facts) : null;
    const key = typeof found === 'string' ? found : found?.key;
    if (profiles.KEYS.includes(key)) return key;
  } catch { /* not merged yet */ }
  return profiles.detect(facts);
}
async function business(clientId, vertical) {
  const facts = await require('./leadSpeed').businessFacts(clientId).catch(() => ({}));
  const row = (await db.query('SELECT display_name FROM clients WHERE id=$1', [clientId])).rows[0];
  const owner = firstName(row?.display_name);
  const okOwner = /^[֐-׿A-Za-z'׳-]{2,20}$/.test(owner) ? owner : '';
  const key = vertical && profiles.KEYS.includes(vertical) ? vertical : await verticalFor(clientId, facts);
  const profile = profiles.get(key);
  const name = clean(facts.businessName, 60) || (okOwner ? okOwner : profile.businessWord);
  return { name, owner: okOwner, facts, vertical: key, profile };
}

// Catalog link: the lead may belong to one listing/product. Another migration owns
// those tables (crm_leads.catalog_item_id → catalog_items, or crm_leads.property_id →
// properties); read them defensively and never create them here.
const LINKS = [['catalog_item_id', 'catalog_items'], ['property_id', 'properties']];
const ITEM_MATCH = ['meta_form_id', 'lead_form_id', 'form_id'];
const ITEM_CAMPAIGN = ['meta_campaign_id', 'campaign_id'];
const ITEM_TITLE = ['title', 'name', 'headline'];
const ITEM_AREA = ['neighbourhood', 'neighborhood', 'city', 'area'];
const ITEM_DEAL = ['deal_type', 'listing_type', 'transaction_type'];
const KIND_LABEL = { APARTMENT: 'דירה', GARDEN: 'דירת גן', PENTHOUSE: 'פנטהאוז', DUPLEX: 'דופלקס', HOUSE: 'בית פרטי', OFFICE: 'משרד', STORE: 'חנות', LAND: 'מגרש' };
async function linkColumns() {
  const r = await db.query(`SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name IN ('crm_leads','catalog_items','properties')`);
  const cols = { crm_leads: new Set(), catalog_items: new Set(), properties: new Set() };
  for (const row of r.rows) cols[row.table_name]?.add(row.column_name);
  return cols;
}
function propertySubject(row, table = 'properties') {
  if (!row) return null;
  const pickText = (list) => list.map((c) => row[c]).find((v) => typeof v === 'string' && v.trim());
  const title = pickText(ITEM_TITLE), area = pickText(ITEM_AREA), deal = String(pickText(ITEM_DEAL) || '');
  const kind = KIND_LABEL[row.property_kind] || '';
  const subject = title || (kind && area ? `${kind} ב${area}` : area ? `הנכס ב${area}` : kind);
  const isProperty = table === 'properties' || !!row.property_kind || !!deal;
  return {
    subject: clean(subject, 60) || null,
    area: area ? clean(area, 60) : null,
    intent: /rent|השכר|שכיר/i.test(deal) ? 'RENT' : /sale|sell|מכיר|קני/i.test(deal) ? 'BUY' : null,
    vertical: isProperty ? 'real_estate' : null
  };
}
async function linkProperty(clientId, lead, formId) {
  try {
    const cols = await linkColumns();
    for (const [column, table] of LINKS) {
      if (!cols.crm_leads.has(column) || !cols[table].has('client_id')) continue;
      let itemId = (await db.query(`SELECT "${column}" AS id FROM crm_leads WHERE client_id=$1 AND id=$2`, [clientId, lead.id])).rows[0]?.id || null;
      if (!itemId) {
        const tries = [...ITEM_MATCH.filter((c) => cols[table].has(c)).map((c) => [c, formId]), ...ITEM_CAMPAIGN.filter((c) => cols[table].has(c)).map((c) => [c, lead.campaign_id])];
        for (const [match, value] of tries) {
          if (!value) continue;
          const rows = (await db.query(`SELECT id FROM "${table}" WHERE client_id=$1 AND "${match}"::text=$2 LIMIT 2`, [clientId, String(value)])).rows;
          if (rows.length === 1) { itemId = rows[0].id; break; }
        }
        if (itemId) await db.query(`UPDATE crm_leads SET "${column}"=$3 WHERE client_id=$1 AND id=$2 AND "${column}" IS NULL`, [clientId, lead.id, itemId]);
      }
      if (!itemId) continue;
      const row = (await db.query(`SELECT * FROM "${table}" WHERE client_id=$1 AND id=$2`, [clientId, itemId])).rows[0];
      return propertySubject(row, table);
    }
    return null;
  } catch (error) {
    logger.warn('Lead catalog link skipped', { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'CATALOG_LOOKUP_FAILED' });
    return null;
  }
}

// ---------- outbound ----------
function templateConfig(name) {
  const value = String(name || '').trim();
  if (!value) return { reason: 'NO_TEMPLATE' };
  const allowed = String(process.env.WHATSAPP_APPROVED_TEMPLATES || '').split(',').map((s) => s.trim());
  if (!/^[a-z0-9_]+$/.test(value) || !allowed.includes(value)) return { reason: 'TEMPLATE_NOT_APPROVED' };
  const language = process.env.WA_TEMPLATE_LANGUAGE || 'he';
  if (!/^[a-z]{2}(?:_[A-Z]{2})?$/.test(language)) return { reason: 'TEMPLATE_NOT_APPROVED' };
  return { name: value, language };
}
// The exact text the owner submits to Meta (body params {{1}}..{{3}}).
const FIRST_CONTACT_TEXT = 'שלום {{1}}, כאן {{2}} 👋\nקיבלנו את הפרטים שהשארתם לגבי {{3}}, ונשמח לעזור.\nכדי שנוכל לעזור בדיוק במה שצריך, אפשר לשאול כמה שאלות קצרות?\nלא מעוניינים בפניות מאיתנו? כתבו ״הסר״.';
const REMINDER_TEXT = 'תזכורת מ{{1}}: מחכים לכם היום בשעה {{2}}. אם משהו השתנה, השיבו להודעה הזו. להסרה כתבו ״הסר״.';
const render = (text, params) => text.replace(/\{\{(\d)\}\}/g, (_, i) => params[Number(i) - 1] ?? '');
function templatePayload(config, params) {
  return { type: 'template', template: { name: config.name, language: { code: config.language }, components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] } };
}
const textPayload = (body) => ({ type: 'text', text: { body: String(body).slice(0, 4000), preview_url: false } });
function buttonsPayload(body, nonce, choices) {
  const rows = choices.map((c, i) => ({ id: `lc:${nonce}:${i}`, title: c.title }));
  if (rows.length <= 3) return { type: 'interactive', interactive: { type: 'button', body: { text: body }, action: { buttons: rows.map((r) => ({ type: 'reply', reply: r })) } } };
  return { type: 'interactive', interactive: { type: 'list', body: { text: body }, action: { button: 'לבחירה', sections: [{ title: 'אפשרויות', rows }] } } };
}

// Queues one message to the lead and records it for the owner. Idempotent per key.
async function sendToLead(conv, payload, body, key, { optOutNotice = false } = {}) {
  if (!optOutNotice && (await db.query('SELECT 1 FROM lead_optouts WHERE client_id=$1 AND wa_phone=$2', [conv.client_id, conv.wa_phone])).rows.length) return { queued: false, reason: 'OPTED_OUT' };
  const inserted = await db.query(`INSERT INTO whatsapp_outbox(id,client_id,dedupe_key,recipient,payload) VALUES($1,$2,$3,$4,$5::jsonb)
    ON CONFLICT(dedupe_key) DO NOTHING RETURNING id`, [crypto.randomUUID(), conv.client_id, hash('lead-concierge:' + key), conv.wa_phone, JSON.stringify(payload)]);
  if (!inserted.rows.length) return { queued: false, reason: 'DUPLICATE' };
  await db.query("INSERT INTO lead_messages(conversation_id,client_id,direction,body) VALUES($1,$2,'OUT',$3)", [conv.id, conv.client_id, String(body).slice(0, 4000)]);
  return { queued: true, id: inserted.rows[0].id };
}

async function ownerContact(clientId) {
  return (await db.query(`SELECT c.phone, w.last_inbound_at>NOW()-INTERVAL '24 hours' AS open
    FROM clients c LEFT JOIN whatsapp_contacts w ON w.phone=c.phone WHERE c.id=$1`, [clientId])).rows[0] || null;
}
const OWNER_KEYS = ['lead_concierge_optin', 'lead_concierge_hours', 'lead_concierge_lead', 'lead_viewing_outcome'];
async function canShowButtons(clientId) {
  try {
    const p = await require('./marketingStore').load(clientId);
    return !(p?.ui && p.ui.expiresAt > Date.now() && ![...OWNER_KEYS, 'crm_status', 'crm_leads', 'lead_contact'].includes(p.ui.decisionKey));
  } catch { return false; }
}
// A message to the owner (never throws). Inside the 24h window: text, then optional
// buttons; outside it: the owner alert template (if approved) invites him back.
async function notifyOwner(clientId, text, key, { buttons = null, decisionKey = 'lead_concierge_lead' } = {}) {
  try {
    const owner = await ownerContact(clientId);
    if (!owner?.phone) return { status: 'NO_OWNER' };
    const delivery = require('./whatsappDelivery');
    const takeoverId = buttons?.find((b) => String(b.text).startsWith('/lc-takeover '))?.text.slice(13);
    if (takeoverId) await require('./marketingStore').update(clientId, null, (p) => { p.leadConciergeLast = takeoverId; return { handled: false, changed: true }; });
    return await require('./metaConnection').context.run(String(clientId), () =>
      delivery.messageContext.run({ eventId: 'lead-concierge-owner:' + key, sequence: 0, humanSupportNotice: false }, async () => {
        if (!owner.open) {
          const template = process.env.LEAD_ALERT_TEMPLATE;
          if (template) { await delivery.enqueueTemplate(owner.phone, template, process.env.LEAD_ALERT_TEMPLATE_LANGUAGE || 'he'); return { status: 'TEMPLATE_QUEUED' }; }
          return { status: 'WINDOW_CLOSED' };
        }
        if (buttons && await canShowButtons(clientId)) {
          const ui = await require('./conversationUi').prepareChoices(clientId, String(text).slice(0, 1024), buttons, decisionKey);
          if (String(text).length > 1024) await delivery.enqueue(owner.phone, delivery.textPayload(text));
          await delivery.enqueue(owner.phone, ui.interactivePayload);
          return { status: 'QUEUED', buttons: true };
        }
        await delivery.enqueue(owner.phone, delivery.textPayload(text));
        return { status: 'QUEUED' };
      }));
  } catch (error) {
    logger.warn('Lead concierge owner notice not queued', { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'NOTICE_FAILED' });
    return { status: 'FAILED' };
  }
}

async function event(clientId, leadId, kind, detail) {
  await db.query('INSERT INTO lead_events(lead_id,client_id,kind,detail) VALUES($1,$2,$3,$4)', [leadId, clientId, kind, String(detail || '').slice(0, 300)]).catch(() => {});
}

// ---------- new lead ----------
// Called for every newly saved Meta lead-form lead. Falls back to today's owner alert
// (one-tap message) whenever the agent cannot contact the lead itself, and records why.
async function onNewLead(clientId, lead, { answers = [], formId = null, writer } = {}) {
  const alert = () => require('./leadAlert').notifyOwner(clientId, lead, { answers, writer });
  if (!enabled() || !lead?.id) return alert();
  let s;
  try { s = await settings(clientId); } catch { return alert(); }
  if (!s?.enabled) {
    const undecided = !s?.decided_at && (!s?.asked_at || Date.now() - new Date(s.asked_at).getTime() > 7 * 86400000);
    const result = await require('./leadAlert').notifyOwner(clientId, lead, { answers, writer, buttons: undecided ? false : undefined });
    if (undecided) await askOptIn(clientId, 'lead:' + lead.id);
    return result;
  }
  const outcome = await firstContact(clientId, lead, { answers, formId }).catch((error) => {
    logger.warn('Lead concierge first contact failed', { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'FIRST_CONTACT_FAILED' });
    return { reason: 'SEND_FAILED' };
  });
  if (outcome.conversation) {
    const name = clean(lead.name, 40) || 'ליד חדש';
    await notifyOwner(clientId, [
      `🔔 ליד חדש: ${name}${lead.phone ? ' · ' + lead.phone : ''}`,
      'הסוכן כבר שלח לליד הודעה בשמך ושואל כמה שאלות התאמה קצרות.',
      'אעדכן אותך כשיהיו תשובות או כשייקבע מועד. כל הודעה שנשלחה בשמך מופיעה בדשבורד.',
      require('./dashboardLink').hint('leads')
    ].join('\n'), 'new:' + lead.id, { buttons: [{ title: 'אני ממשיך מכאן', text: '/lc-takeover ' + lead.id }] });
    return { status: 'CONCIERGE' };
  }
  await event(clientId, lead.id, 'CONCIERGE_FALLBACK', outcome.reason);
  const result = await alert();
  return { ...result, conciergeFallback: outcome.reason };
}

async function firstContact(clientId, lead, { answers = [], formId = null } = {}) {
  if (lead.source !== 'meta_lead_ads') return { reason: 'NOT_REQUESTED' };
  const wa = require('./leadAlert').waNumber(lead.phone);
  if (!wa) return { reason: 'NO_PHONE' };
  if ((await db.query('SELECT 1 FROM clients WHERE phone=$1', [wa])).rows.length) return { reason: 'LEAD_IS_CLIENT' };
  if ((await db.query('SELECT 1 FROM lead_optouts WHERE client_id=$1 AND wa_phone=$2', [clientId, wa])).rows.length) return { reason: 'OPTED_OUT' };
  if (process.env.WHATSAPP_SEND_ENABLED !== 'true') return { reason: 'SENDING_DISABLED' };
  const config = templateConfig(process.env.WA_TEMPLATE_LEAD_FIRST_CONTACT);
  if (!config.name) return { reason: config.reason };
  const property = await linkProperty(clientId, lead, formId);
  const biz = await business(clientId, property?.vertical);
  const prefill = {};
  if (biz.vertical === 'real_estate' && property?.intent) prefill.intent = { value: property.intent, label: property.intent === 'RENT' ? 'שכירות' : 'קנייה', ...(property.intent === 'RENT' ? { points: 1 } : {}), source: 'property' };
  if (biz.vertical === 'real_estate' && property?.area) prefill.area = { value: property.area, label: property.area, source: 'property' };
  const formText = answers.map((a) => a.answer).join(' ');
  if (biz.vertical !== 'real_estate') { /* intent is a real-estate question */ }
  else if (!prefill.intent && /(שכירות|לשכור)/.test(formText)) prefill.intent = { value: 'RENT', label: 'שכירות', points: 1, source: 'form' };
  else if (!prefill.intent && /(קנייה|קניה|לקנות|רכישה)/.test(formText)) prefill.intent = { value: 'BUY', label: 'קנייה', source: 'form' };
  const subject = property?.subject || (biz.facts.product && biz.facts.product.length <= 40 ? clean(biz.facts.product, 40) : biz.profile.subject);
  const params = [firstName(lead.name) || 'לכם', clean(biz.name, 60), clean(subject, 60)];
  const conv = (await db.query(`INSERT INTO lead_conversations(id,client_id,lead_id,wa_phone,status,answers,vertical)
    VALUES($1,$2,$3,$4,'PENDING',$5::jsonb,$6) ON CONFLICT(lead_id) DO NOTHING RETURNING *`,
  [crypto.randomUUID(), clientId, lead.id, wa, JSON.stringify(prefill), biz.vertical])).rows[0];
  if (!conv) return { reason: 'ALREADY_STARTED' };
  // The lead form is the consent to be contacted; the template needs it recorded.
  await db.query(`INSERT INTO whatsapp_contacts(phone,last_inbound_at,opted_in) VALUES($1,to_timestamp(0),TRUE)
    ON CONFLICT(phone) DO UPDATE SET opted_in=TRUE`, [wa]);
  const sent = await sendToLead(conv, templatePayload(config, params), render(FIRST_CONTACT_TEXT, params), 'first:' + lead.id);
  if (!sent.queued) {
    await db.query("UPDATE lead_conversations SET status='FALLBACK',fallback_reason=$2,updated_at=NOW() WHERE id=$1", [conv.id, sent.reason || 'SEND_FAILED']);
    return { reason: sent.reason || 'SEND_FAILED' };
  }
  await db.query("UPDATE lead_conversations SET status='CONTACTED',step='START',first_outbox_id=$2,updated_at=NOW() WHERE id=$1", [conv.id, sent.id]);
  try { await require('./crmService').update(clientId, lead.id, { status: 'CONTACTED', version: Number(lead.version) }); } catch { /* the owner may have moved it already */ }
  await event(clientId, lead.id, 'CONCIERGE', 'FIRST_CONTACT');
  return { conversation: { ...conv, status: 'CONTACTED' } };
}

// ---------- inbound routing ----------
// A message from a number that is not a business owner but is a lead the agent
// contacted goes to the lead conversation, never to the owner's agent conversation.
async function routeInbound(message, contact) {
  if (!db.configured()) return false;
  const from = digits(message?.from);
  if (!/^\d{8,15}$/.test(from)) return false;
  if ((await db.query('SELECT 1 FROM clients WHERE phone=$1', [from])).rows.length) return false;
  const conv = (await db.query(`SELECT * FROM lead_conversations WHERE wa_phone=$1 AND status<>'FALLBACK'
    AND updated_at>NOW()-make_interval(days=>$2::int) ORDER BY updated_at DESC LIMIT 1`, [from, ACTIVE_DAYS])).rows[0];
  if (!conv) return false;
  try { await require('./whatsappDelivery').recordInbound(message); } catch { /* invalid timestamp: still handle */ }
  if (!await require('./rateLimit').take('lead-chat:' + from, 20)) return true;
  await handleLeadMessage(conv, message, contact);
  return true;
}

function inboundText(conv, message) {
  if (message.type === 'text') return { text: clean(message.text?.body, 1000) };
  if (message.type === 'button') return { text: clean(message.button?.text || message.button?.payload, 200) };
  if (message.type === 'interactive') {
    const id = message.interactive?.button_reply?.id || message.interactive?.list_reply?.id;
    const m = typeof id === 'string' && id.match(/^lc:([a-f0-9]{24}):(\d)$/);
    const ui = conv.ui;
    if (m && ui?.nonce === m[1] && ui.choices?.[Number(m[2])]) return { text: ui.choices[Number(m[2])].title, choice: ui.choices[Number(m[2])] };
    return { text: clean(message.interactive?.button_reply?.title || message.interactive?.list_reply?.title, 200), stale: true };
  }
  return { text: '', media: true };
}

async function update(conv, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k}=$${i + 2}${['answers', 'ui'].includes(k) ? '::jsonb' : ''}`);
  const values = keys.map((k) => (['answers', 'ui'].includes(k) && fields[k] !== null ? JSON.stringify(fields[k]) : fields[k]));
  const r = await db.query(`UPDATE lead_conversations SET ${sets.join(',')},updated_at=NOW() WHERE id=$1 RETURNING *`, [conv.id, ...values]);
  return r.rows[0];
}

async function leadRow(conv) {
  return (await db.query('SELECT * FROM crm_leads WHERE client_id=$1 AND id=$2', [conv.client_id, conv.lead_id])).rows[0] || {};
}

async function handleLeadMessage(conv, message) {
  const input = inboundText(conv, message);
  const logged = input.text || (input.media ? '[קובץ או הודעה קולית]' : '');
  if (logged) await db.query("INSERT INTO lead_messages(conversation_id,client_id,direction,body) VALUES($1,$2,'IN',$3)", [conv.id, conv.client_id, logged.slice(0, 4000)]);
  const key = (n) => `in:${message.id || crypto.randomUUID()}:${n}`;
  const lead = await leadRow(conv);
  const name = clean(lead.name, 40) || 'הליד';
  const biz = await business(conv.client_id, conv.vertical);
  const reply = (body, n = 0) => sendToLead(conv, textPayload(body), body, key(n));

  // Opt-out always wins, in any state.
  if (input.text && OPT_OUT.test(input.text)) {
    await db.query('INSERT INTO lead_optouts(client_id,wa_phone) VALUES($1,$2) ON CONFLICT DO NOTHING', [conv.client_id, conv.wa_phone]);
    const already = conv.status === 'OPTED_OUT';
    await update(conv, { status: 'OPTED_OUT', ui: null, handoff_reason: 'OPT_OUT' });
    if (!already) {
      await sendToLead(conv, textPayload('הוסרתם, ולא נשלח הודעות נוספות. תודה ויום טוב.'), 'הוסרתם, ולא נשלח הודעות נוספות. תודה ויום טוב.', key(0), { optOutNotice: true });
      await db.query("UPDATE lead_viewings SET status='CANCELLED',updated_at=NOW() WHERE conversation_id=$1 AND status='BOOKED'", [conv.id]);
      await event(conv.client_id, conv.lead_id, 'CONCIERGE', 'OPT_OUT');
      await notifyOwner(conv.client_id, `🚫 ${name} ביקש/ה להסיר את עצמו/ה. הסוכן לא ישלח יותר הודעות לליד הזה.`, 'optout:' + conv.id);
    }
    return;
  }
  // Owner took over / opted out / sending turned off: only forward, never answer.
  if (['OWNER', 'OPTED_OUT'].includes(conv.status) || !enabled()) {
    if (logged) await notifyOwner(conv.client_id, `💬 ${name} כתב/ה: ״${logged.slice(0, 500)}״\nהסוכן לא עונה בשיחה הזו. כדאי לחזור אליו/ה מהוואטסאפ שלך.`, 'fwd:' + (message.id || crypto.randomUUID()));
    return;
  }
  // Distress or a complaint: stop and hand to the owner.
  if (input.text && DISTRESS.test(input.text)) {
    await update(conv, { status: 'OWNER', ui: null, handoff_reason: 'DISTRESS' });
    await reply(`תודה שכתבתם. העברתי את ההודעה, ונחזור אליכם אישית בהקדם.`);
    await event(conv.client_id, conv.lead_id, 'CONCIERGE', 'HANDOFF_DISTRESS');
    await notifyOwner(conv.client_id, `⚠️ ${name} כתב/ה משהו שדורש מגע אישי:\n״${logged.slice(0, 500)}״\nהסוכן הפסיק לענות לליד הזה. כדאי לחזור אליו/ה בעצמך.`, 'distress:' + conv.id);
    return;
  }
  if (input.text && ASK_HUMAN.test(input.text)) {
    await update(conv, { status: 'OWNER', ui: null, handoff_reason: 'LEAD_ASKED_HUMAN' });
    await reply(`בשמחה. העברתי את הבקשה, ונחזור אליכם אישית בהקדם.`);
    await event(conv.client_id, conv.lead_id, 'CONCIERGE', 'HANDOFF_HUMAN');
    await notifyOwner(conv.client_id, `📞 ${name} מבקש/ת לדבר עם אדם. הסוכן הפסיק לענות.\n${await summaryLine(conv, lead)}`, 'human:' + conv.id);
    return;
  }
  let n = 0;
  if (input.text && ARE_YOU_BOT.test(input.text)) {
    await reply(`אני עוזר דיגיטלי (בוט) של ${biz.name}, לא אדם. כל ההודעות כאן נקראות גם על ידי הצוות, ואפשר לבקש בכל רגע שנחזור אליכם אישית.`, n++);
    if (!conv.ui) return;
    return askCurrent(conv, key, n, { repeat: true });
  }
  if (input.text && COMMERCIAL.test(input.text) && !input.choice) {
    await reply(`שאלה טובה. על מחירים, זמינות ותנאים נענה לכם אישית, כדי שתקבלו תשובה מדויקת. העברתי את השאלה.`, n++);
    await notifyOwner(conv.client_id, `❓ ${name} שאל/ה: ״${logged.slice(0, 400)}״\nהסוכן לא עונה על מחירים, זמינות ותנאים. כדאי לחזור אליו/ה.`, 'question:' + (message.id || crypto.randomUUID()));
    if (!conv.ui) return;
    return askCurrent(conv, key, n, { repeat: true });
  }

  if (conv.status === 'CONTACTED') {
    // Any reply to the first message starts the short questions.
    await update(conv, { status: 'QUALIFYING' });
    return askNext({ ...conv, status: 'QUALIFYING' }, key, n, { intro: 'תודה! רק כמה שאלות קצרות, אפשר ללחוץ על התשובה.' });
  }
  if (conv.status === 'QUALIFYING' && conv.ui?.key) {
    const answer = input.choice || (input.text ? matchAnswer(conv.ui.key, input.text, conv.ui.choices || [], { free: !!conv.ui.free }) : null);
    if (!answer) {
      const misses = (conv.ui.misses || 0) + 1;
      if (misses >= 2) return handOffUnclear(conv, lead, biz, key, n);
      const next = await update(conv, { ui: { ...conv.ui, misses } });
      await reply('לא בטוח שהבנתי 🙂 אפשר לבחור מהאפשרויות או לכתוב במילים.', n++);
      return askCurrent(next, key, n, { repeat: true });
    }
    const answers = { ...conv.answers, [conv.ui.key]: { value: answer.value, label: answer.title, ...(Number.isFinite(answer.points) ? { points: answer.points } : {}) } };
    const next = await update(conv, { answers });
    return askNext(next, key, n);
  }
  if (conv.status === 'SCHEDULING' && conv.ui?.key === 'slot') {
    const choice = input.choice || (/^[1-4]$/.test(input.text) ? conv.ui.choices[Number(input.text) - 1] : null);
    if (choice?.value === 'OTHER' || /(מועד אחר|זמן אחר|לא מתאים|אף אחד)/.test(input.text || '')) {
      await update(conv, { status: 'DONE', ui: null, handoff_reason: 'OTHER_TIME' });
      await reply(`בסדר גמור. נחזור אליכם לתאם מועד שנוח לכם.`, n++);
      await notifyOwner(conv.client_id, `🗓 ${await summaryLine(conv, lead)}\nאף אחד מהמועדים לא התאים. כדאי לחזור לתאם מועד.`, 'other-time:' + conv.id, { buttons: [{ title: 'אני ממשיך מכאן', text: '/lc-takeover ' + conv.lead_id }] });
      return;
    }
    if (!choice) {
      const misses = (conv.ui.misses || 0) + 1;
      if (misses >= 2) return handOffUnclear(conv, lead, biz, key, n);
      const next = await update(conv, { ui: { ...conv.ui, misses } });
      return askCurrent(next, key, n, { repeat: true });
    }
    return book(conv, lead, biz, new Date(choice.value), key, n);
  }
  // BOOKED / DONE / no open question: keep the owner in the loop, answer politely once.
  if (logged) {
    await notifyOwner(conv.client_id, `💬 ${name} כתב/ה: ״${logged.slice(0, 500)}״`, 'fwd:' + (message.id || crypto.randomUUID()));
    const last = (await db.query("SELECT created_at FROM lead_messages WHERE conversation_id=$1 AND direction='OUT' ORDER BY id DESC LIMIT 1", [conv.id])).rows[0];
    if (!last || Date.now() - new Date(last.created_at).getTime() > 10 * 60000) await reply(`קיבלנו, תודה! נחזור אליכם בהקדם.`, n++);
  }
}

async function handOffUnclear(conv, lead, biz, key, n) {
  await update(conv, { status: 'DONE', ui: null, handoff_reason: 'UNCLEAR' });
  await sendToLead(conv, textPayload(`תודה! נחזור אליכם אישית בהקדם.`), `תודה! נחזור אליכם אישית בהקדם.`, key(n));
  await notifyOwner(conv.client_id, `💬 ${await summaryLine(conv, lead)}\nהשיחה עם הסוכן לא הסתדרה, כדאי לחזור לליד בעצמך.`, 'unclear:' + conv.id);
}

async function askCurrent(conv, key, n, { repeat = false } = {}) {
  if (!conv.ui?.key) return;
  const body = conv.ui.body;
  const payload = buttonsPayload(body, conv.ui.nonce, conv.ui.choices);
  await sendToLead(conv, payload, body + '\n' + conv.ui.choices.map((c) => '• ' + c.title).join('\n'), key(n) + (repeat ? ':again' : ''));
}

async function askNext(conv, key, n, { intro = '' } = {}) {
  const asked = conv.ui?.asked || 0;
  const q = nextQuestion(conv.answers || {}, asked, conv.vertical);
  if (q) {
    const def = questionFor(q, conv.answers || {}, conv.vertical);
    const nonce = crypto.randomBytes(12).toString('hex');
    const ui = { key: q, nonce, body: (intro ? intro + '\n\n' : '') + def.body, choices: def.options, free: def.free, asked: asked + 1 };
    const next = await update(conv, { ui, step: q });
    return askCurrent(next, key, n);
  }
  return finishQualification(conv, key, n);
}

function answerText(key, a, vertical) {
  if (key === 'intent') return a.value === 'RENT' ? 'שכירות' : a.value === 'SELL' ? 'רוצה למכור נכס' : null;
  if (key === 'budget') return a.value === 'UNKNOWN' ? null : 'תקציב ' + a.label;
  if (key === 'area') return a.value === 'גמיש' ? 'אזור גמיש' : 'ב' + a.label.replace(/^ב/, '');
  if (key === 'mortgage') return MORTGAGE_LABEL[a.value] || a.label;
  if (key === 'timing') return (vertical === 'real_estate' && REAL_ESTATE_TIMING[a.value]) || TIMING_LABEL[a.value] || a.label;
  if (key === 'quantity') return 'כמות: ' + a.label;
  if (['UNSURE', 'UNKNOWN'].includes(a.value)) return null;
  return a.label;
}
// "דנה, תקציב 2.5–3 מיליון, בגבעתיים, משכנתא מאושרת — צפייה ביום ג׳ 17:00"
async function summaryLine(conv, lead, viewing) {
  const a = conv.answers || {}, profile = profiles.get(conv.vertical);
  const parts = [clean(lead.name, 40) || 'ליד'];
  for (const q of profile.questions) if (a[q.key]) { const t = answerText(q.key, a[q.key], conv.vertical); if (t) parts.push(t); }
  let line = parts.join(', ');
  if (viewing) line += ` — ${profile.meeting?.noun || 'פגישה'} ${shortWhen(new Date(viewing))}`;
  return line;
}

async function finishQualification(conv, key, n) {
  const lead = await leadRow(conv);
  const biz = await business(conv.client_id, conv.vertical);
  const meeting = biz.profile.meeting;
  const s = score(conv.answers || {});
  await event(conv.client_id, conv.lead_id, 'CONCIERGE', 'QUALIFIED ' + s);
  if (conv.answers?.intent?.value === 'SELL') {
    await update(conv, { status: 'DONE', ui: null, score: s, step: 'DONE' });
    await sendToLead(conv, textPayload(`תודה! נחזור אליכם בהקדם כדי לשמוע על הנכס.`), `תודה! נחזור אליכם בהקדם כדי לשמוע על הנכס.`, key(n));
    await notifyOwner(conv.client_id, `🏠 ${await summaryLine(conv, lead)}\n${SCORE_LABEL[s]}. כדאי לחזור אליו/ה בהקדם.`, 'qualified:' + conv.id, { buttons: [{ title: 'אני ממשיך מכאן', text: '/lc-takeover ' + conv.lead_id }] });
    return;
  }
  const st = await settings(conv.client_id);
  const slots = meeting && st?.availability?.length ? freeSlots(st.availability, st.slot_minutes, await bookedTimes(conv.client_id)) : [];
  if (slots.length) {
    const nonce = crypto.randomBytes(12).toString('hex');
    const choices = [...slots.map((d) => ({ title: slotLabel(d), value: d.toISOString() })), { title: 'מועד אחר', value: 'OTHER' }];
    const ui = { key: 'slot', nonce, body: `תודה על התשובות! מתי נוח לכם להגיע ${meeting?.to}?`, choices, asked: conv.ui?.asked || 0 };
    const next = await update(conv, { status: 'SCHEDULING', ui, score: s, step: 'SLOT' });
    return askCurrent(next, key, n);
  }
  await update(conv, { status: 'DONE', ui: null, score: s, step: 'DONE' });
  const thanks = meeting ? `תודה רבה! נחזור אליכם בהקדם לתאם ${meeting.noun}.` : `תודה רבה! נחזור אליכם בהקדם.`;
  await sendToLead(conv, textPayload(thanks), thanks, key(n));
  await notifyOwner(conv.client_id, [`✅ ${await summaryLine(conv, lead)}`, meeting ? `${SCORE_LABEL[s]}. כדאי לחזור ולתאם ${meeting.noun}.` : `${SCORE_LABEL[s]}. כדאי לחזור אליו/ה בהקדם.`,
    meeting ? `כדי שהסוכן יקבע ${meeting.plural} בעצמו, כתוב למשל: זמינות א-ה 10:00-18:00` : ''].filter(Boolean).join('\n'), 'qualified:' + conv.id, { buttons: [{ title: 'אני ממשיך מכאן', text: '/lc-takeover ' + conv.lead_id }] });
}

async function bookedTimes(clientId) {
  return (await db.query("SELECT starts_at FROM lead_viewings WHERE client_id=$1 AND status='BOOKED' AND starts_at>NOW()", [clientId])).rows.map((r) => r.starts_at);
}

async function book(conv, lead, biz, startsAt, key, n) {
  if (!(startsAt instanceof Date) || Number.isNaN(startsAt.getTime()) || startsAt.getTime() < Date.now() + 30 * 60000) return askCurrent(conv, key, n, { repeat: true });
  const id = crypto.randomUUID();
  try {
    await db.query("INSERT INTO lead_viewings(id,client_id,lead_id,conversation_id,starts_at) VALUES($1,$2,$3,$4,$5)", [id, conv.client_id, conv.lead_id, conv.id, startsAt]);
  } catch {
    // Someone else just took this slot: offer fresh ones.
    const st = await settings(conv.client_id);
    const slots = freeSlots(st?.availability || [], st?.slot_minutes || 60, await bookedTimes(conv.client_id));
    if (!slots.length) return finishQualification({ ...conv, answers: conv.answers }, key, n);
    const nonce = crypto.randomBytes(12).toString('hex');
    const ui = { key: 'slot', nonce, body: 'המועד הזה נתפס הרגע. אלה המועדים הפנויים:', choices: [...slots.map((d) => ({ title: slotLabel(d), value: d.toISOString() })), { title: 'מועד אחר', value: 'OTHER' }] };
    return askCurrent(await update(conv, { ui }), key, n);
  }
  await update(conv, { status: 'BOOKED', ui: null, step: 'BOOKED' });
  const meeting = biz.profile.meeting || profiles.get('default').meeting;
  const when = slotLabel(startsAt).replace(' · ', ' בשעה ');
  const body = `מעולה! קבענו ${meeting.noun} ל${when}. נשלח תזכורת שעתיים לפני. אם משהו משתנה, פשוט כתבו כאן.`;
  await sendToLead(conv, textPayload(body), body, key(n));
  try { if (lead.version !== undefined) await require('./crmService').update(conv.client_id, conv.lead_id, { status: 'APPOINTMENT', version: Number(lead.version) }); } catch { /* moved elsewhere */ }
  await event(conv.client_id, conv.lead_id, 'VIEWING', 'BOOKED ' + startsAt.toISOString());
  await notifyOwner(conv.client_id, [`📅 ${meeting.booked}`, await summaryLine(conv, lead, startsAt), `${SCORE_LABEL[conv.score] || ''}`.trim(), 'כדאי לשלוח לליד את הכתובת המדויקת לפני המועד.'].filter(Boolean).join('\n'), 'booked:' + id, { buttons: [{ title: 'אני ממשיך מכאן', text: '/lc-takeover ' + conv.lead_id }] });
  return { viewingId: id };
}

// ---------- owner actions ----------
async function takeover(clientId, leadId) {
  if (!UUID.test(String(leadId || ''))) throw Error('INVALID_LEAD');
  const conv = (await db.query(`UPDATE lead_conversations SET status='OWNER',ui=NULL,handoff_reason='OWNER_TAKEOVER',updated_at=NOW()
    WHERE client_id=$1 AND lead_id=$2 AND status NOT IN ('OWNER','OPTED_OUT') RETURNING *`, [clientId, leadId])).rows[0];
  if (!conv) {
    const existing = (await db.query('SELECT status FROM lead_conversations WHERE client_id=$1 AND lead_id=$2', [clientId, leadId])).rows[0];
    return { status: existing ? 'ALREADY' : 'NOT_FOUND' };
  }
  await event(clientId, leadId, 'CONCIERGE', 'OWNER_TAKEOVER');
  // Tell the lead (only inside the 24h window) that the owner continues personally.
  const open = (await db.query("SELECT last_inbound_at>NOW()-INTERVAL '24 hours' AS open FROM whatsapp_contacts WHERE phone=$1", [conv.wa_phone])).rows[0]?.open;
  if (open && conv.status !== 'PENDING') {
    const biz = await business(clientId);
    const body = `מעכשיו נמשיך איתכם אישית. תודה על הסבלנות!`;
    await sendToLead(conv, textPayload(body), body, 'takeover:' + conv.id);
  }
  return { status: 'OWNER' };
}

async function setOutcome(clientId, viewingId, outcome) {
  if (!UUID.test(String(viewingId || '')) || !['ATTENDED', 'NO_SHOW', 'PROGRESSING'].includes(outcome)) throw Error('INVALID_VIEWING');
  const v = (await db.query("UPDATE lead_viewings SET status=$3,updated_at=NOW() WHERE client_id=$1 AND id=$2 AND status IN ('BOOKED','ATTENDED','NO_SHOW','PROGRESSING') RETURNING *", [clientId, viewingId, outcome])).rows[0];
  if (!v) return null;
  await event(clientId, v.lead_id, 'VIEWING', outcome);
  return v;
}

function optInText(profile) {
  const topics = profile.questions.slice(0, MAX_QUESTIONS).map((q) => ({ intent: 'קנייה או שכירות', budget: 'תקציב', area: 'אזור', timing: 'מתי', mortgage: 'משכנתא', need: 'מה צריך', product: 'איזה מוצר', quantity: 'כמות', delivery: 'משלוח', goal: 'מטרה', slot_pref: 'שעה נוחה' }[q.key] || q.key)).join(', ');
  return `שהסוכן יענה ראשון ללידים בשם ${profile.businessWord}?\nהוא ישלח לליד הודעה תוך דקות, ישאל עד ${MAX_QUESTIONS} שאלות קצרות (${topics})${profile.meeting ? ` ויקבע ${profile.meeting.noun} ביומן שלך` : ''}. אתה רואה כל הודעה ויכול להמשיך בעצמך בכל רגע.`;
}
async function askOptIn(clientId, key) {
  await db.query(`INSERT INTO lead_concierge_settings(client_id,asked_at) VALUES($1,NOW())
    ON CONFLICT(client_id) DO UPDATE SET asked_at=NOW()`, [clientId]);
  const biz = await business(clientId);
  return notifyOwner(clientId, optInText(biz.profile),
    'optin:' + key, { buttons: [{ title: 'כן, שיענה', text: '/lc-optin yes' }, { title: 'לא כרגע', text: '/lc-optin no' }], decisionKey: 'lead_concierge_optin' });
}

const OWNER_TEXT = /^(?:\/lc-|מענה אוטומטי ללידים|הפעל מענה ללידים|כבה מענה ללידים|הסוכן יענה ללידים|זמינות|הזמינות שלי|אני ממשיך מכאן|הגיע|לא הגיע|מתקדמים)/;
// Owner WhatsApp commands. Returns {reply, ui?} or null when the text is not ours.
async function handleOwnerText(from, text) {
  const t = String(text || '').trim();
  if (!OWNER_TEXT.test(t) || !db.configured()) return null;
  const clientId = (await db.query('SELECT id FROM clients WHERE phone=$1', [digits(from)])).rows[0]?.id;
  if (!clientId) return null;
  const store = require('./marketingStore');
  let m;
  if ((m = t.match(/^\/lc-takeover ([a-f0-9-]{36})$/i)) || t === 'אני ממשיך מכאן') {
    const leadId = m ? m[1] : (await store.load(clientId))?.leadConciergeLast;
    if (!leadId) return { reply: 'באיזה ליד? אפשר ללחוץ ״אני ממשיך מכאן״ בכרטיס הליד בדשבורד.' };
    const r = await takeover(clientId, leadId);
    return { reply: r.status === 'OWNER' ? 'סגור. הסוכן הפסיק לענות לליד הזה, ומעכשיו אתה ממשיך איתו. הודעות שהליד ישלח יועברו אליך.' : r.status === 'ALREADY' ? 'הליד הזה כבר אצלך 👍' : 'לא מצאתי שיחה של הסוכן עם הליד הזה.' };
  }
  if ((m = t.match(/^\/lc-outcome ([a-f0-9-]{36}) (ATTENDED|NO_SHOW|PROGRESSING)$/)) || /^(?:הגיע|לא הגיע|מתקדמים)$/.test(t)) {
    const viewingId = m ? m[1] : (await store.load(clientId))?.leadConciergeViewing;
    const outcome = m ? m[2] : t === 'הגיע' ? 'ATTENDED' : t === 'לא הגיע' ? 'NO_SHOW' : 'PROGRESSING';
    if (!viewingId) return null;
    const v = await setOutcome(clientId, viewingId, outcome);
    if (!v) return { reply: 'המועד הזה כבר לא פעיל.' };
    await store.update(clientId, null, (p) => { if (p.leadConciergeViewing === viewingId) { delete p.leadConciergeViewing; return { handled: false, changed: true }; } return { handled: false, changed: false }; });
    return { reply: outcome === 'PROGRESSING' ? 'מעולה! 💪 כשתסגרו, סמן ״נסגרה עסקה״ בליד, ככה אלמד אילו לידים הכי שווים.' : outcome === 'ATTENDED' ? 'נרשם שהליד הגיע לצפייה.' : 'נרשם שהליד לא הגיע. כדאי לנסות לתאם שוב.' };
  }
  if (t === '/lc-optin yes' || t === 'הפעל מענה ללידים' || t === 'הסוכן יענה ללידים') {
    if (!enabled()) return { reply: 'המענה האוטומטי ללידים עוד לא זמין בחשבון שלך. כרגע אשלח לך כל ליד עם הודעה מוכנה לשליחה בלחיצה.' };
    const s = await saveSettings(clientId, { enabled: true });
    const meeting = (await business(clientId)).profile.meeting;
    if (!meeting) return { reply: 'מעולה! מעכשיו הסוכן עונה ראשון לכל ליד מטופס Meta, ושואל עד 4 שאלות קצרות.\nלכיבוי כתוב: כבה מענה ללידים' };
    if (s.availability?.length) return { reply: `מעולה! מעכשיו הסוכן עונה ראשון לכל ליד מטופס Meta, ושואל עד 4 שאלות. ${meeting.plural} ייקבעו בזמינות: ${availabilityText(s.availability)}.\nלכיבוי כתוב: כבה מענה ללידים` };
    return { reply: `מעולה! מעכשיו הסוכן עונה ראשון לכל ליד מטופס Meta.\nבאילו ימים ושעות נוח לך ל${meeting.plural}? ככה הוא יקבע אותם בעצמו.`, buttons: [{ title: 'א׳–ה׳ 10:00–18:00', text: 'זמינות א-ה 10:00-18:00' }, { title: 'א׳–ה׳ 16:00–20:00', text: 'זמינות א-ה 16:00-20:00' }, { title: 'אכתוב בעצמי', text: '/lc-hours custom' }], decisionKey: 'lead_concierge_hours' };
  }
  if (t === '/lc-optin no' || t === 'כבה מענה ללידים') {
    await saveSettings(clientId, { enabled: false });
    return { reply: 'בסדר. אמשיך לשלוח לך כל ליד עם הודעה מוכנה לשליחה בלחיצה אחת. אפשר להפעיל בכל רגע: הפעל מענה ללידים' };
  }
  if (t === 'מענה אוטומטי ללידים') {
    const s = await settings(clientId), biz = await business(clientId);
    return { reply: optInText(biz.profile) + (s?.enabled ? '\n(כרגע: פועל)' : ''), buttons: [{ title: 'כן, שיענה', text: '/lc-optin yes' }, { title: 'לא כרגע', text: '/lc-optin no' }], decisionKey: 'lead_concierge_optin' };
  }
  if (t === '/lc-hours custom') return { reply: 'כתוב את הימים והשעות, למשל: זמינות א-ה 10:00-18:00' };
  if (t === 'הזמינות שלי') {
    const s = await settings(clientId);
    return { reply: s?.availability?.length ? `הזמינות שלך: ${availabilityText(s.availability)}` : 'עוד לא הוגדרה זמינות. כתוב למשל: זמינות א-ה 10:00-18:00' };
  }
  if ((m = t.match(/^זמינות(?: ל(?:צפיות|פגישות|תורים))?\s+(.+)$/))) {
    const availability = parseAvailability(m[1]);
    if (!availability && !/^זמינות ל(?:צפיות|פגישות|תורים)/.test(t)) return null;
    if (!availability) return { reply: 'לא הצלחתי להבין. כתוב למשל: זמינות א-ה 10:00-18:00' };
    await saveSettings(clientId, { availability });
    return { reply: `שמרתי. הסוכן יציע ללידים מועדים ב־${availabilityText(availability)}, שעה לכל מועד, בלי חפיפות.` };
  }
  return null;
}

// ---------- background ----------
async function runDue({ now = new Date() } = {}) {
  if (!db.configured()) return;
  // 1. First messages that could not go out: fall back to the owner alert.
  const failed = (await db.query(`SELECT c.*, o.status AS outbox_status FROM lead_conversations c JOIN whatsapp_outbox o ON o.id=c.first_outbox_id
    WHERE c.status='CONTACTED' AND c.created_at>NOW()-INTERVAL '2 days'
      AND (o.status IN ('FAILED','BLOCKED') OR (o.status='PENDING' AND o.created_at<NOW()-INTERVAL '15 minutes')) LIMIT 20`)).rows;
  for (const conv of failed) {
    if (conv.outbox_status === 'PENDING') await db.query("UPDATE whatsapp_outbox SET status='BLOCKED',error_code='CONCIERGE_FALLBACK',payload='{}'::jsonb WHERE id=$1 AND status='PENDING'", [conv.first_outbox_id]);
    const reason = 'SEND_' + conv.outbox_status;
    const moved = (await db.query("UPDATE lead_conversations SET status='FALLBACK',fallback_reason=$2,ui=NULL,updated_at=NOW() WHERE id=$1 AND status='CONTACTED' RETURNING id", [conv.id, reason])).rows.length;
    if (!moved) continue;
    const lead = await leadRow(conv);
    await event(conv.client_id, conv.lead_id, 'CONCIERGE_FALLBACK', reason);
    await require('./leadAlert').notifyOwner(conv.client_id, lead, {});
  }
  // 2. Reminders 2 hours before a viewing.
  const due = (await db.query(`SELECT v.*, c.wa_phone, c.status AS conv_status FROM lead_viewings v JOIN lead_conversations c ON c.id=v.conversation_id
    WHERE v.status='BOOKED' AND v.reminder_status IS NULL AND v.starts_at>$1 AND v.starts_at<=$1::timestamptz+INTERVAL '2 hours' LIMIT 50`, [now])).rows;
  for (const v of due) {
    const conv = (await db.query('SELECT * FROM lead_conversations WHERE id=$1', [v.conversation_id])).rows[0];
    let status;
    if (['OWNER', 'OPTED_OUT'].includes(conv.status)) status = 'SKIPPED_' + conv.status;
    else {
      const biz = await business(v.client_id, conv.vertical);
      const time = `${pad(localParts(new Date(v.starts_at)).h)}:${pad(localParts(new Date(v.starts_at)).mi)}`;
      const open = (await db.query("SELECT last_inbound_at>NOW()-INTERVAL '23 hours' AS open FROM whatsapp_contacts WHERE phone=$1", [conv.wa_phone])).rows[0]?.open;
      const params = [clean(biz.name, 60), time];
      const body = render(REMINDER_TEXT, params);
      const config = templateConfig(process.env.WA_TEMPLATE_VIEWING_REMINDER);
      if (open) status = (await sendToLead(conv, textPayload(body), body, 'reminder:' + v.id)).queued ? 'SENT_TEXT' : 'SKIPPED';
      else if (config.name) status = (await sendToLead(conv, templatePayload(config, params), body, 'reminder:' + v.id)).queued ? 'SENT_TEMPLATE' : 'SKIPPED';
      else status = 'SKIPPED_NO_TEMPLATE';
      if (status === 'SKIPPED_NO_TEMPLATE') {
        const lead = await leadRow(conv);
        await notifyOwner(v.client_id, `⏰ בעוד פחות משעתיים: ${biz.profile.meeting?.noun || 'פגישה'} עם ${clean(lead.name, 40)}. לא יכולתי לשלוח לליד תזכורת אוטומטית, כדאי להתקשר לוודא שמגיעים.`, 'reminder-owner:' + v.id);
      }
    }
    await db.query('UPDATE lead_viewings SET reminder_status=$2,updated_at=NOW() WHERE id=$1 AND reminder_status IS NULL', [v.id, status]);
  }
  // 3. One hour after a viewing: ask the owner how it went.
  const past = (await db.query(`SELECT v.* FROM lead_viewings v WHERE v.status='BOOKED' AND v.outcome_asked_at IS NULL
    AND v.starts_at<$1::timestamptz-INTERVAL '1 hour' AND v.starts_at>$1::timestamptz-INTERVAL '3 days' ORDER BY v.starts_at LIMIT 20`, [now])).rows;
  for (const v of past) {
    const claimed = (await db.query('UPDATE lead_viewings SET outcome_asked_at=NOW() WHERE id=$1 AND outcome_asked_at IS NULL RETURNING id', [v.id])).rows.length;
    if (!claimed) continue;
    const lead = (await db.query('SELECT name FROM crm_leads WHERE id=$1 AND client_id=$2', [v.lead_id, v.client_id])).rows[0];
    const vertical = (await db.query('SELECT vertical FROM lead_conversations WHERE id=$1', [v.conversation_id])).rows[0]?.vertical;
    const noun = profiles.get(vertical).meeting?.noun || 'פגישה';
    await require('./marketingStore').update(v.client_id, null, (p) => { p.leadConciergeViewing = v.id; return { handled: false, changed: true }; });
    await notifyOwner(v.client_id, `${noun} עם ${clean(lead?.name, 40) || 'הליד'} ${shortWhen(new Date(v.starts_at))}: איך היה?`, 'outcome:' + v.id, {
      buttons: [{ title: 'הגיע', text: `/lc-outcome ${v.id} ATTENDED` }, { title: 'לא הגיע', text: `/lc-outcome ${v.id} NO_SHOW` }, { title: 'מתקדמים', text: `/lc-outcome ${v.id} PROGRESSING` }],
      decisionKey: 'lead_viewing_outcome'
    });
  }
}

// ---------- dashboard ----------
async function overview(clientId) {
  const s = await settings(clientId);
  const biz = await business(clientId);
  const convs = (await db.query(`SELECT c.lead_id,c.vertical,c.status,c.answers,c.score,c.handoff_reason,c.fallback_reason,c.updated_at,
      (SELECT json_build_object('id',v.id,'starts_at',v.starts_at,'status',v.status) FROM lead_viewings v WHERE v.conversation_id=c.id ORDER BY v.created_at DESC LIMIT 1) AS viewing,
      (SELECT COUNT(*)::int FROM lead_messages m WHERE m.conversation_id=c.id) AS messages
    FROM lead_conversations c WHERE c.client_id=$1 ORDER BY c.created_at DESC LIMIT 500`, [clientId])).rows;
  return {
    available: enabled(),
    vertical: biz.vertical, verticals: profiles.KEYS.map((k) => ({ key: k, label: profiles.PROFILES[k].label })), meeting: biz.profile.meeting,
    settings: { enabled: !!s?.enabled, decided: !!s?.decided_at, availability: s?.availability || [], availabilityText: availabilityText(s?.availability || []), slotMinutes: s?.slot_minutes || 60 },
    conversations: convs.map((c) => ({ ...c, viewingLabel: c.viewing ? slotLabel(new Date(c.viewing.starts_at)) : null }))
  };
}
async function transcript(clientId, leadId) {
  if (!UUID.test(String(leadId || ''))) throw Error('INVALID_LEAD');
  const conv = (await db.query('SELECT id,status,answers,score,handoff_reason FROM lead_conversations WHERE client_id=$1 AND lead_id=$2', [clientId, leadId])).rows[0];
  if (!conv) return { conversation: null, messages: [] };
  const messages = (await db.query('SELECT direction,body,created_at FROM lead_messages WHERE client_id=$1 AND conversation_id=$2 ORDER BY id LIMIT 300', [clientId, conv.id])).rows;
  return { conversation: { status: conv.status, answers: conv.answers, score: conv.score, handoffReason: conv.handoff_reason }, messages };
}

module.exports = {
  enabled, settings, saveSettings, onNewLead, firstContact, routeInbound, handleLeadMessage, handleOwnerText,
  takeover, setOutcome, askOptIn, runDue, overview, transcript, notifyOwner,
  nextQuestion, matchAnswer, score, parseAvailability, availabilityText, freeSlots, slotLabel, zonedToUtc, localParts,
  propertySubject, templateConfig, summaryLine, FIRST_CONTACT_TEXT, REMINDER_TEXT, OPT_OUT, DISTRESS, OWNER_KEYS
};
