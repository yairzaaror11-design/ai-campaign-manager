'use strict';
// Buyer-based audiences. Customers the owner marked as a closed sale (CRM WON)
// become a Meta Custom Audience ("SCORPIO — לקוחות קיימים"): new lead campaigns
// exclude it, and it can seed a 1% lookalike. Only SHA-256 hashes of normalized
// phone numbers ever leave the system, and nothing is written to Meta without the
// owner's explicit approval through the regular approval engine.
const crypto = require('node:crypto');
const db = require('./db');
const { logger } = require('./logger');

const enabled = () => process.env.BUYER_AUDIENCES_ENABLED === 'true';
const AUDIENCE_NAME = 'SCORPIO — לקוחות קיימים';
const LOOKALIKE_NAME = 'SCORPIO — דומים ללקוחות (1%)';
const INTENTS = ['SYNC_BUYER_AUDIENCE', 'CREATE_LOOKALIKE'];
const RULES = { lookalikeMin: 100, offerEveryDays: 7, batch: 10000, maxBuyers: 500000, snapshotDays: 2 };
const LOOKALIKE_LINE = 'קהל דומים = Meta מוצאת בישראל את האנשים שהכי דומים ללקוחות שכבר קנו ממך, כדי שהמודעות יגיעו למי שיש לו סיכוי גבוה לקנות.';
const PRIVACY_LINE = '🔒 ל־Meta נשלחים רק מספרי טלפון מוצפנים (SHA-256). לא שמות ולא מספרים גלויים.';

// Meta: digits only, country code first, no leading zeros. Local Israeli numbers get 972.
function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (/^0\d{8,9}$/.test(d)) d = '972' + d.slice(1);
  else if (/^9720\d{8,9}$/.test(d)) d = '972' + d.slice(4);
  d = d.replace(/^0+/, '');
  return /^[1-9]\d{7,14}$/.test(d) ? d : null;
}
const hashPhone = (digits) => crypto.createHash('sha256').update(digits).digest('hex');
const digestOf = (hashes) => crypto.createHash('sha256').update(hashes.join('\n')).digest('hex');

// Sorted, de-duplicated hashes of every buyer's phone. Raw numbers never leave this function.
async function buyerHashes(clientId) {
  const rows = (await db.query("SELECT phone FROM crm_leads WHERE client_id=$1 AND status='WON' AND phone IS NOT NULL LIMIT $2", [clientId, RULES.maxBuyers])).rows;
  const set = new Set();
  for (const r of rows) { const d = normalizePhone(r.phone); if (d) set.add(hashPhone(d)); }
  return [...set].sort();
}

// What Meta already has, from the last verified approved actions on this ad account.
async function current(clientId, accountId) {
  const last = async (intent) => (await db.query(`SELECT payload,execution_result,updated_at FROM action_plans
    WHERE client_id=$1 AND account_id=$2 AND intent=$3 AND status='VERIFIED' ORDER BY updated_at DESC LIMIT 1`, [clientId, accountId, intent])).rows[0];
  const sync = await last('SYNC_BUYER_AUDIENCE'), look = await last('CREATE_LOOKALIKE');
  const audienceId = sync?.execution_result?.objects?.audienceId || sync?.execution_result?.id || null;
  return {
    audienceId: /^\d+$/.test(String(audienceId || '')) ? String(audienceId) : null,
    buyerCount: sync ? Number(sync.payload.parameters.buyerCount) : 0,
    digest: sync?.payload.parameters.digest || null,
    refreshedAt: sync?.updated_at || null,
    lookalikeId: look && look.payload.parameters.originAudienceId === audienceId ? String(look.execution_result?.id || '') || null : null
  };
}

async function connection(clientId) {
  const c = await require('./metaConnection').credentials(clientId);
  if (!/^act_\d+$/.test(c.meta_ad_account_id || '')) throw Error('META_ACCOUNT_REQUIRED');
  return c;
}
const tosLink = (accountId) => 'https://business.facebook.com/ads/manage/customaudiences/tos/?act=' + String(accountId).replace(/^act_/, '');
const tosMessage = (accountId) => '✋ כדי ליצור קהל מרשימת לקוחות, Meta דורשת לאשר פעם אחת את "תנאי השימוש לקהלים מותאמים אישית" (Custom Audience Terms).\n' +
  'זה לוקח דקה: פותחים את הקישור, מתחברים עם חשבון הפייסבוק של העסק ולוחצים "אישור":\n' + tosLink(accountId) +
  '\nאחרי שאישרת, כתוב לי "קהל לקוחות" ונמשיך. לא נשלח שום דבר ל־Meta.';
async function tosAccepted(c) {
  const r = await require('./metaConnection').graph('/' + c.meta_ad_account_id, c.token, { fields: 'tos_accepted' });
  return Number(r?.tos_accepted?.custom_audience_tos) === 1;
}
// Meta's estimate of matched people (approximate lower bound); null when unknown.
async function matched(c, audienceId) {
  if (!audienceId) return null;
  try {
    const a = await require('./metaConnection').graph('/' + audienceId, c.token, { fields: 'account_id,approximate_count_lower_bound,operation_status' });
    if ('act_' + a.account_id !== c.meta_ad_account_id) return null;
    const n = Number(a.approximate_count_lower_bound);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch { return null; }
}

// Prepare (never execute) the approval that creates or refreshes the buyers audience.
async function prepareSync(clientId, { approve } = {}) {
  const c = await connection(clientId), accountId = c.meta_ad_account_id;
  const hashes = await buyerHashes(clientId);
  if (!hashes.length) return { reason: 'NO_BUYERS' };
  if (!await tosAccepted(c)) return { reason: 'TOS_REQUIRED', reply: tosMessage(accountId) };
  const now = await current(clientId, accountId), digest = digestOf(hashes);
  if (now.audienceId && now.digest === digest) return { reason: 'UP_TO_DATE', state: now };
  const snapshotId = crypto.randomUUID();
  await db.query('INSERT INTO buyer_audience_snapshots(id,client_id,ad_account_id,hashes,digest,buyer_count) VALUES($1,$2,$3,$4,$5,$6)', [snapshotId, clientId, accountId, hashes, digest, hashes.length]);
  const { createActionPlan } = require('./actionPlan');
  const plan = createActionPlan({
    intent: 'SYNC_BUYER_AUDIENCE',
    summary: now.audienceId ? 'רענון קהל הלקוחות הקיימים ב־Meta לפי ה־CRM' : 'יצירת קהל של הלקוחות הקיימים שלך ב־Meta, מתוך ה־CRM',
    target: { accountId },
    parameters: { name: AUDIENCE_NAME, snapshotId, digest, buyerCount: hashes.length, ...(now.audienceId ? { audienceId: now.audienceId } : {}) }
  });
  return { approval: await (approve || require('./approvalEngine').createApprovalForClient)(clientId, plan) };
}

async function prepareLookalike(clientId, { approve } = {}) {
  const c = await connection(clientId), now = await current(clientId, c.meta_ad_account_id);
  if (!now.audienceId) return { reason: 'NO_AUDIENCE' };
  if (now.lookalikeId) return { reason: 'LOOKALIKE_EXISTS' };
  const size = await matched(c, now.audienceId);
  if (!(size >= RULES.lookalikeMin)) return { reason: 'TOO_SMALL', size };
  const { createActionPlan } = require('./actionPlan');
  const plan = createActionPlan({ intent: 'CREATE_LOOKALIKE', summary: 'יצירת קהל של אנשים שדומים ללקוחות שכבר קנו ממך, בישראל', target: { accountId: c.meta_ad_account_id }, parameters: { name: LOOKALIKE_NAME, originAudienceId: now.audienceId } });
  return { approval: await (approve || require('./approvalEngine').createApprovalForClient)(clientId, plan) };
}

// Executed only inside an approved, permitted Meta write: the exact hashed list the owner approved.
async function approvedHashes(clientId, plan) {
  const p = plan.parameters;
  const row = (await db.query('SELECT hashes,digest,buyer_count FROM buyer_audience_snapshots WHERE id=$1 AND client_id=$2 AND ad_account_id=$3', [p.snapshotId, clientId, plan.target.accountId])).rows[0];
  if (!row || row.digest !== p.digest || row.buyer_count !== p.buyerCount || row.hashes.length !== p.buyerCount || digestOf(row.hashes) !== p.digest || row.hashes.some((h) => !/^[a-f0-9]{64}$/.test(h))) throw Error('AUDIENCE_SNAPSHOT_MISMATCH');
  return row.hashes;
}

// New lead campaigns never pay to reach people who already bought.
async function applyExclusion(clientId, plan, accountId) {
  if (!enabled() || !['CREATE_BUNDLE', 'CREATE_ADSET'].includes(plan.intent)) return false;
  try {
    const { audienceId } = await current(clientId, accountId);
    if (!audienceId) return false;
    const sets = plan.intent === 'CREATE_BUNDLE' ? plan.parameters.adSets || [] : [plan.parameters];
    for (const set of sets) {
      if (!set?.targeting || typeof set.targeting !== 'object') continue;
      const list = Array.isArray(set.targeting.excluded_custom_audiences) ? set.targeting.excluded_custom_audiences : [];
      if (!list.some((x) => String(x?.id ?? x) === audienceId)) set.targeting.excluded_custom_audiences = [...list, { id: audienceId }];
    }
    return true;
  } catch (error) {
    logger.warn('Buyer exclusion skipped', { error: /^[A-Z_]+$/.test(error?.message || '') ? error.message : 'BUYER_EXCLUSION_FAILED' });
    return false;
  }
}
const excludesBuyers = (plan) => (plan.parameters?.adSets || [plan.parameters]).some((s) => s?.targeting?.excluded_custom_audiences?.length);

function when(v) { return v ? new Date(v).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: 'numeric' }) : null; }
const choice = (title, text) => ({ title, text });

// "קהל לקוחות": status in plain Hebrew plus the next sensible step as buttons.
async function status(clientId) {
  let c;
  try { c = await connection(clientId); } catch { return { text: '👥 קהל לקוחות: כדי ליצור קהל ב־Meta צריך קודם לחבר חשבון פרסום. כתוב "חיבור למטא" ונתחיל.', items: [] }; }
  const hashes = await buyerHashes(clientId), now = await current(clientId, c.meta_ad_account_id);
  const size = await matched(c, now.audienceId), lines = ['👥 *קהל הלקוחות הקיימים שלך*'];
  lines.push('ב־CRM: ' + hashes.length + ' לקוחות שסגרו עסקה (עם מספר טלפון).');
  if (now.audienceId) lines.push('ב־Meta: עודכן לאחרונה ב־' + when(now.refreshedAt) + ' עם ' + now.buyerCount + ' לקוחות' + (size !== null ? ' · Meta זיהתה כ־' + size + ' אנשים' : '') + '.');
  else lines.push('ב־Meta: עדיין לא נוצר.');
  lines.push('מה זה נותן: לא נפרסם למי שכבר קנה (חוסך תקציב), ואפשר למצוא אנשים שדומים ללקוחות שלך.');
  lines.push(PRIVACY_LINE);
  const items = [], changed = hashes.length && digestOf(hashes) !== now.digest;
  if (!hashes.length) lines.push('\nכדי להתחיל, סמן ב־CRM פניות שנסגרו כ"נסגרה עסקה".');
  else if (!now.audienceId) items.push(choice('ליצור קהל לקוחות', '/buyers-sync'));
  else if (changed) { lines.push('\nיש לקוחות חדשים מאז העדכון האחרון.'); items.push(choice('לרענן את הקהל', '/buyers-sync')); }
  if (now.audienceId && !now.lookalikeId && size >= RULES.lookalikeMin) { lines.push('\n' + LOOKALIKE_LINE); items.push(choice('ליצור קהל דומים', '/buyers-lookalike')); }
  else if (now.audienceId && !now.lookalikeId && size !== null) lines.push('\nקהל דומה (Lookalike) יהיה זמין כש־Meta תזהה לפחות ' + RULES.lookalikeMin + ' לקוחות.');
  else if (now.lookalikeId) lines.push('✅ קהל הדומים ללקוחות שלך כבר קיים בחשבון.');
  if (items.length) items.push(choice('לא עכשיו', '/buyers-later'));
  return { text: lines.join('\n'), items };
}

async function ownerBusy(clientId) {
  const task = await require('./taskAgent').active(clientId).catch(() => null);
  return !!task?.state?.steps?.some((s) => s.status === 'WAITING_APPROVAL');
}
async function sendStatus(clientId, phone, intro = '') {
  const s = await status(clientId), text = (intro ? intro + '\n\n' : '') + s.text;
  const ui = s.items.length ? await require('./conversationUi').prepareChoices(clientId, text, s.items, 'guard_alert') : { text };
  await require('./whatsapp').safeSend(phone, ui.text, ui);
  return s;
}
const reasonText = {
  NO_BUYERS: 'עוד אין לקוחות שסומנו "נסגרה עסקה" עם מספר טלפון ב־CRM. כשיהיו, נוכל ליצור את הקהל.',
  UP_TO_DATE: 'הקהל ב־Meta כבר מעודכן עם כל הלקוחות שלך ✅',
  NO_AUDIENCE: 'קודם ניצור את קהל הלקוחות הקיימים, ורק אחרי זה קהל דומה.',
  LOOKALIKE_EXISTS: 'קהל הדומים ללקוחות שלך כבר קיים בחשבון ✅',
  TOO_SMALL: 'Meta צריכה לזהות לפחות ' + RULES.lookalikeMin + ' לקוחות כדי לבנות קהל דומה. נחזור לזה כשהרשימה תגדל.'
};

// WhatsApp: "קהל לקוחות" and its buttons. Returns true when handled.
async function handleText(from, text, { approve } = {}) {
  const t = String(text || '').trim();
  const command = /^\/buyers-(status|sync|lookalike|later)$/.exec(t)?.[1] || (/^(?:קהל ה?לקוחות(?: ה?קיימים)?)[?!.]*$/.test(t) ? 'status' : null);
  if (!command || !enabled() || !db.configured()) return false;
  const client = await require('./clientStore').getOrCreateClient(from);
  const say = (m, ui) => require('./whatsapp').safeSend(from, m, ui);
  if (command === 'later') { await say('בסדר גמור 👍 אפשר לחזור לזה בכל רגע עם "קהל לקוחות".'); return true; }
  if (command === 'status') { await sendStatus(client.id, from); return true; }
  if (await ownerBusy(client.id)) { await say('יש משימה שמחכה לאישור שלך. סיימו או בטלו אותה קודם, כדי ששום אישור לא יידרס.'); return true; }
  try {
    const r = command === 'sync' ? await prepareSync(client.id, { approve }) : await prepareLookalike(client.id, { approve });
    if (!r.approval) { await say(r.reply || reasonText[r.reason] || 'אין מה לעדכן כרגע.'); return true; }
    const card = require('./actionPlan').formatActionPlan(r.approval.actionPlan);
    const ui = await require('./conversationUi').prepareApproval(client.id, r.approval, card);
    await say(ui.text, ui);
  } catch (error) {
    const code = /^[A-Z_]+$/.test(error?.message || '') ? error.message : 'BUYER_AUDIENCE_PREPARE_FAILED';
    logger.warn('Buyer audience approval not prepared', { error: code });
    if (error?.reply) await say(error.reply);
    else await say(code === 'META_CONNECTION_REQUIRED' ? 'כדי ליצור קהל צריך חיבור פעיל לחשבון הפרסום. כתוב "חיבור למטא".' : 'לא הצלחתי להכין את הקהל מול Meta כרגע. לא נשלח שום דבר. אפשר לנסות שוב בעוד כמה דקות.');
  }
  return true;
}

// After Meta verified the approved audience action.
function doneText(plan) {
  if (plan.intent === 'CREATE_LOOKALIKE') return '✅ הקהל הדומה (1%) נוצר ב־Meta.\nMeta בונה אותו בשעות הקרובות (עד 6 שעות). אפשר להשתמש בו בקמפיין הבא שנכין, תמיד באישור שלך.';
  return '✅ קהל הלקוחות הקיימים ' + (plan.parameters.audienceId ? 'עודכן' : 'נוצר') + ' ב־Meta (' + plan.parameters.buyerCount + ' לקוחות).\n' +
    'Meta מתאימה את הרשימה בשעות הקרובות (עד 24 שעות). מעכשיו, בכל קמפיין פניות חדש לא נפרסם למי שכבר קנה, וזה יופיע בכרטיס האישור.';
}

async function ownsApproval(clientId, actionId) {
  if (!enabled()) return false;
  return (await db.query('SELECT 1 FROM action_plans WHERE client_id=$1 AND id=$2 AND intent=ANY($3::text[])', [clientId, String(actionId), INTENTS])).rows.length > 0;
}

// Weekly: when there are new buyers (or the lookalike became possible), ask the owner.
// Never writes to Meta: it only sends a message with buttons; each button raises a fresh approval.
async function runDue({ onlyClientIds, limit = 50 } = {}) {
  if (!enabled() || !db.configured()) return { status: 'DISABLED' };
  await db.query("DELETE FROM buyer_audience_snapshots WHERE created_at<NOW()-make_interval(days=>$1::int)", [RULES.snapshotDays]);
  const clients = (await db.query(`SELECT c.id,c.phone,c.meta_ad_account_id FROM clients c
    JOIN whatsapp_contacts w ON w.phone=c.phone AND w.last_inbound_at>NOW()-INTERVAL '24 hours'
    JOIN meta_connections m ON m.client_id=c.id AND m.app_id=$3 AND m.expires_at>NOW()
    WHERE c.meta_ad_account_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM crm_leads l WHERE l.client_id=c.id AND l.status='WON' AND l.phone IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM buyer_audience_offers o WHERE o.client_id=c.id AND o.ad_account_id=c.meta_ad_account_id AND o.offered_at>NOW()-make_interval(days=>$1::int))
      AND ($2::bigint[] IS NULL OR c.id=ANY($2::bigint[]))
    LIMIT $4`, [RULES.offerEveryDays, onlyClientIds || null, process.env.META_APP_ID, limit])).rows;
  const results = [];
  for (const client of clients) {
    try {
      if (await ownerBusy(client.id) || await require('./leadCheckins').ownerBusy(client.id)) { results.push('BUSY'); continue; }
      const result = await require('./metaConnection').context.run(String(client.id), () =>
        require('./whatsappDelivery').messageContext.run({ eventId: 'buyers:' + client.id + ':' + new Date().toISOString().slice(0, 10), sequence: 0 }, async () => {
          const s = await status(client.id);
          if (!s.items.length) return 'QUIET';
          const claim = await db.query(`INSERT INTO buyer_audience_offers(client_id,ad_account_id,kind) VALUES($1,$2,'SYNC')
            ON CONFLICT(client_id,ad_account_id,kind) DO UPDATE SET offered_at=NOW() WHERE buyer_audience_offers.offered_at<=NOW()-make_interval(days=>$3::int) RETURNING client_id`, [client.id, client.meta_ad_account_id, RULES.offerEveryDays]);
          if (!claim.rows.length) return 'ALREADY_OFFERED';
          const ui = await require('./conversationUi').prepareChoices(client.id, '📅 העדכון השבועי של קהל הלקוחות\n\n' + s.text, s.items, 'guard_alert');
          await require('./whatsapp').safeSend(client.phone, ui.text, ui);
          return 'OFFERED';
        }));
      results.push(result);
    } catch (error) {
      logger.warn('Buyer audience weekly check skipped', { error: /^[A-Z_]+$/.test(error?.message || '') ? error.message : 'BUYER_AUDIENCE_CHECK_FAILED' });
      results.push('FAILED');
    }
  }
  return { status: 'RAN', results };
}

module.exports = { enabled, doneText, normalizePhone, hashPhone, digestOf, buyerHashes, current, tosLink, tosMessage, tosAccepted, matched, prepareSync, prepareLookalike, approvedHashes, applyExclusion, excludesBuyers, status, handleText, ownsApproval, runDue, AUDIENCE_NAME, LOOKALIKE_NAME, LOOKALIKE_LINE, PRIVACY_LINE, INTENTS, RULES };
