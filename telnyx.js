const router = require('express').Router();
const { logger } = require('./logger');
const store = require('./telnyxMessageStore');
const { verifyTelnyxSignature, extractIncomingMessage, hasValidAdminToken } = require('./telnyxSecurity');

const RETENTION_MINUTES = 15;

router.post('/webhook', async (req, res) => {
  const valid = verifyTelnyxSignature({
    publicKey: process.env.TELNYX_PUBLIC_KEY,
    signature: req.get('telnyx-signature-ed25519'),
    timestamp: req.get('telnyx-timestamp'),
    rawBody: req.rawBody
  });
  if (!valid) {
    logger.warn('Rejected Telnyx webhook: signature verification failed');
    return res.sendStatus(401);
  }

  if (req.body?.data?.event_type !== 'message.received') return res.sendStatus(200);

  const message = extractIncomingMessage(req.body);
  if (!message) {
    logger.warn('Rejected Telnyx webhook: invalid inbound message event');
    return res.sendStatus(400);
  }

  const configuredNumber = String(process.env.TELNYX_PHONE_NUMBER || '').replace(/\D/g, '');
  if (configuredNumber && message.to.replace(/\D/g, '') !== configuredNumber) {
    logger.warn('Ignored Telnyx inbound message for an unconfigured destination');
    return res.sendStatus(200);
  }

  try {
    const inserted = await store.saveIncomingMessage(message);
    logger.info('Telnyx inbound SMS received', { duplicate: !inserted });
    return res.sendStatus(200);
  } catch {
    logger.error('Telnyx inbound SMS could not be stored');
    return res.sendStatus(503);
  }
});

router.get('/messages', async (req, res) => {
  if (!hasValidAdminToken(req.get('authorization'), process.env.TELNYX_SMS_ADMIN_TOKEN)) {
    return res.sendStatus(401);
  }

  res.set('Cache-Control', 'no-store, private');
  res.set('Pragma', 'no-cache');
  try {
    const messages = await store.listRecentMessages();
    return res.json({ messages, retentionMinutes: RETENTION_MINUTES });
  } catch {
    logger.error('Telnyx inbound SMS could not be read');
    return res.status(503).json({ error: 'SMS inbox temporarily unavailable' });
  }
});

module.exports = router;
