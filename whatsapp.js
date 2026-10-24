const axios = require('axios');
const { logger } = require('./logger');

const base = () =>
  `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v26.0'}`;

async function sendWhatsAppMessage(to, text) {
  if (!process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_ACCESS_TOKEN) {
    throw Error('WhatsApp not configured');
  }

  await axios.post(
    `${base()}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: {
        body: String(text || '').slice(0, 4000),
        preview_url: false
      }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    }
  );
}

async function safeSend(to, text) {
  try {
    await sendWhatsAppMessage(to, text);
  } catch (error) {
    logger.error('WhatsApp send failed', {
      error: error.response?.data?.error?.message || error.message
    });
  }
}

module.exports = { sendWhatsAppMessage, safeSend };
