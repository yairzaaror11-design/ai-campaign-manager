'use strict';
// Dashboard API for growth (growth.js): funnels, deal value, team, and the after-sale loop.
// Mounted under /app/api/growth after the portal session check; every call runs in the
// session client's tenant context and every query is scoped by that client id.
const router = require('express').Router();
const growth = require('./growth');

const MESSAGES = {
  INVALID_DEAL: [400, 'הסכום לא נראה תקין. צריך מספר בלבד, למשל 2900000.'],
  INVALID_GROWTH_SETTINGS: [400, 'אחד הערכים לא תקין. בדקו ונסו שוב.'],
  INVALID_REVIEW_URL: [400, 'הקישור לביקורות צריך להיות קישור מלא שמתחיל ב־https://'],
  INVALID_TEAM_MEMBER: [400, 'צריך שם (עד 80 תווים). אזורים מופרדים בפסיקים.'],
  INVALID_TEAM_PHONE: [400, 'מספר הטלפון לא נראה תקין. למשל 0501234567.'],
  TEAM_PHONE_EXISTS: [409, 'איש צוות עם המספר הזה כבר קיים.'],
  TEAM_MEMBER_IS_OWNER: [409, 'זה המספר שלך, בעל העסק. אתה ממילא רואה את כל הלידים.'],
  TEAM_MEMBER_NOT_FOUND: [404, 'איש הצוות לא נמצא. רעננו את המסך.'],
  INVALID_OUTREACH: [400, 'הפעולה לא תקינה.'],
  INVALID_LEAD: [400, 'הליד לא תקין.'],
  LEAD_NOT_FOUND_OR_STALE: [409, 'הליד עודכן במקום אחר או לא נמצא. רעננו את המסך.']
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
const id = (req) => req.params.id;

router.get('/', endpoint(async (req) => {
  const clientId = req.portal.clientId;
  const [overview, members, report] = await Promise.all([growth.overview(clientId), growth.members(clientId), growth.teamReport(clientId)]);
  return { ...overview, team: { members, report } };
}));
router.post('/settings', endpoint(async (req) => ({ settings: await growth.saveSettings(req.portal.clientId, req.body || {}) })));
router.post('/cadence', endpoint(async (req) => {
  if (typeof req.body?.approve !== 'boolean') throw Error('INVALID_GROWTH_SETTINGS');
  const s = await growth.approveCadence(req.portal.clientId, req.body.approve);
  return { cadenceApproved: !!s.outreach_approved_at };
}));
router.get('/leads/:id/deal', endpoint(async (req) => growth.termsFor(req.portal.clientId, id(req))));
router.post('/leads/:id/deal', endpoint(async (req) => {
  const r = await growth.recordDeal(req.portal.clientId, id(req), { price: req.body?.price, commissionPct: req.body?.commissionPct });
  return { lead: r.lead, text: r.text };
}));
router.post('/leads/:id/assign', endpoint(async (req) => growth.assign(req.portal.clientId, id(req), req.body?.memberId || null)));
router.post('/leads/:id/consent', endpoint(async (req) => growth.setConsent(req.portal.clientId, id(req), req.body?.consent)));
router.post('/outreach/:id', endpoint(async (req) => {
  const action = req.body?.action;
  if (!['done', 'skip'].includes(action)) throw Error('INVALID_OUTREACH');
  return { ok: !!(await growth.markOutreach(req.portal.clientId, id(req), action === 'done' ? 'LINK_GIVEN' : 'SKIPPED')) };
}));
router.post('/funnels/:key/prepare', require('./rateLimit').middleware('portal-campaign-action', 20), endpoint(async (req) => {
  if (!/^[a-z_]{2,40}$/.test(req.params.key)) throw Error('INVALID_GROWTH_SETTINGS');
  const r = await growth.prepareFunnelCampaign(req.portal.clientId, req.params.key, { channel: 'PORTAL' });
  return { ok: !r.blocked, blocked: r.blocked || null, reply: r.reply };
}));
router.get('/team', endpoint(async (req) => ({ members: await growth.members(req.portal.clientId), report: await growth.teamReport(req.portal.clientId) })));
router.post('/team', endpoint(async (req) => ({ member: await growth.addMember(req.portal.clientId, req.body || {}) })));
router.patch('/team/:id', endpoint(async (req) => ({ member: await growth.updateMember(req.portal.clientId, id(req), req.body || {}) })));

module.exports = router;
