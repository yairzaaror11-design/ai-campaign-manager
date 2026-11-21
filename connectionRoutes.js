'use strict';
// Dashboard API for the "חיבורים" screen (mounted at /app/api/connections after portal
// authentication). Live status per integration; never returns tokens or secrets.
const router = require('express').Router();
const ERRORS = {
  META_LOGIN_CONFIG_REQUIRED: 'החיבור ל־Meta עוד לא הוגדר בשרת.',
  HTTPS_APP_ORIGIN_REQUIRED: 'החיבור ל־Meta עוד לא הוגדר בשרת.',
  META_ENCRYPTION_KEY_REQUIRED: 'החיבור ל־Meta עוד לא הוגדר בשרת.',
  META_CONNECTION_REQUIRED: 'צריך קודם לחבר את Meta.',
  ACCOUNT_SELECTION_REQUIRED: 'צריך קודם לבחור חשבון מודעות.',
  ACCOUNT_NOT_GRANTED: 'החשבון הזה לא נמצא ברשימה ש־Meta אישרה לך. רענן ונסה שוב.',
  ASSET_NOT_GRANTED: 'הבחירה הזו לא נמצאה ברשימה ש־Meta אישרה לך. רענן ונסה שוב.',
  INVALID_ACCOUNT: 'הבחירה לא תקינה.',
  INVALID_ASSET: 'הבחירה לא תקינה.',
  META_TOKEN_EXPIRED: 'החיבור ל־Meta פג או בוטל. צריך לחבר מחדש.',
  META_PERMISSION_REQUIRED: 'חסרה הרשאה ב־Meta. לחץ על ״תן הרשאה״.'
};
const endpoint = (handler) => async (req, res) => {
  try { await require('./metaConnection').context.run(String(req.portal.clientId), () => handler(req, res)); }
  catch (e) { res.status(400).json({ error: ERRORS[e.message] || 'לא הצלחתי להשלים את הפעולה. נסה שוב בעוד רגע.' }); }
};
const auth = () => require('./metaAuth');

router.get('/', endpoint(async (req, res) => res.json(await auth().connections(req.portal.clientId))));
// Connect / reconnect: a one-time link to the official Meta login (10 minutes).
router.post('/meta/connect', endpoint(async (req, res) => res.json({ url: await require('./metaConnection').createInvite(req.portal.clientId) })));
// "תן הרשאה": the same login, asking again only for the missing permissions.
router.post('/meta/permissions', endpoint(async (req, res) => res.json({ url: await require('./metaConnection').createInvite(req.portal.clientId, { rerequest: true }) })));
router.post('/meta/disconnect', endpoint(async (req, res) => {
  if (req.body?.confirm !== true) return res.sendStatus(400);
  await require('./metaConnection').disconnect(req.portal.clientId);
  await require('./metaConversation').recordStatus(req.portal.clientId, 'DISCONNECTED', { account: null, accounts: [], permissions: [], lastError: null });
  res.json(await auth().connections(req.portal.clientId));
}));
// Live check now: debug_token + permissions (no renewal or WhatsApp notices from here).
router.post('/meta/check', endpoint(async (req, res) => {
  await auth().checkOne(req.portal.clientId, { renew: false, notify: false }).catch(() => null);
  await require('./metaConversation').verify(req.portal.clientId).catch(() => null);
  res.json(await auth().connections(req.portal.clientId));
}));
router.get('/meta/assets', endpoint(async (req, res) => res.json(await auth().assets(req.portal.clientId))));
router.post('/meta/assets', endpoint(async (req, res) => {
  const kind = req.body?.kind;
  if (!['adAccount', 'page', 'instagram', 'pixel'].includes(kind)) throw Error('INVALID_ASSET');
  await auth().selectAsset(req.portal.clientId, kind, req.body?.id);
  res.json(await auth().connections(req.portal.clientId));
}));

module.exports = router;
