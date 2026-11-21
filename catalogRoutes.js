'use strict';
// Dashboard API for "what I sell" (מה אני מוכר). Mounted under /app/api/catalog after the
// portal session check; every call runs in the session client's tenant context and
// every query is scoped by that client id.
const router = require('express').Router();
const catalog = require('./catalog');
const V = require('./verticalProfiles');

const MESSAGES = {
  ITEM_NOT_FOUND: [404, 'הפריט לא נמצא. רעננו את המסך.'],
  PHOTO_NOT_FOUND: [404, 'התמונה לא נמצאה.'],
  ITEM_STALE: [409, 'הפריט עודכן במקום אחר. רעננו את המסך ונסו שוב.'],
  ITEM_CONSENT_REQUIRED: [409, 'אי אפשר לשווק בלי הסכמה של בעל הנכס. סמנו שיש הסכמה ונסו שוב.'],
  ITEM_INCOMPLETE: [409, 'חסרים פרטי חובה כדי לשווק. השלימו את השדות המסומנים ונסו שוב.'],
  ITEM_CLOSED: [409, 'הפריט כבר סומן כנמכר, אזל או הסתיים.'],
  INVALID_LICENSE: [400, 'מספר הרישיון צריך להיות מספר בלבד.'],
  INVALID_VERTICAL: [400, 'בחרו סוג עסק מהרשימה.'],
  INVALID_PHOTO: [400, 'אפשר להעלות רק תמונה (JPG או PNG).'],
  INVALID_ATTACHMENT: [400, 'אפשר להעלות רק תמונה (JPG או PNG) עד 1.5MB.'],
  TOO_MANY_PHOTOS: [409, `אפשר לשמור עד ${catalog.MAX_PHOTOS} תמונות לפריט.`],
  LEAD_NOT_FOUND_OR_STALE: [409, 'הליד לא נמצא. רעננו את המסך.']
};
const endpoint = (work) => async (req, res) => {
  try {
    await require('./metaConnection').context.run(String(req.portal.clientId), async () => {
      const out = await work(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    });
  } catch (error) {
    const [status, message] = MESSAGES[error.message] || [400, 'משהו לא עבד. בדקו את הפרטים ונסו שוב.'];
    if (!res.headersSent) res.status(status).json({ error: message });
  }
};
const input = (b = {}) => {
  const out = {};
  for (const k of ['kind', 'title', 'price', 'description', 'licenseNumber']) if (b[k] !== undefined) out[k] = b[k];
  if (b.attributes && typeof b.attributes === 'object' && !Array.isArray(b.attributes)) out.attributes = b.attributes;
  return out;
};
const view = (i) => ({
  id: i.id, vertical: i.vertical, kind: i.kind, title: catalog.title(i), rawTitle: i.title, price: i.price, priceText: catalog.priceText(i), dealLabel: V.get(i.vertical).dealLabel(i),
  description: i.description, attributes: i.attributes || {}, consentRequired: i.consent_required, consent: i.owner_consent, consentAt: i.owner_consent_at,
  status: i.status, statusLabel: catalog.statusLabel(i), closedReason: i.closed_reason, leads: i.leads ?? 0, photos: i.photos ?? 0, coverPhotoId: i.cover_photo_id || null,
  scheduledPosts: i.scheduled_posts ?? 0, campaignId: i.meta_campaign_id, campaignPrepared: !!i.campaign_task_id, version: i.version, missing: catalog.missing(i)
});
async function finish(clientId, item, body) {
  if (typeof body.consent === 'boolean' && item.consent_required && body.consent !== item.owner_consent) item = await catalog.setConsent(clientId, item.id, body.consent);
  if (body.activate === true && item.status !== 'ACTIVE') item = await catalog.activate(clientId, item.id);
  if (body.activate === false && item.status === 'ACTIVE') item = await catalog.pause(clientId, item.id);
  return view((await catalog.list(clientId)).find((x) => x.id === item.id) || await catalog.get(clientId, item.id));
}

router.get('/', endpoint(async (req) => {
  const id = req.portal.clientId, d = await V.detect(id), list = await catalog.list(id);
  let campaignStatus = {};
  if (list.some((i) => i.meta_campaign_id)) {
    try { campaignStatus = Object.fromEntries(((await require('./dashboardFeed').campaigns(id))?.campaigns || []).map((c) => [String(c.id), c.status])); } catch { campaignStatus = {}; }
  }
  const profile = V.get(d.key);
  return { vertical: V.describe(d.key, d.known), license: await catalog.businessLicense(id, profile), items: list.map((i) => ({ ...view(i), campaignStatus: i.meta_campaign_id ? campaignStatus[i.meta_campaign_id] || null : null })) };
}));
router.post('/vertical', endpoint(async (req) => { const p = await V.choose(req.portal.clientId, req.body?.vertical); return V.describe(p.key, true); }));
router.post('/', endpoint(async (req) => finish(req.portal.clientId, await catalog.create(req.portal.clientId, input(req.body)), req.body || {})));
router.patch('/:id', endpoint(async (req) => finish(req.portal.clientId, await catalog.update(req.portal.clientId, req.params.id, input(req.body), { version: req.body?.version }), req.body || {})));
router.post('/:id/close', endpoint(async (req) => {
  const r = await catalog.close(req.portal.clientId, req.params.id, req.body?.outcome);
  return { reply: r.reply, stoppedPosts: r.stoppedPosts || 0, pauseActionId: r.approval?.actionId || null };
}));
router.post('/:id/campaign', require('./rateLimit').middleware('catalog-campaign', 10), endpoint(async (req) => {
  const r = await catalog.prepareCampaign(req.portal.clientId, req.params.id, { channel: 'PORTAL', requestId: `portal-catalog:${req.params.id}:${Date.now()}` });
  return { reply: r.reply, blocked: r.blocked || null, metaConnected: r.metaConnected ?? null };
}));
router.post('/:id/posts', require('./rateLimit').middleware('catalog-posts', 10), endpoint(async (req) => {
  const r = await catalog.preparePosts(req.portal.clientId, req.params.id);
  return { reply: r.reply, blocked: r.blocked || null, count: r.count || 0 };
}));
router.post('/:id/leads', endpoint(async (req) => catalog.linkLead(req.portal.clientId, req.params.id, req.body?.leadId)));
router.post('/:id/campaign-link', endpoint(async (req) => view(await catalog.linkCampaign(req.portal.clientId, req.params.id, req.body?.campaignId))));
router.get('/:id/photos', endpoint(async (req) => { await catalog.get(req.portal.clientId, req.params.id); return { photos: await catalog.photoIds(req.portal.clientId, req.params.id) }; }));
router.get('/:id/photos/:photoId', endpoint(async (req, res) => {
  const image = await catalog.photo(req.portal.clientId, req.params.id, req.params.photoId);
  res.set('Cache-Control', 'private, max-age=3600').type(image.mimeType).send(image.buffer);
}));
router.post('/:id/photos', require('./rateLimit').middleware('catalog-photo', 60), endpoint(async (req) => catalog.addPhoto(req.portal.clientId, req.params.id, require('./portalAttachment').decode(req.body || {}))));
router.delete('/:id/photos/:photoId', endpoint(async (req) => { await catalog.deletePhoto(req.portal.clientId, req.params.id, req.params.photoId); return { ok: true }; }));

module.exports = router;
