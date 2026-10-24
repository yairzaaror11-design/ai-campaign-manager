const crypto = require('crypto');
const router = require('express').Router();
const { logger } = require('./logger');
const { handleIncomingMessage } = require('./messageHandler');

function isValidMetaSignature(req) {
  const appSecret = process.env.META_APP_SECRET;
  const signature = req.get('x-hub-signature-256');

  if (!appSecret || !signature || !req.rawBody) return false;

  const expectedSignature =
    'sha256=' +
    crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');

  const received = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  return (
    received.length === expected.length &&
    crypto.timingSafeEqual(received, expected)
  );
}

router.get('/', (req, res) => {
  const verified =
    req.query['hub.mode'] === 'subscribe' &&
    process.env.WHATSAPP_VERIFY_TOKEN &&
    req.query['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN;

  return verified
    ? res.status(200).send(req.query['hub.challenge'])
    : res.sendStatus(403);
});

router.post('/', async (req, res) => {
  if (!isValidMetaSignature(req)) {
    logger.warn('Invalid webhook signature');
    return res.sendStatus(401);
  }

  res.status(200).send('EVENT_RECEIVED');

  try {
    if (req.body?.object !== 'whatsapp_business_account') return;

    for (const entry of req.body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;

        const value = change.value || {};

        for (const message of value.messages || []) {
          const contact =
            (value.contacts || []).find((item) => item.wa_id === message.from) ||
            {};

          await handleIncomingMessage(message, contact);
        }
      }
    }
  } catch (error) {
    logger.error('Webhook processing failed', { error: error.message });
  }
});

module.exports = router;
