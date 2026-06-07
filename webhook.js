const express = require('express');
const router = express.Router();
const { logger } = require('../utils/logger');
const { handleIncomingMessage } = require('../services/messageHandler');

// ── GET /webhook — Meta verification challenge ────────────
router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  logger.info('Webhook verification attempt', { mode, token });

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    logger.info('✅ Webhook verified successfully');
    return res.status(200).send(challenge);
  }

  logger.warn('❌ Webhook verification failed — token mismatch');
  return res.status(403).json({ error: 'Verification failed' });
});

// ── POST /webhook — Incoming WhatsApp messages ────────────
router.post('/', async (req, res) => {
  // Always respond 200 immediately (Meta requires < 5s response)
  res.status(200).send('EVENT_RECEIVED');

  try {
    const body = req.body;

    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;

        const value = change.value;
        const messages = value.messages || [];
        const contacts = value.contacts || [];

        for (const message of messages) {
          const contact = contacts.find(c => c.wa_id === message.from) || {};
          await handleIncomingMessage(message, contact, value.metadata);
        }
      }
    }
  } catch (err) {
    logger.error('Webhook processing error', { error: err.message, stack: err.stack });
  }
});

module.exports = router;
