'use strict';
// Public landing pages that really publish: one page per business and one per catalog
// item, at /p/<slug>. Mobile-first, Hebrew RTL, accessible (IS 5568 / WCAG 2.1 AA basics:
// labels, focus, contrast, skip link, live status, alt text). The lead form asks for
// consent with a privacy link and creates a lead linked to the item and the campaign (UTM).
// Publishing follows the work agreement: when it lets the agent publish content in the
// approved style ("לפרסם פוסטים אורגניים בסגנון שאישרת"), pages go live by themselves;
// otherwise they wait as drafts for one tap from the owner. Item pages render the item
// live, so a sold or paused item stops collecting leads right away.
const crypto = require('node:crypto');
const db = require('./db');
const { escape } = require('./landingService');

const SLUG = /^(?:[a-f0-9]{40}|[bi][a-z0-9]{10})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const newSlug = (kind) => (kind === 'BUSINESS' ? 'b' : 'i') + [...crypto.randomBytes(10)].map((b) => ALPHABET[b % ALPHABET.length]).join('');
const origin = () => require('./portalStore').origin();
const urlOf = (slug) => origin() + '/p/' + slug;

async function facts(clientId) {
  try { const p = await require('./marketingStore').load(clientId); return p ? require('./conversationFacts').all(p) : {}; } catch { return {}; }
}
const registered = async (clientId) => (await db.query('SELECT 1 FROM customer_accounts WHERE client_id=$1', [clientId])).rows.length > 0;

// ---------- Create / publish ----------
async function ensure(clientId, kind, itemId = null) {
  const find = () => db.query('SELECT * FROM landing_pages WHERE client_id=$1 AND kind=$2 AND catalog_item_id IS NOT DISTINCT FROM $3', [clientId, kind, itemId]);
  let page = (await find()).rows[0];
  if (page) return page;
  const f = await facts(clientId);
  const payload = { businessName: String(f.businessName || 'העסק').slice(0, 120), privacyContact: process.env.PRIVACY_CONTACT_EMAIL || null };
  await db.query(`INSERT INTO landing_pages(id,client_id,slug,payload,kind,catalog_item_id) VALUES($1,$2,$3,$4::jsonb,$5,$6) ON CONFLICT DO NOTHING`,
    [crypto.randomUUID(), clientId, newSlug(kind), JSON.stringify(payload), kind, itemId]);
  page = (await find()).rows[0];
  await db.query("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'LANDING_DRAFT_SAVED',$2)", [clientId, page.id]);
  return page;
}
async function publish(clientId, id) {
  if (!UUID.test(String(id || ''))) throw Error('INVALID_LANDING');
  if (!await registered(clientId)) throw Error('REGISTRATION_REQUIRED');
  const r = (await db.query(`UPDATE landing_pages SET status='PUBLISHED',revision=revision+1,published_at=COALESCE(published_at,NOW()),updated_at=NOW()
    WHERE client_id=$1 AND id=$2 AND kind IN ('BUSINESS','ITEM') AND status='DRAFT' RETURNING id,slug`, [clientId, id])).rows[0];
  if (r) await db.query("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'LANDING_PUBLISHED',$2)", [clientId, r.id]);
  const page = (await db.query('SELECT id,slug,status FROM landing_pages WHERE client_id=$1 AND id=$2', [clientId, id])).rows[0];
  if (!page) throw Error('LANDING_NOT_FOUND');
  return { id: page.id, status: page.status, url: page.status === 'PUBLISHED' ? urlOf(page.slug) : null };
}
async function publishDrafts(clientId) {
  const ids = (await db.query("SELECT id FROM landing_pages WHERE client_id=$1 AND kind IN ('BUSINESS','ITEM') AND status='DRAFT' ORDER BY kind,created_at", [clientId])).rows.map((r) => r.id);
  const out = [];
  for (const id of ids) out.push(await publish(clientId, id));
  return out;
}
// Publish now when the work agreement allows it; otherwise keep the draft and say why.
async function decide(clientId, page) {
  if (page.status === 'PUBLISHED') return { id: page.id, published: true, url: urlOf(page.slug) };
  const allows = await require('./socialPublisher').agreementAllows(clientId);
  if (!allows.ok) return { id: page.id, published: false, why: allows.why };
  if (!await registered(clientId)) return { id: page.id, published: false, why: 'REGISTRATION_REQUIRED' };
  const r = await publish(clientId, page.id);
  return { id: page.id, published: r.status === 'PUBLISHED', auto: true, url: r.url };
}
async function businessPage(clientId) { return decide(clientId, await ensure(clientId, 'BUSINESS')); }
// Called when a catalog item becomes active (marketed): its page, and the business page it links to.
async function onItemActive(clientId, item) {
  if (item?.status !== 'ACTIVE') return null;
  const business = await businessPage(clientId);
  const page = await decide(clientId, await ensure(clientId, 'ITEM', item.id));
  return { ...page, business };
}
async function list(clientId) {
  const rows = (await db.query(`SELECT l.id,l.slug,l.kind,l.status,l.catalog_item_id,i.title AS item_title,i.status AS item_status,
      (SELECT COUNT(*)::int FROM crm_leads c WHERE c.client_id=l.client_id AND c.landing_page_id=l.id) AS leads
    FROM landing_pages l LEFT JOIN catalog_items i ON i.id=l.catalog_item_id WHERE l.client_id=$1 AND l.kind IN ('BUSINESS','ITEM') ORDER BY l.kind,l.created_at DESC LIMIT 100`, [clientId])).rows;
  return rows.map((r) => ({ ...r, url: r.status === 'PUBLISHED' ? urlOf(r.slug) : null }));
}

// ---------- Public side ----------
async function get(slug) {
  if (!SLUG.test(String(slug || ''))) throw Error('LANDING_NOT_FOUND');
  const page = (await db.query("SELECT id,client_id,slug,payload,kind,catalog_item_id FROM landing_pages WHERE slug=$1 AND status='PUBLISHED'", [slug])).rows[0];
  if (!page) throw Error('LANDING_NOT_FOUND');
  return page;
}
const pixelFor = async (clientId) => (await db.query('SELECT pixel_id FROM business_channels WHERE client_id=$1', [clientId])).rows[0]?.pixel_id || null;
async function view(page) {
  const catalog = require('./catalog'), V = require('./verticalProfiles');
  const f = await facts(page.client_id), pixel = await pixelFor(page.client_id);
  const business = (await db.query("SELECT slug FROM landing_pages WHERE client_id=$1 AND kind='BUSINESS' AND status='PUBLISHED'", [page.client_id])).rows[0];
  const base = { page, pixel, businessName: f.businessName || page.payload.businessName || 'העסק', facts: f, businessUrl: business ? '/p/' + business.slug : null };
  const describe = async (item, withPhotos) => {
    const profile = V.get(item.vertical), photos = withPhotos ? await catalog.photoIds(page.client_id, item.id) : [];
    return { id: item.id, title: catalog.title(item), price: catalog.priceText(item), deal: profile.dealLabel(item), specs: profile.summary(item), features: item.attributes?.features || [],
      description: item.description, license: profile.license && item.attributes?.licenseNumber ? profile.license.adLine(item.attributes.licenseNumber) : '', active: item.status === 'ACTIVE', closedLabel: catalog.statusLabel(item), noun: profile.item, photos };
  };
  if (page.kind === 'ITEM') {
    const item = await catalog.get(page.client_id, page.catalog_item_id).catch(() => null);
    return { ...base, item: item && (item.status !== 'ACTIVE' || !item.consent_required || item.owner_consent) ? await describe(item, true) : null };
  }
  if (page.kind === 'BUSINESS') {
    const rows = (await db.query(`SELECT i.*,l.slug AS page_slug,(SELECT f.id FROM catalog_item_photos f WHERE f.client_id=i.client_id AND f.item_id=i.id ORDER BY f.created_at LIMIT 1) AS cover
      FROM catalog_items i JOIN landing_pages l ON l.catalog_item_id=i.id AND l.kind='ITEM' AND l.status='PUBLISHED'
      WHERE i.client_id=$1 AND i.status='ACTIVE' AND (NOT i.consent_required OR i.owner_consent) ORDER BY i.updated_at DESC LIMIT 30`, [page.client_id])).rows;
    const items = [];
    for (const r of rows) items.push({ ...(await describe(r, false)), url: '/p/' + r.page_slug, cover: r.cover ? `/p/${r.page_slug}/photo/${r.cover}` : null });
    return { ...base, items };
  }
  return base;
}
// A photo of an active item, only through that item's published page.
async function photo(slug, photoId) {
  const page = await get(slug);
  if (page.kind !== 'ITEM' || !UUID.test(String(photoId || ''))) throw Error('PHOTO_NOT_FOUND');
  const item = await require('./catalog').get(page.client_id, page.catalog_item_id);
  if (item.status !== 'ACTIVE') throw Error('PHOTO_NOT_FOUND');
  return require('./catalog').photo(page.client_id, item.id, photoId);
}

function form(v, itemTitle) {
  const name = escape(v.businessName);
  return `<section class="card" aria-labelledby="form-title"><h2 id="form-title">${itemTitle ? 'רוצים לשמוע עוד על ' + escape(itemTitle) + '?' : escape(v.page.payload.cta || 'השאירו פרטים ונחזור אליכם')}</h2>
<p class="muted">שדות שמסומנים בכוכבית (*) הם חובה.</p>
<form id="contact-form" novalidate>
<div class="field"><label for="f-name">שם מלא *</label><input id="f-name" name="name" required maxlength="120" autocomplete="name" aria-describedby="f-name-error"><span class="error" id="f-name-error"></span></div>
<div class="field"><label for="f-phone">טלפון *</label><input id="f-phone" name="phone" required maxlength="30" inputmode="tel" autocomplete="tel" dir="ltr" aria-describedby="f-phone-error"><span class="error" id="f-phone-error"></span></div>
<div class="field"><label for="f-email">דוא״ל (לא חובה)</label><input id="f-email" name="email" type="email" maxlength="254" autocomplete="email" dir="ltr" aria-describedby="f-email-error"><span class="error" id="f-email-error"></span></div>
<div class="hp" aria-hidden="true"><label for="f-website">Website</label><input id="f-website" name="website" tabindex="-1" autocomplete="off"></div>
<div class="field check"><input type="checkbox" id="f-consent" name="consent" required aria-describedby="f-consent-error"><label for="f-consent">אני מסכים/ה שהפרטים יועברו ל־${name} כדי לחזור אליי בנוגע לפנייה. <a href="/privacy">מדיניות הפרטיות</a> *</label><span class="error" id="f-consent-error"></span></div>
<button type="submit">שליחת הפנייה</button>
</form><p id="form-status" role="status" aria-live="polite"></p></section>`;
}
function itemCard(i) {
  return `<li class="item">${i.cover ? `<img src="${escape(i.cover)}" alt="" loading="lazy" width="400" height="300">` : ''}<div><h3><a href="${escape(i.url)}">${escape(i.title)}</a></h3>${i.price || i.deal ? `<p class="price">${escape([i.price, i.deal].filter(Boolean).join(' · '))}</p>` : ''}${i.specs.length ? `<p>${escape(i.specs.join(' · '))}</p>` : ''}</div></li>`;
}
function render(v) {
  const p = v.page, f = v.facts, name = escape(v.businessName);
  let title = name, main = '';
  if (p.kind === 'ITEM') {
    const i = v.item;
    if (!i) main = `<h1>הדף לא זמין כרגע</h1><p>${v.businessUrl ? `<a href="${escape(v.businessUrl)}">לכל מה ש־${name} מציע</a>` : ''}</p>`;
    else {
      title = escape(i.title) + ' · ' + name;
      const gallery = i.active && i.photos.length ? `<ul class="gallery">${i.photos.map((id, n) => `<li><img src="/p/${escape(p.slug)}/photo/${escape(id)}" alt="תמונה ${n + 1} של ${escape(i.title)}" loading="${n ? 'lazy' : 'eager'}" width="800" height="600"></li>`).join('')}</ul>` : '';
      main = `<p class="eyebrow">${name}</p><h1>${escape(i.title)}</h1>${i.price || i.deal ? `<p class="price">${escape([i.price, i.deal].filter(Boolean).join(' · '))}</p>` : ''}${gallery}
${i.specs.length ? `<p>${escape(i.specs.join(' · '))}</p>` : ''}${i.features.length ? `<ul class="features">${i.features.map((x) => `<li>${escape(x)}</li>`).join('')}</ul>` : ''}${i.description ? `<p>${escape(i.description)}</p>` : ''}${i.license ? `<p class="muted">${escape(i.license)}</p>` : ''}
${i.active ? form(v, i.title) : `<p class="notice" role="status">ה${escape(i.noun)} הזה כבר לא זמין (${escape(i.closedLabel)}).</p>${v.businessUrl ? `<p><a href="${escape(v.businessUrl)}">לכל מה ש־${name} מציע</a></p>` : ''}`}
${v.businessUrl ? `<p><a href="${escape(v.businessUrl)}">← חזרה לדף של ${name}</a></p>` : ''}`;
    }
  } else if (p.kind === 'BUSINESS') {
    const about = [f.businessType, f.serviceArea && 'אזור שירות: ' + f.serviceArea, f.advantage].filter(Boolean).map((x) => `<p>${escape(x)}</p>`).join('');
    main = `<h1>${name}</h1>${about}${v.items?.length ? `<section aria-labelledby="items-title"><h2 id="items-title">מה אנחנו מציעים</h2><ul class="items">${v.items.map(itemCard).join('')}</ul></section>` : ''}${form(v, null)}`;
  } else {
    title = escape(p.payload.title || v.businessName);
    main = `<p class="eyebrow">${name}</p><h1>${escape(p.payload.title)}</h1><p>${escape(p.payload.body)}</p>${form(v, null)}`;
  }
  const banner = v.pixel ? `<div id="measure-banner" class="banner" role="region" aria-label="הסכמה למדידה" hidden><p>נשמח להשתמש בפיקסל של Meta כדי למדוד אילו מודעות מביאות פניות. זה לא חובה.</p><div class="row"><button type="button" data-measure="yes">מאשר/ת</button><button type="button" class="secondary" data-measure="no">לא, תודה</button></div></div>` : '';
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="${name}"><link rel="stylesheet" href="/landing.css"><script defer src="/landing.js"></script></head>
<body${v.pixel ? ` data-pixel="${escape(v.pixel)}"` : ''}><a class="skip" href="#main">דילוג לתוכן</a><main id="main">${main}</main>
<footer><p>הטופס מופעל באמצעות SCORPIO AI · <a href="/privacy">מדיניות פרטיות</a> · <a href="/accessibility">הצהרת נגישות</a>${p.payload.privacyContact ? ' · לפניות בנושא פרטיות: ' + escape(p.payload.privacyContact) : ''}</p></footer>${banner}</body></html>`;
}
function csp(pixel) {
  return pixel
    ? "default-src 'none'; script-src 'self' https://connect.facebook.net; style-src 'self'; img-src 'self' https://www.facebook.com; connect-src 'self' https://www.facebook.com https://connect.facebook.net; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    : "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
}

// A form submission from any published page (custom, business or item).
async function submit(slug, input, { ip = null, userAgent = null } = {}) {
  const page = await get(slug);
  if (input?.consent !== true || input?.website || !UUID.test(input?.eventId || '')) throw Error('INVALID_LEAD_FORM');
  const consent = input.measurementConsent === true && !!(await pixelFor(page.client_id));
  const a = require('./leadIntake').attribution({ ...(input.utm && typeof input.utm === 'object' ? input.utm : {}), fbp: input.fbp, fbc: input.fbc }, { consent });
  let itemId = page.kind === 'ITEM' ? page.catalog_item_id : null;
  if (itemId) {
    const item = await require('./catalog').get(page.client_id, itemId).catch(() => null);
    if (item?.status !== 'ACTIVE') throw Error('ITEM_NOT_AVAILABLE');
  }
  const pageUrl = typeof input.page === 'string' && input.page.startsWith(urlOf(slug)) ? input.page.slice(0, 500) : urlOf(slug);
  return require('./leadIntake').saveLead(page.client_id, {
    name: input.name, phone: input.phone || null, email: input.email || null, note: '',
    source: 'landing:' + page.id, sourceEventId: input.eventId, campaignId: a.campaignId || page.payload.campaignId || null
  }, { catalogItemId: itemId, adId: a.adId, utm: a.utm, landingPageId: page.id, measurementConsent: consent, capi: consent ? { eventId: input.eventId, url: pageUrl, ip, userAgent } : null });
}

// ---------- WhatsApp: "הדף שלי", "פרסם דף" ----------
const SHOW = /^(?:הדף שלי|דף נחיתה|עמוד נחיתה|דף העסק|הדף של העסק|דף מכירה|עמוד מכירה|הדפים שלי)[?]?$/;
const PUBLISH = /^(?:פרסם|תפרסם|לפרסם)(?: את)? (?:ה)?(?:דף|דפים|עמוד|עמודים)(?: ה?נחיתה| ה?מכירה| ה?עסק)?$/;
const WHY = {
  NO_AGREEMENT: 'עוד אין הסכם עבודה שמאפשר לי לפרסם לבד',
  PAUSED: 'הפעולות האוטומטיות עצורות כרגע',
  NOT_ALLOWED: 'הסכם העבודה לא מאפשר לי לפרסם תוכן לבד',
  REGISTRATION_REQUIRED: 'צריך קודם להשלים הרשמה בדשבורד (שם ואימייל), כדי שיופיע מי מפעיל את הטופס'
};
function pendingText(why) { return `📄 הכנתי דף לעסק, והוא עוד לא באוויר: ${WHY[why] || 'צריך את האישור שלך'}.\nלפרסום כתוב: פרסם דף`; }
async function handleText(clientId, t) {
  if (SHOW.test(t)) {
    const r = await businessPage(clientId);
    if (r.published) return { reply: `🌐 הדף של העסק באוויר:\n${r.url}\n\nכל מי שמשאיר בו פרטים נכנס אצלך ללידים, ואני מודיע לך מיד. לכל נכס/מוצר שמשווק יש גם דף משלו.` };
    return { reply: r.why === 'REGISTRATION_REQUIRED' ? pendingText(r.why).split('\n')[0] : pendingText(r.why) };
  }
  if (PUBLISH.test(t)) {
    await ensure(clientId, 'BUSINESS');
    try {
      const out = await publishDrafts(clientId), live = await list(clientId);
      const biz = live.find((x) => x.kind === 'BUSINESS');
      return { reply: `✅ ${out.length ? 'פרסמתי' : 'הדפים כבר באוויר'}. הדף של העסק:\n${biz?.url}\n${live.filter((x) => x.kind === 'ITEM' && x.url).slice(0, 5).map((x) => `• ${x.item_title}: ${x.url}`).join('\n')}`.trim() };
    } catch (e) {
      if (e.message === 'REGISTRATION_REQUIRED') return { reply: '✋ ' + WHY.REGISTRATION_REQUIRED + '. כתוב "דשבורד" ואשלח לך קישור.' };
      throw e;
    }
  }
  return null;
}
// One line for the catalog "saved and marketed" message.
function itemLine(r) {
  if (!r) return '';
  if (r.published) return `🌐 הדף שלו באוויר: ${r.url}`;
  return r.why === 'REGISTRATION_REQUIRED' ? '📄 הכנתי לו דף מכירה. כדי לפרסם אותו צריך להשלים הרשמה בדשבורד.' : '📄 הכנתי לו דף מכירה (עוד לא באוויר). לפרסום כתוב: פרסם דף';
}

module.exports = { SLUG, ensure, publish, publishDrafts, decide, businessPage, onItemActive, list, get, view, photo, render, csp, submit, handleText, itemLine, pixelFor };
