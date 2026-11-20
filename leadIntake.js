'use strict';
// Every way a lead reaches the business, into the same CRM, each lead carrying where it
// came from (campaign / ad / catalog item / UTM):
//   * landing pages (landingPages.js) and the existing custom pages;
//   * the owner forwarding a lead to the agent in WhatsApp ("ליד חדש: דנה 050…, מיד2");
//   * an authenticated webhook URL per business, for website forms and Zapier;
//   * prepared, not enabled: Instagram / Messenger direct messages (SOCIAL_DM_LEADS_ENABLED).
const crypto = require('node:crypto');
const db = require('./db');
const { logger } = require('./logger');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS = /^\d{1,40}$/;
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const text = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

// UTM and click ids from a page URL or a webhook payload. Browser ids only with consent.
function attribution(input = {}, { consent = false } = {}) {
  const utm = {};
  for (const k of ['source', 'medium', 'campaign', 'content', 'term']) { const v = text(input['utm_' + k] ?? input.utm?.[k], 100); if (v) utm[k] = v; }
  const fbclid = text(input.fbclid ?? input.utm?.fbclid, 500);
  if (fbclid && /^[A-Za-z0-9_-]+$/.test(fbclid)) utm.fbclid = fbclid;
  if (consent) {
    const fbp = text(input.fbp, 100), fbc = text(input.fbc, 600) || (utm.fbclid ? `fb.1.${Date.now()}.${utm.fbclid}` : '');
    if (/^fb\.\d\.\d{10,16}\.\d{1,20}$/.test(fbp)) utm.fbp = fbp;
    if (/^fb\.\d\.\d{10,16}\.[A-Za-z0-9_-]{1,500}$/.test(fbc)) utm.fbc = fbc;
  }
  // Meta dynamic URL parameters: utm_campaign={{campaign.id}}&utm_content={{ad.id}}.
  const campaignId = [input.campaign_id, input.campaignId, utm.campaign].map((v) => text(v, 40)).find((v) => DIGITS.test(v)) || null;
  const adId = [input.ad_id, input.adId, utm.content].map((v) => text(v, 40)).find((v) => DIGITS.test(v)) || null;
  return { utm: Object.keys(utm).length ? utm : null, campaignId, adId };
}

// Saves one lead and its attribution. Returns the lead row, or {duplicate:true}.
async function saveLead(clientId, lead, { catalogItemId = null, adId = null, utm = null, landingPageId = null, measurementConsent = false, capi = null, alert = true } = {}) {
  const crm = require('./crmService');
  const saved = await crm.create(clientId, lead);
  if (!saved?.id) return saved;
  let item = null;
  if (catalogItemId && UUID.test(catalogItemId)) item = (await db.query('SELECT id FROM catalog_items WHERE client_id=$1 AND id=$2', [clientId, catalogItemId])).rows[0]?.id || null;
  const row = (await db.query(`UPDATE crm_leads SET catalog_item_id=COALESCE($3,catalog_item_id),ad_id=$4,utm=$5::jsonb,landing_page_id=$6,measurement_consent=$7,updated_at=NOW()
    WHERE client_id=$1 AND id=$2 RETURNING *`, [clientId, saved.id, item, adId && DIGITS.test(adId) ? adId : null, utm ? JSON.stringify(utm) : null, landingPageId, measurementConsent === true])).rows[0];
  if (capi && row.measurement_consent) await require('./metaCrmFeedback').enqueueWebLead(row, { ...capi, fbp: utm?.fbp, fbc: utm?.fbc }).catch((e) => logger.warn('Lead conversion not queued', { error: /^[A-Z_]+$/.test(e.message) ? e.message : 'CAPI_QUEUE_FAILED' }));
  // Speed to lead: alert the owner right away, without slowing the caller (never throws).
  if (alert) setImmediate(() => require('./leadAlert').notifyOwner(clientId, row).catch(() => {}));
  return row;
}

// ---------- Webhook per business (website forms, Zapier) ----------
async function rotateWebhook(clientId) {
  const secret = crypto.randomBytes(24).toString('base64url');
  const id = 'wh' + crypto.randomBytes(12).toString('hex');
  const r = await db.query(`INSERT INTO business_channels(client_id,webhook_id,webhook_secret_hash,webhook_rotated_at) VALUES($1,$2,$3,NOW())
    ON CONFLICT(client_id) DO UPDATE SET webhook_id=COALESCE(business_channels.webhook_id,$2),webhook_secret_hash=$3,webhook_rotated_at=NOW(),updated_at=NOW() RETURNING webhook_id`, [clientId, id, sha(secret)]);
  await db.query("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'LEAD_WEBHOOK','ROTATED')", [clientId]);
  return { url: require('./portalStore').origin() + '/hooks/leads/' + r.rows[0].webhook_id, secret };
}
async function webhookInfo(clientId) {
  const r = (await db.query('SELECT webhook_id,webhook_rotated_at FROM business_channels WHERE client_id=$1 AND webhook_secret_hash IS NOT NULL', [clientId])).rows[0];
  return r ? { url: require('./portalStore').origin() + '/hooks/leads/' + r.webhook_id, rotatedAt: r.webhook_rotated_at } : null;
}
async function authenticate(webhookId, secret) {
  if (!/^wh[a-f0-9]{24}$/.test(String(webhookId || '')) || typeof secret !== 'string' || secret.length < 20 || secret.length > 200) return null;
  const r = (await db.query('SELECT client_id,webhook_secret_hash FROM business_channels WHERE webhook_id=$1', [webhookId])).rows[0];
  if (!r?.webhook_secret_hash) return null;
  const a = Buffer.from(sha(secret), 'hex'), b = Buffer.from(r.webhook_secret_hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? r.client_id : null;
}
const pick = (body, keys, max) => { for (const k of keys) { const v = text(body?.[k], max); if (v) return v; } return ''; };
// A website form or Zapier sends JSON or form fields; common names in English and Hebrew.
async function fromWebhook(clientId, body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('INVALID_LEAD');
  const consent = body.consent_measurement === true || body.consent_measurement === 'true';
  const a = attribution(body, { consent });
  const phone = pick(body, ['phone', 'phone_number', 'tel', 'mobile', 'טלפון'], 30), email = pick(body, ['email', 'mail', 'אימייל', 'דוא"ל'], 254);
  const eventId = pick(body, ['event_id', 'id', 'submission_id'], 200);
  const item = pick(body, ['item', 'catalog_item_id', 'item_id'], 36);
  const label = pick(body, ['source', 'form', 'form_name'], 60).replace(/[^\p{L}\p{N} _.-]/gu, '');
  return saveLead(clientId, {
    name: pick(body, ['name', 'full_name', 'fullname', 'first_name', 'שם', 'שם מלא'], 120) || 'ליד מהאתר',
    phone: phone || null, email: email || null,
    note: pick(body, ['message', 'note', 'notes', 'comments', 'הודעה', 'הערות'], 2000),
    source: 'webhook' + (label ? ':' + label : ''),
    sourceEventId: eventId ? 'wh:' + eventId : null,
    campaignId: a.campaignId
  }, { catalogItemId: item, adId: a.adId, utm: a.utm, measurementConsent: consent, capi: consent && eventId ? { eventId: /^[A-Za-z0-9:_-]{8,80}$/.test(eventId) ? eventId : 'wh_' + sha(eventId).slice(0, 40) } : null });
}

// ---------- The owner forwards a lead in WhatsApp ----------
const FORWARD = /^(?:ליד חדש|ליד|לקוח חדש|לקוחה חדשה|פנייה חדשה|פניה חדשה)\s*[:：\-–]\s*([\s\S]{3,1500})$/;
const PHONE = /(?:\+?972[\s-]?|0)(?:[23489]|5\d|7\d)[\s-]?\d{3}[\s-]?\d{4}\b/;
const EMAIL = /[^\s@,;:()<>]+@[^\s@,;:()<>]+\.[A-Za-z]{2,}/;
const SOURCES = [[/יד\s?2|yad\s?2/i, 'yad2', 'יד2'], [/מדלן|madlan/i, 'madlan', 'מדלן'], [/פייסבוק|facebook/i, 'facebook', 'פייסבוק'], [/אינסטגרם|instagram/i, 'instagram', 'אינסטגרם'],
  [/טיקטוק|tiktok/i, 'tiktok', 'טיקטוק'], [/גוגל|google/i, 'google', 'גוגל'], [/המלצה|ממליץ|הומלץ|חבר של/, 'referral', 'המלצה'], [/שלט/, 'sign', 'שלט'], [/מהאתר|באתר|אתר/, 'website', 'האתר'], [/שיחה|התקשר|טלפון/, 'phone', 'שיחת טלפון']];
const STOP = new Set(['ליד', 'חדש', 'חדשה', 'שם', 'טלפון', 'מספר', 'מקור', 'מ', 'של', 'על', 'רוצה', 'מחפש', 'מחפשת', 'מתעניין', 'מתעניינת', 'דירה', 'נכס']);

function parseForward(t) {
  const m = String(t || '').trim().match(FORWARD);
  if (!m) return null;
  const body = m[1].replace(/\s+/g, ' ').trim();
  const phone = body.match(PHONE)?.[0].replace(/[\s-]/g, '') || null;
  const email = body.match(EMAIL)?.[0] || null;
  const source = SOURCES.find(([re]) => re.test(body));
  const before = body.split(PHONE)[0].split(EMAIL)[0];
  const words = before.replace(/^(?:שם|השם)\s*[:：]?\s*/, '').split(/[,،;\n|]/)[0].trim().split(' ')
    .filter((w) => w && !STOP.has(w) && !/\d/.test(w) && !/^מ(?:יד|מדלן|פייסבוק|אינסטגרם|האתר)/.test(w)).slice(0, 3);
  const name = words.join(' ').replace(/[^\p{L}\s'"׳״-]/gu, '').trim().slice(0, 80);
  return { name: name.length >= 2 ? name : null, phone, email, source: source ? { key: source[1], label: source[2] } : null, text: body };
}
// A catalog item the owner named (its title, or two of its distinctive words).
async function matchItem(clientId, body) {
  const items = (await db.query("SELECT id,title FROM catalog_items WHERE client_id=$1 AND status IN ('ACTIVE','PAUSED') ORDER BY updated_at DESC LIMIT 200", [clientId])).rows;
  const hits = items.filter((i) => {
    if (!i.title) return false;
    if (body.includes(i.title)) return true;
    const words = i.title.split(/[\s,]+/).filter((w) => w.length >= 3 && !/^(?:דירת|דירה|חדרים|למכירה|להשכרה)$/.test(w));
    return words.length >= 2 && words.filter((w) => body.includes(w)).length >= 2;
  });
  return hits.length === 1 ? hits[0] : null;
}
async function handleForward(clientId, t, { eventId } = {}) {
  const p = parseForward(t);
  if (!p) return null;
  if (!p.phone && !p.email) return { reply: 'לא מצאתי טלפון או אימייל בליד. תשלח שוב עם מספר, למשל:\nליד חדש: דנה 050-1234567, מיד2, דירת 4 חדרים ברמת גן' };
  const item = await matchItem(clientId, p.text);
  const key = 'wa:' + sha(String(clientId) + ':' + (eventId || p.text + ':' + new Date().toISOString().slice(0, 10))).slice(0, 40);
  const saved = await saveLead(clientId, {
    name: p.name || 'ליד מוואטסאפ', phone: p.phone, email: p.email, note: p.text.slice(0, 2000),
    source: 'whatsapp_forward' + (p.source ? ':' + p.source.key : ''), sourceEventId: key
  }, { catalogItemId: item?.id || null, alert: false });
  if (saved.duplicate) return { reply: 'הליד הזה כבר רשום אצלי ✓' };
  return {
    reply: ['✅ רשמתי ליד חדש:', `👤 ${p.name || 'בלי שם'}`, p.phone ? `📞 ${p.phone}` : '', p.email ? `✉️ ${p.email}` : '', p.source ? `📍 מקור: ${p.source.label}` : '📍 מקור: לא צוין', item ? `🏷️ ${item.title}` : '',
      '', 'הוא מופיע בדשבורד ב"כל הלידים". כשתתקדם איתו, עדכן את השלב שם.'].filter((x) => x !== '').join('\n'),
    leadId: saved.id
  };
}

// ---------- Prepared, not enabled: Instagram / Messenger direct messages as leads ----------
// Needs SOCIAL_DM_LEADS_ENABLED=true, the app's messaging webhook, and the permissions
// instagram_manage_messages (Instagram) / pages_messaging (Messenger) granted in App Review.
// Only a message that includes a phone number or email becomes a lead.
const DM_PERMISSIONS = { instagram: ['instagram_basic', 'instagram_manage_messages', 'pages_manage_metadata'], messenger: ['pages_messaging', 'pages_manage_metadata'] };
const dmEnabled = () => process.env.SOCIAL_DM_LEADS_ENABLED === 'true';
function parseMessagingWebhook(body) {
  const platform = body?.object === 'instagram' ? 'instagram' : body?.object === 'page' ? 'messenger' : null;
  if (!platform) return [];
  const out = [];
  for (const entry of body.entry || []) for (const m of entry.messaging || []) {
    if (!m?.message || m.message.is_echo || typeof m.message.text !== 'string') continue;
    const recipient = String(m.recipient?.id || ''), sender = String(m.sender?.id || ''), mid = String(m.message.mid || '');
    if (!/^\d{1,40}$/.test(recipient) || !/^\d{1,40}$/.test(sender) || !mid || mid.length > 300) continue;
    out.push({ platform, accountId: recipient, senderId: sender, mid, text: m.message.text.slice(0, 2000) });
  }
  return out;
}
async function ingestDm(event) {
  if (!dmEnabled()) return { status: 'DISABLED' };
  const provider = event.platform === 'instagram' ? 'instagram' : 'facebook';
  const owner = (await db.query('SELECT client_id FROM social_connections WHERE provider=$1 AND external_id=$2 AND token_ciphertext IS NOT NULL', [provider, event.accountId])).rows;
  if (owner.length !== 1) return { status: 'UNKNOWN_ACCOUNT' };
  const phone = event.text.match(PHONE)?.[0].replace(/[\s-]/g, '') || null, email = event.text.match(EMAIL)?.[0] || null;
  if (!phone && !email) return { status: 'NO_CONTACT' };
  const saved = await saveLead(owner[0].client_id, { name: event.platform === 'instagram' ? 'פנייה מאינסטגרם' : 'פנייה ממסנג׳ר', phone, email, note: event.text, source: event.platform + '_dm', sourceEventId: 'dm:' + event.mid.slice(0, 190) });
  return { status: saved.duplicate ? 'DUPLICATE' : 'CREATED', leadId: saved.id || null, clientId: owner[0].client_id };
}

module.exports = { attribution, saveLead, rotateWebhook, webhookInfo, authenticate, fromWebhook, parseForward, matchItem, handleForward, DM_PERMISSIONS, dmEnabled, parseMessagingWebhook, ingestDm };
