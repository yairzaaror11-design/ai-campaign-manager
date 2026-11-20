'use strict';
// Publishes an approved organic post by itself to the business's Facebook Page and
// Instagram professional account (Graph API), when all of these hold:
//   * ORGANIC_AUTOPUBLISH_ENABLED=true (operator switch, off by default);
//   * the work agreement is active (not paused) and allows "לפרסם פוסטים אורגניים בסגנון שאישרת";
//   * the network is connected in "חיבורים" and the token has the needed permissions.
// Anything missing or failing falls back to today's behaviour: the post goes to the owner
// on WhatsApp, with a plain sentence saying why it was not published automatically.
// One row per (post, network) in organic_publications makes it idempotent: a post is never
// published twice, and a call that may have reached Meta without an answer is never retried.
const crypto = require('node:crypto');
const axios = require('axios');
const db = require('./db');
const { logger } = require('./logger');

const NETWORKS = ['facebook', 'instagram'];
// Verified against Meta's docs (Pages API posts; Instagram content publishing with Facebook Login).
const REQUIRED = {
  facebook: ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement'],
  instagram: ['pages_show_list', 'instagram_basic', 'instagram_content_publish', 'pages_read_engagement']
};
const LABEL = { facebook: 'פייסבוק', instagram: 'אינסטגרם' };
const REASON_HE = {
  NOT_CONNECTED: 'החשבון לא מחובר',
  CONNECTION_EXPIRED: 'החיבור פג',
  MISSING_PERMISSIONS: 'חסרה הרשאת פרסום',
  NEEDS_IMAGE: 'אינסטגרם דורש תמונה, ולא הייתה תמונה מוכנה',
  NEEDS_JPEG: 'אינסטגרם מקבל רק תמונות JPEG, והתמונה שנוצרה בפורמט אחר',
  VIDEO_NOT_SUPPORTED: 'פרסום סרטונים אוטומטי עוד לא זמין',
  PAGE_NOT_GRANTED: 'אין הרשאה לדף העסקי',
  PUBLISH_FAILED: 'Meta החזירה שגיאה',
  UNCERTAIN: 'לא קיבלתי תשובה מ־Meta, ייתכן שהפוסט כבר עלה',
  FORBIDDEN_TOPIC: 'הפוסט נוגע בנושא שסימנת כאסור בהסכם העבודה'
};
const enabled = () => process.env.ORGANIC_AUTOPUBLISH_ENABLED === 'true';
const version = () => (/^v\d+\.\d+$/.test(process.env.META_GRAPH_VERSION || '') ? process.env.META_GRAPH_VERSION : 'v26.0');
const code = (e) => (/^[A-Z_]+(?::[a-z_,]+)?$/.test(e?.message || '') ? e.message : 'PUBLISH_FAILED');
const fail = (c, extra = {}) => Object.assign(Error(c), extra);

// SQL used by organicContent.claim(): the business may have this post published for it.
const ELIGIBLE_SQL = `EXISTS(SELECT 1 FROM authority_mandates m WHERE m.client_id=p.client_id AND m.status='ACTIVE' AND m.policy->>'kind'='WORK_AGREEMENT' AND m.policy->'allow'->>'organicPosts'='true')
  AND EXISTS(SELECT 1 FROM social_connections s WHERE s.client_id=p.client_id AND s.provider IN ('facebook','instagram') AND s.token_ciphertext IS NOT NULL AND s.external_id IS NOT NULL AND s.expires_at>NOW())`;

// Does the work agreement let the agent publish organic posts by itself?
async function agreementAllows(clientId) {
  const a = await require('./scopedAuthority').getAgreement(clientId).catch(() => null);
  if (!a) return { ok: false, why: 'NO_AGREEMENT' };
  if (a.paused) return { ok: false, why: 'PAUSED', agreement: a };
  if (!a.allow?.organicPosts) return { ok: false, why: 'NOT_ALLOWED', agreement: a };
  return { ok: true, agreement: a };
}

function proof(token, provider) {
  const secret = process.env['SOCIAL_' + provider.toUpperCase() + '_CLIENT_SECRET'];
  return secret ? { appsecret_proof: crypto.createHmac('sha256', secret).update(token).digest('hex') } : {};
}
async function get(path, token, provider, params = {}) {
  try {
    return (await axios.get('https://graph.facebook.com/' + version() + path, { headers: { Authorization: 'Bearer ' + token }, params: { ...params, ...proof(token, provider) }, timeout: 15000, maxRedirects: 0, maxContentLength: 1048576 })).data;
  } catch (e) { throw graphError(e); }
}
async function postGraph(path, token, provider, params) {
  try {
    return (await axios.post('https://graph.facebook.com/' + version() + path, new URLSearchParams({ ...params, ...proof(token, provider) }), { headers: { Authorization: 'Bearer ' + token }, timeout: 30000, maxRedirects: 0, maxContentLength: 1048576 })).data;
  } catch (e) { throw graphError(e); }
}
function graphError(e) {
  const c = Number(e?.response?.data?.error?.code);
  // No HTTP answer at all: the request may have reached Meta.
  return fail(c === 190 ? 'CONNECTION_EXPIRED' : [10, 200].includes(c) || (c >= 200 && c < 300) ? 'MISSING_PERMISSIONS' : 'PUBLISH_FAILED', { noAnswer: !e?.response, metaCode: c || null });
}

// The connected account and its user token for a network, or a reason it cannot be used.
async function connection(clientId, provider) {
  const r = (await db.query('SELECT app_id,token_ciphertext,external_id,display_name,expires_at FROM social_connections WHERE client_id=$1 AND provider=$2', [clientId, provider])).rows[0];
  if (!r?.token_ciphertext || !r.external_id) return { reason: 'NOT_CONNECTED' };
  if (!r.expires_at || new Date(r.expires_at) <= new Date()) return { reason: 'CONNECTION_EXPIRED' };
  const app = process.env['SOCIAL_' + provider.toUpperCase() + '_CLIENT_ID'];
  if (app && r.app_id && r.app_id !== app) return { reason: 'CONNECTION_EXPIRED' };
  let token;
  try { token = JSON.parse(require('./metaConnection').decrypt(r.token_ciphertext, clientId + ':' + provider)).accessToken; } catch { return { reason: 'CONNECTION_EXPIRED' }; }
  if (typeof token !== 'string' || !token) return { reason: 'CONNECTION_EXPIRED' };
  return { token, accountId: String(r.external_id), name: r.display_name };
}

// Which of the required permissions are missing for this token (Graph /me/permissions).
async function missingPermissions(token, provider) {
  const data = await get('/me/permissions', token, provider);
  const granted = new Set((data.data || []).filter((p) => p.status === 'granted').map((p) => p.permission));
  return REQUIRED[provider].filter((p) => !granted.has(p));
}

// Status for the dashboard ("בדיקת הרשאות"). Makes Graph calls only when asked.
async function status(clientId, { check = false } = {}) {
  const allows = await agreementAllows(clientId);
  const out = { enabled: enabled(), agreementAllows: allows.ok, agreementWhy: allows.ok ? null : allows.why, networks: {} };
  for (const n of NETWORKS) {
    const c = await connection(clientId, n);
    const row = { connected: !c.reason, account: c.name || null, reason: c.reason || null, missing: null, required: REQUIRED[n] };
    if (check && !c.reason) {
      try { row.missing = await missingPermissions(c.token, n); if (row.missing.length) row.reason = 'MISSING_PERMISSIONS'; }
      catch (e) { row.reason = code(e); }
    }
    out.networks[n] = row;
  }
  return out;
}

// ---------- Images Meta can fetch by URL ----------
async function storeMedia(clientId, image) {
  const id = crypto.randomUUID();
  await db.query("INSERT INTO channel_media(id,client_id,mime_type,bytes,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '7 days')", [id, clientId, image.mimeType, image.buffer]);
  await db.query('DELETE FROM channel_media WHERE expires_at<NOW()');
  return { url: require('./portalStore').origin() + '/m/' + id, mimeType: image.mimeType };
}
async function media(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
  const r = (await db.query('SELECT mime_type,bytes FROM channel_media WHERE id=$1 AND expires_at>NOW()', [id])).rows[0];
  return r ? { mimeType: r.mime_type, buffer: Buffer.from(r.bytes) } : null;
}
const isJpeg = (b) => b?.[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

// The post's image: a real catalog photo, or the AI graphic (generated once; the same
// asset is reused for the WhatsApp fallback through graphicService's own dedupe).
async function imageFor(post, { graphic } = {}) {
  if (post.media === 'PHOTO' && post.catalog_item_id) {
    const catalog = require('./catalog');
    const [first] = await catalog.photoIds(post.client_id, post.catalog_item_id);
    if (!first) return null;
    const p = await catalog.photo(post.client_id, post.catalog_item_id, first);
    return { buffer: p.buffer, mimeType: isJpeg(p.buffer) ? 'image/jpeg' : 'image/png' };
  }
  if (post.media !== 'AI_GRAPHIC') return null;
  if (graphic) return graphic(post);
  let captured = null;
  const g = require('./graphicService');
  try {
    await g.createGraphic(post.client_id, (`Organic social media ${post.format === 'STORY' ? 'story (vertical)' : 'post (square)'} image for a small business. ${post.visual}. Topic: ${post.topic}. Natural, warm, professional. Avoid text in the image.`).slice(0, 2000),
      { uploadImage: async (image) => { captured = image; return g.upload(image); } });
  } catch (e) { logger.warn('Autopublish image not created', { error: code(e) }); }
  return captured;
}

// ---------- Publishing ----------
async function claim(post, network) {
  const r = await db.query(`INSERT INTO organic_publications(post_id,network,client_id) VALUES($1,$2,$3)
    ON CONFLICT(post_id,network) DO UPDATE SET status='PUBLISHING',attempts=organic_publications.attempts+1,reason=NULL,updated_at=NOW()
    WHERE organic_publications.status='FAILED' AND organic_publications.attempts<3 RETURNING post_id`, [post.id, network, post.client_id]);
  if (r.rows.length) return { claimed: true };
  return { claimed: false, existing: (await db.query('SELECT status,permalink,reason FROM organic_publications WHERE post_id=$1 AND network=$2', [post.id, network])).rows[0] };
}
async function record(post, network, fields) {
  await db.query(`UPDATE organic_publications SET status=$3,external_id=$4,permalink=$5,reason=$6,updated_at=NOW() WHERE post_id=$1 AND network=$2`,
    [post.id, network, fields.status, fields.externalId || null, fields.permalink || null, fields.reason ? String(fields.reason).slice(0, 120) : null]);
}

async function publishFacebook(c, post, image, { wait } = {}) {
  const pages = await get('/me/accounts', c.token, 'facebook', { fields: 'id,access_token', limit: 100 });
  const page = (pages.data || []).find((p) => String(p.id) === c.accountId);
  if (!page?.access_token) throw fail('PAGE_NOT_GRANTED');
  const r = image ? await postGraph(`/${c.accountId}/photos`, page.access_token, 'facebook', { url: image.url, message: post.caption, published: 'true' })
    : await postGraph(`/${c.accountId}/feed`, page.access_token, 'facebook', { message: post.caption });
  const id = String(r.post_id || r.id || '');
  if (!/^[0-9_]{1,80}$/.test(id)) throw fail('PUBLISH_FAILED', { noAnswer: true });
  return { externalId: id, permalink: 'https://www.facebook.com/' + id };
}

async function publishInstagram(c, post, image, { wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (!image) throw fail('NEEDS_IMAGE');
  if (image.mimeType !== 'image/jpeg') throw fail('NEEDS_JPEG');
  const container = await postGraph(`/${c.accountId}/media`, c.token, 'instagram', { image_url: image.url, caption: post.caption, ...(post.format === 'STORY' ? { media_type: 'STORIES' } : {}) });
  if (!/^\d{1,40}$/.test(String(container.id || ''))) throw fail('PUBLISH_FAILED');
  // Meta recommends checking the container when it is not ready yet; images are usually immediate.
  for (let i = 0; i < 3; i++) {
    const s = await get('/' + container.id, c.token, 'instagram', { fields: 'status_code' }).catch(() => ({}));
    if (!s.status_code || s.status_code === 'FINISHED') break;
    if (['ERROR', 'EXPIRED'].includes(s.status_code)) throw fail('PUBLISH_FAILED');
    await wait(3000);
  }
  const done = await postGraph(`/${c.accountId}/media_publish`, c.token, 'instagram', { creation_id: String(container.id) });
  const id = String(done.id || '');
  if (!/^\d{1,40}$/.test(id)) throw fail('PUBLISH_FAILED', { noAnswer: true });
  const link = await get('/' + id, c.token, 'instagram', { fields: 'permalink' }).catch(() => ({}));
  return { externalId: id, permalink: /^https:\/\/(www\.)?instagram\.com\//.test(link.permalink || '') ? link.permalink : null };
}
const PUBLISH = { facebook: publishFacebook, instagram: publishInstagram };

// Returns { attempted, results:[{network,status,permalink,reason}], complete, note } — never throws.
async function publishPost(post, options = {}) {
  if (!enabled()) return { attempted: false, results: [] };
  try {
    const allows = await agreementAllows(post.client_id);
    if (!allows.ok) return { attempted: false, results: [], why: allows.why };
    const forbidden = (allows.agreement.forbiddenTopics || []).find((t) => t && (post.caption + ' ' + post.topic).includes(t));
    const results = [];
    let image;
    for (const network of NETWORKS) {
      const c = await connection(post.client_id, network);
      if (c.reason === 'NOT_CONNECTED') continue; // only networks the owner connected
      if (c.reason) { results.push({ network, status: 'SKIPPED', reason: c.reason }); continue; }
      if (forbidden) { results.push({ network, status: 'SKIPPED', reason: 'FORBIDDEN_TOPIC' }); continue; }
      if (post.media === 'AI_VIDEO' || post.format === 'REEL') { results.push({ network, status: 'SKIPPED', reason: 'VIDEO_NOT_SUPPORTED' }); continue; }
      let missing;
      try { missing = await missingPermissions(c.token, network); } catch (e) { results.push({ network, status: 'SKIPPED', reason: code(e) }); continue; }
      if (missing.length) { results.push({ network, status: 'SKIPPED', reason: 'MISSING_PERMISSIONS', missing }); continue; }
      const claimed = await claim(post, network);
      if (!claimed.claimed) {
        const e = claimed.existing || {};
        results.push(e.status === 'PUBLISHED' ? { network, status: 'PUBLISHED', permalink: e.permalink } : { network, status: e.status === 'FAILED' ? 'FAILED' : 'UNCERTAIN', reason: e.status === 'FAILED' ? e.reason : 'UNCERTAIN' });
        continue;
      }
      try {
        if (image === undefined) {
          const raw = await imageFor(post, options);
          image = raw ? await storeMedia(post.client_id, raw) : null;
        }
        const r = await PUBLISH[network](c, post, image, options);
        await record(post, network, { status: 'PUBLISHED', ...r });
        results.push({ network, status: 'PUBLISHED', permalink: r.permalink });
      } catch (e) {
        const reason = code(e), uncertain = !!e.noAnswer && reason === 'PUBLISH_FAILED';
        await record(post, network, { status: uncertain ? 'UNCERTAIN' : 'FAILED', reason: uncertain ? 'UNCERTAIN' : reason });
        results.push({ network, status: uncertain ? 'UNCERTAIN' : 'FAILED', reason: uncertain ? 'UNCERTAIN' : reason });
        logger.warn('Organic autopublish failed', { network, reason });
      }
    }
    if (results.some((r) => r.status === 'PUBLISHED')) await db.query("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'ORGANIC_AUTOPUBLISHED',$2)", [post.client_id, results.filter((r) => r.status === 'PUBLISHED').map((r) => r.network).join(',')]).catch(() => {});
    const published = results.filter((r) => r.status === 'PUBLISHED');
    const complete = results.length > 0 && published.length === results.length;
    return { attempted: true, results, complete, note: note(results) };
  } catch (e) {
    logger.warn('Organic autopublish skipped', { error: code(e) });
    return { attempted: true, results: [], complete: false, note: 'לא הצלחתי לפרסם בעצמי הפעם, אז הנה הפוסט לפרסום ידני.' };
  }
}

// Plain Hebrew lines: what was published (with links) and what was not, and why.
function note(results) {
  if (!results.length) return 'לא פרסמתי בעצמי כי פייסבוק ואינסטגרם לא מחוברים. אפשר לחבר אותם בדשבורד, במסך "חיבורים".';
  return results.map((r) => r.status === 'PUBLISHED'
    ? `✅ פורסם ב${LABEL[r.network]}${r.permalink ? ': ' + r.permalink : ''}`
    : `⚠️ ב${LABEL[r.network]} לא פרסמתי: ${REASON_HE[String(r.reason).split(':')[0]] || REASON_HE.PUBLISH_FAILED}.${r.reason === 'MISSING_PERMISSIONS' ? ' צריך לחבר מחדש במסך "חיבורים" ולאשר הרשאת פרסום.' : ''}`).join('\n');
}

async function publications(clientId, postIds) {
  if (!postIds.length) return [];
  return (await db.query('SELECT post_id,network,status,permalink,reason,updated_at FROM organic_publications WHERE client_id=$1 AND post_id=ANY($2::uuid[])', [clientId, postIds])).rows;
}

module.exports = { enabled, NETWORKS, REQUIRED, REASON_HE, LABEL, ELIGIBLE_SQL, agreementAllows, connection, missingPermissions, status, media, publishPost, publications, note };
