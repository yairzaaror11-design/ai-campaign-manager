const axios = require('axios');
const { logger } = require('../utils/logger');

const WA_BASE = 'https://graph.facebook.com/v19.0';
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN    = process.env.WHATSAPP_ACCESS_TOKEN;

/**
 * Send a plain text WhatsApp message
 */
async function sendWhatsAppMessage(to, text) {
  // WhatsApp has a 4096 char limit — chunk if needed
  const chunks = chunkText(text, 4000);

  for (const chunk of chunks) {
    try {
      await axios.post(
        `${WA_BASE}/${PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { body: chunk, preview_url: false }
        },
        {
          headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // Small delay between chunks
      if (chunks.length > 1) await sleep(300);
    } catch (err) {
      logger.error('WhatsApp send error', {
        to,
        error: err.response?.data || err.message
      });
      throw err;
    }
  }
}

/**
 * Send an interactive message with up to 3 quick-reply buttons
 */
async function sendWhatsAppButtons(to, bodyText, buttons) {
  // Max 3 buttons per WhatsApp spec; button title max 20 chars
  const safeButtons = buttons.slice(0, 3).map(b => ({
    type: 'reply',
    reply: {
      id:    b.id.slice(0, 256),
      title: b.title.slice(0, 20)
    }
  }));

  try {
    await axios.post(
      `${WA_BASE}/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText.slice(0, 1024) },
          action: { buttons: safeButtons }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (err) {
    logger.error('WhatsApp buttons send error', {
      to,
      error: err.response?.data || err.message
    });
    // Fallback to plain text
    await sendWhatsAppMessage(to, bodyText);
  }
}

/**
 * Send a list message (for menus with many options)
 */
async function sendWhatsAppList(to, headerText, bodyText, buttonText, sections) {
  try {
    await axios.post(
      `${WA_BASE}/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          header: { type: 'text', text: headerText },
          body: { text: bodyText },
          action: {
            button: buttonText,
            sections
          }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (err) {
    logger.error('WhatsApp list send error', { error: err.response?.data || err.message });
    await sendWhatsAppMessage(to, bodyText);
  }
}

// ── Helpers ────────────────────────────────────────────────
function chunkText(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { sendWhatsAppMessage, sendWhatsAppButtons, sendWhatsAppList };
