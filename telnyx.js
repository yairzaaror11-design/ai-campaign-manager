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

router.get('/inbox', (req, res) => {
  res.set('Cache-Control', 'no-store, private');
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  res.type('html').send(`<!doctype html>
<html lang="he" dir="rtl">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>תיבת SMS מאובטחת</title>
<style>body{font:16px system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 18px;color:#171717}form{display:flex;gap:8px}input{flex:1;padding:10px}button{padding:10px 16px}article{border:1px solid #ddd;border-radius:10px;padding:14px;margin:12px 0;white-space:pre-wrap;overflow-wrap:anywhere}small{color:#666}</style>
<h1>הודעות SMS נכנסות</h1>
<p>ההודעות נשמרות עד 15 דקות. הזן את מפתח הגישה של בעל המערכת.</p>
<form id="login"><input id="token" type="password" autocomplete="off" placeholder="מפתח גישה" required><button>הצג הודעות</button></form>
<p id="status" role="status"></p><main id="messages"></main>
<script>
document.getElementById('login').addEventListener('submit', async (event) => {
  event.preventDefault();
  const tokenInput = document.getElementById('token');
  const token = tokenInput.value;
  tokenInput.value = '';
  const status = document.getElementById('status');
  const container = document.getElementById('messages');
  container.replaceChildren();
  status.textContent = 'טוען הודעות...';
  try {
    const response = await fetch('/telnyx/messages', { headers: { Authorization: \`Bearer ${token}\` }, cache: 'no-store' });
    if (!response.ok) throw new Error('auth');
    const result = await response.json();
    for (const message of result.messages) {
      const card = document.createElement('article');
      const meta = document.createElement('small');
      meta.textContent = \`${message.received_at} | מאת ${message.from_number} | אל ${message.to_number}\`;
      const body = document.createElement('p');
      body.textContent = message.message_text;
      card.append(meta, body);
      container.append(card);
    }
    status.textContent = result.messages.length ? \`מוצגות הודעות שטרם פג תוקפן (${result.retentionMinutes} דקות).\` : 'אין הודעות פעילות כרגע.';
  } catch {
    status.textContent = 'הגישה נדחתה או שתיבת ההודעות אינה זמינה.';
  }
});
</script></html>`);
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
