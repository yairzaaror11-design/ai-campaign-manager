'use strict';
// Meta connection health: permissions, long-lived tokens, expiry, revocation and assets.
//
// Verified against Meta's docs (developers.facebook.com, Graph API v26/v27):
// - Long-lived user token: /oauth/access_token?grant_type=fb_exchange_token (about 60 days).
//   An expired token cannot be exchanged; the owner must log in again.
// - GET /debug_token?input_token=…&access_token={app-id}|{app-secret} → is_valid, expires_at
//   (0 = never), data_access_expires_at, scopes.
// - GET /me/permissions → [{permission,status:'granted'|'declined'}]. Declined permissions are
//   asked again only when the dialog gets auth_type=rerequest.
// - Error 190 = invalid OAuth token (subcodes: 458 app removed, 460 logged out / password
//   changed, 463 expired). Meta does not notify apps, so a 190 triggers a debug_token check.
// No token, id or phone number leaves this module in a public view.
const axios = require('axios');
const db = require('./db');
const meta = require('./metaConnection');
const { logger } = require('./logger');

// What the code uses, by feature (see the README section in the final report):
// ads_management / ads_read: campaigns, insights (metaWrite, metaExecution, reports).
// business_management: ad accounts and pixels owned by the Business portfolio.
// pages_show_list / pages_read_engagement: list the owner's Pages, read Page content.
// pages_manage_ads: ads and lead forms on the Page (metaWrite CREATE_LEAD_FORM).
// leads_retrieval: read Lead Ads submissions (metaLeadImport).
// instagram_basic (optional): show the Instagram professional account linked to the Page.
// Publishing posts (pages_manage_posts, instagram_content_publish) uses the separate
// Facebook / Instagram social connection; WhatsApp uses the system token, so
// whatsapp_business_messaging is never requested from the owner.
const REQUIRED = ['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement', 'pages_manage_ads', 'leads_retrieval'];
const OPTIONAL = ['instagram_basic'];
const LABELS = {
  ads_management: 'יצירה וניהול של מודעות',
  ads_read: 'קריאת נתוני הפרסום והתוצאות',
  business_management: 'גישה לחשבונות העסק ב־Meta',
  pages_show_list: 'רשימת העמודים שלך',
  pages_read_engagement: 'קריאת התוכן של העמוד',
  pages_manage_ads: 'מודעות וטפסי לידים של העמוד',
  leads_retrieval: 'קבלת לידים מטפסי Meta',
  instagram_basic: 'פרטי חשבון האינסטגרם העסקי'
};
const DAY = 86400000;
const RENEW_BEFORE_DAYS = 10;
const NOTICE_BEFORE_DAYS = 7;
const REASONS = { 458: 'APP_REMOVED', 460: 'SESSION_INVALIDATED', 463: 'TOKEN_EXPIRED' };

const version = () => meta.config().version;
const appToken = () => process.env.META_APP_ID + '|' + process.env.META_APP_SECRET;
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const list = (value) => (Array.isArray(value) ? value.filter((p) => typeof p === 'string' && /^[a-z_]{2,60}$/.test(p)) : []);

async function debugToken(token) {
  const r = await axios.get('https://graph.facebook.com/' + version() + '/debug_token', {
    params: { input_token: token, access_token: appToken() }, timeout: 15000, maxRedirects: 0
  });
  const d = r?.data?.data;
  if (!d || typeof d !== 'object' || typeof d.is_valid !== 'boolean') throw Error('DEBUG_TOKEN_UNAVAILABLE');
  if (d.app_id && String(d.app_id) !== String(process.env.META_APP_ID)) throw Error('TOKEN_APP_MISMATCH');
  return {
    valid: d.is_valid,
    userId: d.user_id ? String(d.user_id) : null,
    expiresAt: Number(d.expires_at) > 0 ? Number(d.expires_at) * 1000 : null,
    neverExpires: Number(d.expires_at) === 0,
    dataAccessExpiresAt: Number(d.data_access_expires_at) > 0 ? Number(d.data_access_expires_at) * 1000 : null,
    scopes: list(d.scopes),
    subcode: Number(d.error?.subcode) || null
  };
}

async function exchangeLongLived(token) {
  const data = (await axios.post('https://graph.facebook.com/' + version() + '/oauth/access_token', new URLSearchParams({
    grant_type: 'fb_exchange_token', client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET, fb_exchange_token: token
  }), { timeout: 15000, maxRedirects: 0 })).data;
  if (typeof data?.access_token !== 'string' || !data.access_token || data.access_token.length > 4096) throw Error('LONG_LIVED_EXCHANGE_FAILED');
  return { token: data.access_token, expiresIn: Number.isFinite(data.expires_in) && data.expires_in > 0 ? data.expires_in : null };
}

async function permissions(token) {
  const rows = (await meta.graph('/me/permissions', token)).data || [];
  return {
    granted: list(rows.filter((p) => p.status === 'granted').map((p) => p.permission)),
    declined: list(rows.filter((p) => p.status === 'declined').map((p) => p.permission))
  };
}

const missingOf = (granted) => REQUIRED.filter((p) => !granted.includes(p));

// Upserts the grant after a successful login / check. q may be a transaction.
async function saveGrant(clientId, { granted, declined, tokenExpiresAt, dataAccessExpiresAt, fresh = false }, q = db.query) {
  await q(`INSERT INTO meta_auth_state(client_id,status,reason,granted,declined,token_expires_at,data_access_expires_at,last_check_at,last_sync_at,revoked_at)
    VALUES($1,'ACTIVE',NULL,$2::jsonb,$3::jsonb,$4,$5,NOW(),NOW(),NULL)
    ON CONFLICT(client_id) DO UPDATE SET status='ACTIVE',reason=NULL,granted=$2::jsonb,declined=$3::jsonb,
      token_expires_at=COALESCE($4,meta_auth_state.token_expires_at),data_access_expires_at=COALESCE($5,meta_auth_state.data_access_expires_at),
      last_check_at=NOW(),last_sync_at=NOW(),revoked_at=NULL,
      revoked_notice_at=CASE WHEN $6 THEN NULL ELSE meta_auth_state.revoked_notice_at END,
      expiry_notice_at=CASE WHEN $6 THEN NULL ELSE meta_auth_state.expiry_notice_at END,updated_at=NOW()`,
  [clientId, JSON.stringify(list(granted)), JSON.stringify(list(declined)), tokenExpiresAt ? new Date(tokenExpiresAt) : null, dataAccessExpiresAt ? new Date(dataAccessExpiresAt) : null, fresh]);
}

// A login whose core permissions were refused is not saved as a connection, but the
// refused list is kept so "תן הרשאה" can ask again for exactly those.
async function recordRefused(clientId, granted, declined) {
  await db.query(`INSERT INTO meta_auth_state(client_id,status,reason,granted,declined,last_check_at)
    VALUES($1,'DISCONNECTED','MISSING_PERMISSIONS',$2::jsonb,$3::jsonb,NOW())
    ON CONFLICT(client_id) DO UPDATE SET granted=$2::jsonb,declined=$3::jsonb,last_check_at=NOW(),updated_at=NOW()`,
  [clientId, JSON.stringify(list(granted)), JSON.stringify(list(declined))]);
}

async function state(clientId) {
  return (await db.query('SELECT * FROM meta_auth_state WHERE client_id=$1', [clientId])).rows[0] || null;
}

// Exactly the permissions to ask again (declined or never granted).
async function missingScopes(clientId) {
  const s = await state(clientId);
  const granted = list(s?.granted);
  const wanted = [...REQUIRED, ...OPTIONAL].filter((p) => !granted.includes(p));
  return wanted.length ? wanted : REQUIRED;
}

async function phoneOf(clientId) {
  return (await db.query('SELECT phone FROM clients WHERE id=$1', [clientId])).rows[0]?.phone || null;
}

async function notifyOwner(clientId, key, text) {
  const phone = await phoneOf(clientId);
  if (!phone) return false;
  await meta.context.run(String(clientId), () => require('./whatsappDelivery').messageContext.run(
    { eventId: 'meta-auth:' + key + ':' + clientId + ':' + Date.now(), sequence: 0 },
    () => require('./whatsapp').safeSend(phone, text)
  ));
  return true;
}

const RECONNECT_HINT = 'אם תרצה לחבר מחדש, רק תבקש ממני קישור חדש לחיבור מטא, או תיכנס לדשבורד ← חיבורים.';
const REVOKED_TEXT = {
  DEAUTHORIZED: 'החיבור של העסק ל־Meta הוסר מתוך פייסבוק, ולכן הפסקתי את כל הפעולות מול Meta (קמפיינים, לידים ודוחות). הנתונים והטיוטות שמורים.',
  APP_REMOVED: 'ההרשאה של SCORPIO הוסרה בפייסבוק, ולכן הפסקתי את כל הפעולות מול Meta. הנתונים והטיוטות שמורים.',
  SESSION_INVALIDATED: 'פייסבוק ביטלה את החיבור (בדרך כלל אחרי שינוי סיסמה או יציאה מהחשבון), ולכן הפסקתי את הפעולות מול Meta. הנתונים והטיוטות שמורים.',
  TOKEN_EXPIRED: 'פג התוקף של החיבור ל־Meta, ולכן הפסקתי את הפעולות מול Meta. הנתונים והטיוטות שמורים.'
};

// Revoked or expired: remove the token (every Meta job needs it, so they all stop),
// expire pending approvals and in-flight logins, keep the chosen assets for reconnect.
async function markRevoked(clientId, reason = 'TOKEN_INVALID', { notify = true } = {}) {
  const status = reason === 'TOKEN_EXPIRED' ? 'EXPIRED' : 'REVOKED';
  const had = await db.transaction(async (tx) => {
    const client = await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE', [clientId]);
    if (!client.rows.length) return false;
    const removed = await tx('DELETE FROM meta_connections WHERE client_id=$1 RETURNING client_id', [clientId]);
    await tx('UPDATE clients SET meta_generation=meta_generation+1 WHERE id=$1', [clientId]);
    await tx("UPDATE approvals SET status='CANCELLED' WHERE client_id=$1 AND status='PENDING'", [clientId]);
    await tx(`INSERT INTO meta_auth_state(client_id,status,reason,revoked_at) VALUES($1,$2,$3,NOW())
      ON CONFLICT(client_id) DO UPDATE SET status=$2,reason=$3,revoked_at=NOW(),updated_at=NOW()`, [clientId, status, reason]);
    await tx("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'META_CONNECTION_REVOKED',$2)", [clientId, reason]);
    return removed.rows.length > 0;
  });
  if (!had) return false;
  try {
    const conv = require('./metaConversation');
    await conv.recordStatus(clientId, 'VERIFYING_ACCESS').catch(() => {});
    await conv.recordStatus(clientId, status === 'EXPIRED' ? 'TOKEN_EXPIRED' : 'RECONNECT_REQUIRED', { account: null, lastError: status === 'EXPIRED' ? 'META_TOKEN_EXPIRED' : 'CONNECTION_REVOKED', lastCheckAt: new Date().toISOString() });
  } catch { /* the token is already gone; the status text catches up on the next check */ }
  if (notify) {
    const claimed = await db.query('UPDATE meta_auth_state SET revoked_notice_at=NOW() WHERE client_id=$1 AND revoked_notice_at IS NULL RETURNING client_id', [clientId]);
    if (claimed.rows.length) {
      await notifyOwner(clientId, 'revoked', '🔌 ' + (REVOKED_TEXT[reason] || 'החיבור של העסק ל־Meta כבר לא תקף, ולכן הפסקתי את הפעולות מול Meta. הנתונים והטיוטות שמורים.') + '\n' + RECONNECT_HINT)
        .catch(() => logger.warn('Meta revocation notice not sent'));
    }
  }
  return true;
}

async function storedToken(clientId) {
  const row = (await db.query('SELECT token_ciphertext FROM meta_connections WHERE client_id=$1 AND app_id=$2', [clientId, process.env.META_APP_ID])).rows[0];
  return row ? meta.decrypt(row.token_ciphertext, clientId) : null;
}

// Called (without waiting) when any Graph call for a business answers 190. Confirms with
// debug_token before acting, so a bad page token or a network error never disconnects.
const recentChecks = new Map();
async function onTokenError(clientId) {
  const key = String(clientId);
  if (Date.now() - (recentChecks.get(key) || 0) < 10 * 60000) return false;
  recentChecks.set(key, Date.now());
  const token = await storedToken(clientId);
  if (!token) return false;
  const d = await debugToken(token);
  if (d.valid) return false;
  return markRevoked(clientId, REASONS[d.subcode] || (d.expiresAt && d.expiresAt <= Date.now() ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID'));
}

// One business: live debug_token + permissions, renewal and owner notices.
async function checkOne(clientId, { renew = true, notify = true } = {}) {
  const row = (await db.query('SELECT expires_at FROM meta_connections WHERE client_id=$1 AND app_id=$2', [clientId, process.env.META_APP_ID])).rows[0];
  if (!row) return { status: 'NOT_CONNECTED' };
  if (new Date(row.expires_at).getTime() <= Date.now()) { await markRevoked(clientId, 'TOKEN_EXPIRED', { notify }); return { status: 'EXPIRED' }; }
  const token = await storedToken(clientId);
  let d = await debugToken(token);
  if (!d.valid) { await markRevoked(clientId, REASONS[d.subcode] || 'TOKEN_INVALID', { notify }); return { status: 'REVOKED' }; }
  let renewed = false;
  const soon = (ms, days) => ms && ms - Date.now() < days * DAY;
  if (renew && soon(d.expiresAt, RENEW_BEFORE_DAYS)) {
    // Meta allows exchanging a still-valid token again; if it does not extend it, the
    // owner is asked to reconnect before it lapses.
    try { await meta.renew(clientId); d = await debugToken(await storedToken(clientId)); renewed = true; } catch { /* notice below */ }
  }
  const perms = await permissions(await storedToken(clientId));
  await saveGrant(clientId, { ...perms, tokenExpiresAt: d.expiresAt || (d.neverExpires ? Date.now() + 365 * DAY : null), dataAccessExpiresAt: d.dataAccessExpiresAt });
  if (d.expiresAt) await db.query('UPDATE meta_connections SET expires_at=$2 WHERE client_id=$1', [clientId, new Date(d.expiresAt)]);
  const lapse = [d.expiresAt, d.dataAccessExpiresAt].filter(Boolean).sort((a, b) => a - b)[0];
  if (notify && soon(lapse, NOTICE_BEFORE_DAYS)) {
    const claimed = await db.query('UPDATE meta_auth_state SET expiry_notice_at=NOW() WHERE client_id=$1 AND expiry_notice_at IS NULL RETURNING client_id', [clientId]);
    if (claimed.rows.length) {
      const days = Math.max(1, Math.ceil((lapse - Date.now()) / DAY));
      await notifyOwner(clientId, 'expiry', `⏳ החיבור של העסק ל־Meta יפוג בעוד ${days} ימים (${new Date(lapse).toLocaleDateString('he-IL')}). Meta דורשת אישור מחדש מדי פעם.\n` + RECONNECT_HINT)
        .catch(() => logger.warn('Meta expiry notice not sent'));
    }
  }
  return { status: 'ACTIVE', renewed, missing: missingOf(perms.granted), tokenExpiresAt: iso(d.expiresAt), dataAccessExpiresAt: iso(d.dataAccessExpiresAt) };
}

// Background job (hourly): every connected business, one at a time.
async function runDue({ limit = 200 } = {}) {
  try { meta.config(); } catch { return { checked: 0, skipped: 'NOT_CONFIGURED' }; }
  const rows = (await db.query(`SELECT m.client_id FROM meta_connections m LEFT JOIN meta_auth_state s ON s.client_id=m.client_id
    WHERE m.app_id=$1 AND (s.last_check_at IS NULL OR s.last_check_at<NOW()-INTERVAL '20 hours' OR m.expires_at<NOW()+INTERVAL '${RENEW_BEFORE_DAYS} days')
    ORDER BY s.last_check_at NULLS FIRST LIMIT $2`, [process.env.META_APP_ID, limit])).rows;
  let checked = 0, failed = 0;
  for (const row of rows) {
    try { await checkOne(row.client_id); checked++; } catch (error) {
      failed++;
      logger.warn('Meta auth check failed', { error: /^[A-Z_]+$/.test(error?.message) ? error.message : 'CHECK_FAILED' });
    }
  }
  return { checked, failed };
}

// ---------- Assets (live from Meta, chosen per business) ----------
const numeric = (v) => typeof v === 'string' && /^\d{1,30}$/.test(v);
const clip = (v, n = 200) => String(v ?? '').slice(0, n);

async function pages(token) {
  const out = [];
  let after;
  for (let i = 0; i < 5; i++) {
    const params = { limit: 100, ...(after ? { after } : {}) };
    let r;
    try { r = await meta.graph('/me/accounts', token, { ...params, fields: 'id,name,tasks,instagram_business_account{id,username}' }); }
    catch { r = await meta.graph('/me/accounts', token, { ...params, fields: 'id,name,tasks' }); }
    out.push(...(r.data || []));
    if (!r.paging?.next) break;
    after = r.paging?.cursors?.after;
    if (typeof after !== 'string' || after.length > 4096) break;
  }
  return out.filter((p) => numeric(String(p.id))).map((p) => ({
    id: String(p.id), name: clip(p.name || p.id),
    instagram: p.instagram_business_account && numeric(String(p.instagram_business_account.id)) ? { id: String(p.instagram_business_account.id), username: clip(p.instagram_business_account.username || '', 100) } : null
  }));
}

async function pixels(token, adAccountId) {
  if (!/^act_\d+$/.test(adAccountId || '')) return [];
  const r = await meta.graph('/' + adAccountId + '/adspixels', token, { fields: 'id,name,last_fired_time', limit: 50 });
  return (r.data || []).filter((p) => /^\d{5,20}$/.test(String(p.id))).map((p) => ({ id: String(p.id), name: clip(p.name || p.id), lastFiredAt: p.last_fired_time || null }));
}

async function assets(clientId) {
  const c = await meta.credentials(clientId);
  const [accounts, pageList] = await Promise.all([meta.accounts(clientId), pages(c.token)]);
  const adAccounts = (accounts.data || []).filter((a) => /^act_\d+$/.test(a.id)).map((a) => ({ id: a.id, name: clip(a.name || a.id), currency: a.currency || null, active: a.account_status === 1 }));
  const pixelList = await pixels(c.token, c.meta_ad_account_id).catch(() => []);
  const s = await state(clientId);
  const pixelId = (await db.query('SELECT pixel_id FROM business_channels WHERE client_id=$1', [clientId])).rows[0]?.pixel_id || null;
  await db.query('UPDATE meta_auth_state SET last_sync_at=NOW() WHERE client_id=$1', [clientId]);
  return {
    adAccounts, pages: pageList.map(({ instagram, ...p }) => p),
    instagram: pageList.filter((p) => p.instagram).map((p) => ({ ...p.instagram, pageId: p.id })),
    pixels: pixelList,
    selected: { adAccount: c.meta_ad_account_id || null, page: s?.page_id || null, instagram: s?.instagram_id || null, pixel: pixelId }
  };
}

async function selectAsset(clientId, kind, id) {
  if (typeof id !== 'string') throw Error('INVALID_ASSET');
  if (kind === 'adAccount') { await meta.selectAccount(clientId, id); await require('./metaConversation').verify(clientId).catch(() => null); return { ok: true }; }
  if (!numeric(id)) throw Error('INVALID_ASSET');
  const c = await meta.credentials(clientId);
  if (kind === 'page' || kind === 'instagram') {
    const list = await pages(c.token);
    const page = kind === 'page' ? list.find((p) => p.id === id) : list.find((p) => p.instagram?.id === id);
    if (!page) throw Error('ASSET_NOT_GRANTED');
    const ig = page.instagram;
    await db.query(`INSERT INTO meta_auth_state(client_id,page_id,page_name,instagram_id,instagram_username) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(client_id) DO UPDATE SET page_id=$2,page_name=$3,instagram_id=$4,instagram_username=$5,updated_at=NOW()`,
    [clientId, page.id, page.name, ig?.id || null, ig?.username || null]);
    await db.query("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'META_ASSET_SELECTED',$2)", [clientId, kind]);
    return { ok: true };
  }
  if (kind === 'pixel') {
    const found = (await pixels(c.token, c.meta_ad_account_id)).find((p) => p.id === id);
    if (!found) throw Error('ASSET_NOT_GRANTED');
    // The Conversions API already sends to business_channels.pixel_id (metaCrmFeedback).
    await db.query('INSERT INTO business_channels(client_id,pixel_id) VALUES($1,$2) ON CONFLICT(client_id) DO UPDATE SET pixel_id=$2,updated_at=NOW()', [clientId, id]);
    await db.query(`INSERT INTO meta_auth_state(client_id,pixel_name) VALUES($1,$2) ON CONFLICT(client_id) DO UPDATE SET pixel_name=$2,updated_at=NOW()`, [clientId, found.name]);
    await db.query("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'META_PIXEL','SET')", [clientId]);
    return { ok: true };
  }
  throw Error('INVALID_ASSET');
}

// The Page / Instagram account the owner chose (for other modules: ads, lead forms).
async function selectedAssets(clientId) {
  const s = await state(clientId);
  return { pageId: s?.page_id || null, instagramId: s?.instagram_id || null };
}

// ---------- Views ----------
function configured() { try { meta.config(); return true; } catch { return false; } }

async function metaView(clientId) {
  const row = (await db.query(`SELECT m.expires_at,m.app_id,c.meta_ad_account_id FROM clients c LEFT JOIN meta_connections m ON m.client_id=c.id WHERE c.id=$1`, [clientId])).rows[0] || {};
  const s = await state(clientId);
  const profile = await require('./marketingStore').load(clientId).catch(() => null);
  const connected = !!(row.expires_at && row.app_id === process.env.META_APP_ID && new Date(row.expires_at) > new Date());
  const granted = s ? list(s.granted) : list(profile?.connection?.permissions);
  const declined = s ? list(s.declined) : [];
  const missing = connected || declined.length ? missingOf(granted) : [];
  let status = 'NOT_CONNECTED';
  if (connected) status = missing.length ? 'MISSING_PERMISSIONS' : row.meta_ad_account_id ? 'CONNECTED' : 'ACCOUNT_SELECTION_REQUIRED';
  else if (s?.status === 'REVOKED' || s?.status === 'EXPIRED') status = s.status;
  const pixelId = (await db.query('SELECT pixel_id FROM business_channels WHERE client_id=$1', [clientId])).rows[0]?.pixel_id || null;
  const account = profile?.connection?.account?.id === row.meta_ad_account_id ? profile.connection.account : null;
  return {
    configured: configured(), connected, status, reason: connected ? null : s?.reason || null,
    permissions: [...REQUIRED.map((p) => ({ name: p, label: LABELS[p], required: true, granted: granted.includes(p), declined: declined.includes(p) })),
      ...OPTIONAL.map((p) => ({ name: p, label: LABELS[p], required: false, granted: granted.includes(p), declined: declined.includes(p) }))],
    missing,
    tokenExpiresAt: connected ? (s?.token_expires_at || row.expires_at) : null,
    dataAccessExpiresAt: connected ? s?.data_access_expires_at || null : null,
    lastSyncAt: s?.last_sync_at || profile?.connection?.lastCheckAt || null,
    lastCheckAt: s?.last_check_at || null,
    assets: {
      adAccount: row.meta_ad_account_id ? { id: row.meta_ad_account_id, name: account?.name || null } : null,
      page: s?.page_id ? { id: s.page_id, name: s.page_name } : null,
      instagram: s?.instagram_id ? { id: s.instagram_id, username: s.instagram_username } : null,
      pixel: pixelId ? { id: pixelId, name: s?.pixel_name || null } : null
    }
  };
}

async function connections(clientId) {
  const q = (sql, params) => db.query(sql, params).then((r) => r.rows[0] || {}).catch(() => ({}));
  const metaPart = await metaView(clientId);
  const social = await require('./socialConnections').list(clientId).catch(() => []);
  const publishing = social.filter((p) => ['facebook', 'instagram'].includes(p.id)).map((p) => ({
    id: p.id, name: p.name, configured: p.configured, connected: p.connected, selectionRequired: p.selectionRequired,
    expired: p.expired, hasAuthorization: p.hasAuthorization, displayName: p.displayName || null,
    accounts: (p.accounts || []).map((a) => ({ id: a.id, name: a.name }))
  }));
  const capi = await q(`SELECT MAX(event_time) FILTER (WHERE status='SENT') AS last_sent, COUNT(*) FILTER (WHERE status='FAILED')::int AS failed FROM meta_capi_events WHERE client_id=$1`, [clientId]);
  const leads = await q(`SELECT COUNT(DISTINCT s.form_id)::int AS forms,
      (SELECT MAX(e.available_at) FROM meta_lead_events e JOIN meta_lead_sources x ON x.form_id=e.form_id WHERE x.client_id=$1 AND e.status='DONE') AS last_lead
    FROM meta_lead_sources s WHERE s.client_id=$1`, [clientId]);
  const wa = await q(`SELECT MAX(created_at) AS last_sent FROM whatsapp_outbox WHERE client_id=$1 AND status IN ('SENT','DELIVERED','READ')`, [clientId]);
  let capiEnabled = false; try { capiEnabled = require('./metaCrmFeedback').webEnabled(); } catch { /* optional module */ }
  let leadImport = false; try { leadImport = require('./metaLeadImport').enabled(); } catch { /* optional module */ }
  return {
    meta: metaPart,
    publishing,
    pixel: { configured: !!metaPart.assets.pixel, conversionsApi: capiEnabled, metaConnected: metaPart.connected, lastEventAt: capi.last_sent || null, failedEvents: capi.failed || 0 },
    leadAds: { enabled: leadImport, webhookReady: !!(process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN) && !!process.env.META_APP_SECRET, forms: leads.forms || 0, lastLeadAt: leads.last_lead || null, missingPermission: metaPart.connected && metaPart.missing.includes('leads_retrieval') },
    whatsapp: { connected: process.env.WHATSAPP_SEND_ENABLED === 'true' && !!process.env.WHATSAPP_PHONE_NUMBER_ID, lastMessageAt: wa.last_sent || null }
  };
}

// /health: counts only — never tokens, ids or phone numbers.
async function healthSummary() {
  const r = (await db.query(`SELECT
      (SELECT COUNT(*)::int FROM meta_connections WHERE app_id=$1 AND expires_at>NOW()) AS connected,
      (SELECT COUNT(*)::int FROM meta_connections WHERE app_id=$1 AND expires_at>NOW() AND expires_at<NOW()+INTERVAL '${NOTICE_BEFORE_DAYS} days') AS expiring,
      (SELECT COUNT(*)::int FROM meta_auth_state WHERE status='REVOKED') AS revoked,
      (SELECT COUNT(*)::int FROM meta_auth_state WHERE status='EXPIRED') AS expired,
      (SELECT COUNT(*)::int FROM meta_auth_state s JOIN meta_connections m ON m.client_id=s.client_id WHERE NOT (s.granted @> $2::jsonb)) AS missing_permissions,
      (SELECT COUNT(*)::int FROM business_channels WHERE pixel_id IS NOT NULL) AS pixels,
      (SELECT COUNT(DISTINCT client_id)::int FROM meta_lead_sources) AS lead_sources,
      (SELECT COUNT(*)::int FROM social_connections WHERE provider IN ('facebook','instagram') AND token_ciphertext IS NOT NULL AND expires_at>NOW()) AS publishing`,
  [process.env.META_APP_ID || '', JSON.stringify(REQUIRED)])).rows[0];
  let capi = false, leads = false;
  try { capi = require('./metaCrmFeedback').webEnabled(); } catch { /* optional */ }
  try { leads = require('./metaLeadImport').enabled(); } catch { /* optional */ }
  return {
    meta: { configured: configured(), loginMode: process.env.META_LOGIN_CONFIG_ID ? 'business_config' : 'classic', connected: r.connected, expiringSoon: r.expiring, revoked: r.revoked, expired: r.expired, missingPermissions: r.missing_permissions },
    publishing: { connected: r.publishing },
    pixel: { configured: r.pixels, conversionsApi: capi },
    leadAds: { enabled: leads, businesses: r.lead_sources },
    whatsapp: { sending: process.env.WHATSAPP_SEND_ENABLED === 'true' }
  };
}

module.exports = { REQUIRED, OPTIONAL, LABELS, debugToken, exchangeLongLived, permissions, missingOf, saveGrant, recordRefused, state, missingScopes, markRevoked, onTokenError, checkOne, runDue, assets, selectAsset, selectedAssets, metaView, connections, healthSummary, notifyOwner };
