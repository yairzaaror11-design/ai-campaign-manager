const crypto = require('crypto');
const router = require('express').Router();
const { logger } = require('./logger');
const { extractInboundEvents, enqueueInboundEvents } = require('./whatsappInboundStore');

function isValidMetaSignature(req) {
  const appSecret = process.env.META_APP_SECRET;
  const signature = req.get('x-hub-signature-256');

  if (!appSecret || !signature || !req.rawBody) return false;

  const expectedSignature =
    'sha256=' +
    crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');

  const received = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  return received.length === expected.length &&
    crypto.timingSafeEqual(received, expected);
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

  if (req.body?.object !== 'whatsapp_business_account') {
    return res.status(200).send('EVENT_RECEIVED');
  }

  try {
    const events = extractInboundEvents(req.body);
    await require('./db').transaction(async tx=>{
      await enqueueInboundEvents(events,tx);
      await require('./whatsappDelivery').ingestReceipts(req.body,tx);
    });
    return res.status(200).send('EVENT_RECEIVED');
  } catch (error) {
    const invalidPayload = error.code === 'INVALID_WHATSAPP_EVENT';
    logger.error('WhatsApp webhook could not be durably queued', {
      category: invalidPayload ? 'INVALID_EVENT' : 'QUEUE_UNAVAILABLE'
    });
    return res.sendStatus(invalidPayload ? 400 : 503);
  }
});

module.exports = router;
