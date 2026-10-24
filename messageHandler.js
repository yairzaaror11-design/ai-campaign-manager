const { isAuthorized } = require('./auth');
const { safeSend } = require('./whatsapp');
const { processWithGemini } = require('./gemini');
const { logger } = require('./logger');
const sessions = new Map();
function history(phone) {
  if (!sessions.has(phone)) sessions.set(phone, []);
  return sessions.get(phone);
}
async function handleIncomingMessage(message, contact) {
  const from = String(message.from || '');
  if (!isAuthorized(from)) {
    logger.warn('Unauthorized sender rejected');
    await safeSend(from, 'אין הרשאה להשתמש במערכת מהמספר הזה.');
    return;
  }
  if (message.type !== 'text') {
    await safeSend(from, 'בגרסת הבדיקה אני מקבל כרגע הודעות טקסט בלבד.');
    return;
  }
  const text = String(message.text?.body || '').trim();
  if (!text) return;
  if (text === '/start') {
    await safeSend(from, 'היי, אני קמפיין בצ׳ט. כרגע אני במצב קריאה בלבד ויכול לבדוק נתוני Meta ולהציע פעולות בלי לבצע שינויים.');
    return;
  }
  try {
    const h = history(from);
    const reply = await processWithGemini(text, h);
    h.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
    if (h.length > 16) sessions.set(from, h.slice(-16));
    await safeSend(from, reply);
  } catch (error) {
    logger.error('Message handling failed', { error: error.message });
    await safeSend(from, 'הייתה תקלה בעיבוד הבקשה. נסה שוב בעוד רגע.');
  }
}
module.exports = { handleIncomingMessage };
