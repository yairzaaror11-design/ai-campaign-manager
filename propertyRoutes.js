'use strict';
// Dashboard API for properties (נכסים). Mounted under /app/api/properties after the
// portal session check; every call runs in the session client's tenant context and
// every query is scoped by that client id.
const router = require('express').Router();
const props = require('./properties');

const MESSAGES = {
  PROPERTY_NOT_FOUND: [404, 'הנכס לא נמצא. רעננו את המסך.'],
  PHOTO_NOT_FOUND: [404, 'התמונה לא נמצאה.'],
  PROPERTY_STALE: [409, 'הנכס עודכן במקום אחר. רעננו את המסך ונסו שוב.'],
  PROPERTY_CONSENT_REQUIRED: [409, 'אי אפשר לשווק נכס בלי הסכמה של בעל הנכס. סמנו שיש הסכמה ונסו שוב.'],
  PROPERTY_INCOMPLETE: [409, 'חסרים פרטים כדי לשווק את הנכס: סוג עסקה, עיר, מחיר, חדרים ורישיון תיווך.'],
  PROPERTY_CLOSED: [409, 'הנכס כבר סומן כנמכר או מושכר.'],
  INVALID_LICENSE: [400, 'מספר רישיון התיווך צריך להיות מספר בלבד.'],
  INVALID_PHOTO: [400, 'אפשר להעלות רק תמונה (JPG או PNG).'],
  INVALID_ATTACHMENT: [400, 'אפשר להעלות רק תמונה (JPG או PNG) עד 1.5MB.'],
  TOO_MANY_PHOTOS: [409, `אפשר לשמור עד ${props.MAX_PHOTOS} תמונות לנכס.`],
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
const fields = (b = {}) => {
  const out = {};
  for (const k of ['dealType', 'kind', 'address', 'city', 'neighbourhood', 'price', 'rooms', 'sizeSqm', 'floor', 'description', 'licenseNumber', 'features']) if (b[k] !== undefined) out[k] = b[k];
  if (typeof out.features === 'string') out.features = out.features.split(',').map((x) => x.trim()).filter(Boolean);
  return out;
};
const view = (p) => ({
  id: p.id, title: props.title(p), price: p.price, priceText: props.priceText(p), dealType: p.deal_type, kind: p.property_kind,
  address: p.address, city: p.city, neighbourhood: p.neighbourhood, rooms: p.rooms, sizeSqm: p.size_sqm, floor: p.floor,
  features: p.features || [], description: p.description, licenseNumber: p.license_number, consent: p.owner_consent, consentAt: p.owner_consent_at,
  status: p.status, statusLabel: props.STATUS_LABEL[p.status], leads: p.leads ?? 0, photos: p.photos ?? 0, coverPhotoId: p.cover_photo_id || null,
  scheduledPosts: p.scheduled_posts ?? 0, campaignId: p.meta_campaign_id, campaignPrepared: !!p.campaign_task_id, version: p.version, missing: props.missing(p)
});
// Applies consent and the requested market status after a save.
async function finish(clientId, p, body) {
  if (typeof body.consent === 'boolean' && body.consent !== p.owner_consent) p = await props.setConsent(clientId, p.id, body.consent);
  if (body.activate === true && p.status !== 'ACTIVE') p = await props.activate(clientId, p.id);
  if (body.activate === false && p.status === 'ACTIVE') p = await props.pause(clientId, p.id);
  return view((await props.list(clientId)).find((x) => x.id === p.id) || await props.get(clientId, p.id));
}

router.get('/', endpoint(async (req) => {
  const id = req.portal.clientId, list = await props.list(id);
  let campaignStatus = {};
  if (list.some((p) => p.meta_campaign_id)) {
    try { campaignStatus = Object.fromEntries(((await require('./dashboardFeed').campaigns(id))?.campaigns || []).map((c) => [String(c.id), c.status])); } catch { campaignStatus = {}; }
  }
  const license = list.find((p) => p.license_number)?.license_number || (await require('./marketingStore').load(id).catch(() => null))?.brokerLicense || '';
  return { properties: list.map((p) => ({ ...view(p), campaignStatus: p.meta_campaign_id ? campaignStatus[p.meta_campaign_id] || null : null })), license };
}));
router.post('/', endpoint(async (req) => finish(req.portal.clientId, await props.create(req.portal.clientId, fields(req.body)), req.body || {})));
router.patch('/:id', endpoint(async (req) => finish(req.portal.clientId, await props.update(req.portal.clientId, req.params.id, fields(req.body), { version: req.body?.version }), req.body || {})));
router.post('/:id/close', endpoint(async (req) => {
  const r = await props.close(req.portal.clientId, req.params.id, req.body?.outcome);
  return { reply: r.reply, stoppedPosts: r.stoppedPosts || 0, pauseActionId: r.approval?.actionId || null };
}));
router.post('/:id/campaign', require('./rateLimit').middleware('property-campaign', 10), endpoint(async (req) => {
  const r = await props.prepareCampaign(req.portal.clientId, req.params.id, { channel: 'PORTAL', requestId: `portal-property:${req.params.id}:${Date.now()}` });
  return { reply: r.reply, blocked: r.blocked || null, metaConnected: r.metaConnected ?? null };
}));
router.post('/:id/posts', require('./rateLimit').middleware('property-posts', 10), endpoint(async (req) => {
  const r = await props.preparePosts(req.portal.clientId, req.params.id);
  return { reply: r.reply, blocked: r.blocked || null, count: r.count || 0 };
}));
router.post('/:id/leads', endpoint(async (req) => props.linkLead(req.portal.clientId, req.params.id, req.body?.leadId)));
router.post('/:id/campaign-link', endpoint(async (req) => view(await props.linkCampaign(req.portal.clientId, req.params.id, req.body?.campaignId))));
router.get('/:id/photos', endpoint(async (req) => { await props.get(req.portal.clientId, req.params.id); return { photos: await props.photoIds(req.portal.clientId, req.params.id) }; }));
router.get('/:id/photos/:photoId', endpoint(async (req, res) => {
  const image = await props.photo(req.portal.clientId, req.params.id, req.params.photoId);
  res.set('Cache-Control', 'private, max-age=3600').type(image.mimeType).send(image.buffer);
}));
router.post('/:id/photos', require('./rateLimit').middleware('property-photo', 60), endpoint(async (req) => {
  const image = require('./portalAttachment').decode(req.body || {});
  return props.addPhoto(req.portal.clientId, req.params.id, image);
}));
router.delete('/:id/photos/:photoId', endpoint(async (req) => { await props.deletePhoto(req.portal.clientId, req.params.id, req.params.photoId); return { ok: true }; }));

module.exports = router;
