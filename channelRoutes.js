'use strict';
// Dashboard API for channels (mounted at /app/api/channels after portal authentication):
// automatic publishing status, Meta Pixel id, lead webhook, business/item pages.
const router = require('express').Router();
const db = require('./db');
const ERRORS = { INVALID_PIXEL: 'מזהה פיקסל הוא מספר של 5 עד 20 ספרות, מתוך מנהל האירועים של Meta.', REGISTRATION_REQUIRED: 'כדי לפרסם דף צריך קודם להשלים הרשמה (שם ואימייל) במסך ההגדרות.', INVALID_LANDING: 'הדף לא נמצא.', LANDING_NOT_FOUND: 'הדף לא נמצא.' };
const endpoint = (handler) => async (req, res) => {
  try { await require('./metaConnection').context.run(String(req.portal.clientId), () => handler(req, res)); }
  catch (e) { res.status(400).json({ error: ERRORS[e.message] || 'לא הצלחנו להשלים את הפעולה. נסו שוב.' }); }
};

router.get('/', endpoint(async (req, res) => {
  const id = req.portal.clientId;
  const ch = (await db.query('SELECT pixel_id FROM business_channels WHERE client_id=$1', [id])).rows[0];
  const metaConnected = (await db.query('SELECT 1 FROM meta_connections WHERE client_id=$1 AND expires_at>NOW()', [id]).catch(() => ({ rows: [] }))).rows.length > 0;
  const intake = require('./leadIntake');
  res.json({
    pixelId: ch?.pixel_id || null,
    conversionsApi: { enabled: require('./metaCrmFeedback').webEnabled(), metaConnected },
    webhook: await intake.webhookInfo(id),
    autopublish: await require('./socialPublisher').status(id),
    pages: await require('./landingPages').list(id),
    dmLeads: { enabled: intake.dmEnabled(), permissions: intake.DM_PERMISSIONS }
  });
}));
router.post('/pixel', endpoint(async (req, res) => {
  const v = req.body?.pixelId == null || req.body.pixelId === '' ? null : String(req.body.pixelId).trim();
  if (v !== null && !/^[0-9]{5,20}$/.test(v)) throw Error('INVALID_PIXEL');
  await db.query(`INSERT INTO business_channels(client_id,pixel_id) VALUES($1,$2) ON CONFLICT(client_id) DO UPDATE SET pixel_id=$2,updated_at=NOW()`, [req.portal.clientId, v]);
  await db.query("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'META_PIXEL',$2)", [req.portal.clientId, v ? 'SET' : 'CLEARED']);
  res.json({ pixelId: v });
}));
router.post('/webhook', endpoint(async (req, res) => res.json(await require('./leadIntake').rotateWebhook(req.portal.clientId))));
router.post('/autopublish/check', endpoint(async (req, res) => res.json(await require('./socialPublisher').status(req.portal.clientId, { check: true }))));
router.post('/pages/business', endpoint(async (req, res) => res.json(await require('./landingPages').businessPage(req.portal.clientId))));
// The owner's explicit tap publishes a draft page (also when the agreement does not allow it alone).
router.post('/pages/:id/publish', endpoint(async (req, res) => res.json(await require('./landingPages').publish(req.portal.clientId, req.params.id))));

module.exports = router;
