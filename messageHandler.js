const { isAuthorized } = require('./auth');
const { safeSend } = require('./whatsapp');
const { processWithGemini } = require('./gemini');
const { logger } = require('./logger');

const sessions = new Map();
const pendingPlans = new Map();

function getHistory(phone) {
  if (!sessions.has(phone)) {
    sessions.set(phone, []);
  }
  return sessions.get(phone);
}

function rememberPlans(phone, plans = []) {
  if (!plans.length) return;

  const existing = pendingPlans.get(phone) || [];
  const next = [...existing, ...plans].slice(-10);
  pendingPlans.set(phone, next);
}

async function handleIncomingMessage(message, contact) {
  const from = String(message.from || '');

  if (!isAuthorized(from)) {
    logger.warn('Unauthorized sender rejected');
    await safeSend(
      from,
      'אין הרשאה להשתמש במערכת מהמספר הזה.'
    );
    return;
  }

  if (message.type !== 'text') {
    await safeSend(
      from,
      'בשלב 1 אני מקבל כרגע טקסט. תמונות, וידאו והודעות קוליות יתווספו בשלבים הבאים.'
    );
    return;
  }

  const text = String(
    message.text?.body || ''
  ).trim();

  if (!text) return;

  if (text === '/start') {
    await safeSend(
      from,
      'היי, אני קמפיין בצ׳ט. אני יכול לקרוא נתוני Meta, לנתח קמפיינים ולהכין פעולות לשינוי. כרגע שום שינוי לא מבוצע בפועל.'
    );
    return;
  }

  if (text === '/reset') {
    sessions.delete(from);
    pendingPlans.delete(from);
    await safeSend(
      from,
      'איפסתי את הקשר השיחה.'
    );
    return;
  }

  try {
    const history = getHistory(from);
    const result = await processWithGemini(
      text,
      history
    );

    history.push(
      { role: 'user', content: text },
      { role: 'assistant', content: result.text }
    );

    if (history.length > 24) {
      sessions.set(
        from,
        history.slice(-24)
      );
    }

    rememberPlans(
      from,
      result.actionPlans
    );

    await safeSend(
      from,
      result.text
    );
  } catch (error) {
    logger.error('Message handling failed', {
      error: error.message
    });

    await safeSend(
      from,
      'הייתה תקלה בעיבוד הבקשה. נסה שוב בעוד רגע.'
    );
  }
}

module.exports = {
  handleIncomingMessage
};
