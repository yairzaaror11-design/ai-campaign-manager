const { isAuthorized } = require('./auth');
const { safeSend } = require('./whatsapp');
const { processWithGemini } = require('./gemini');
const { formatActionPlan } = require('./actionPlan');
const {
  createApproval,
  consumeApproval,
  cancelPendingApprovals
} = require('./approvalEngine');
const { executeApprovedAction } = require('./actionExecutor');
const { logger } = require('./logger');

const sessions = new Map();

function getHistory(phone) {
  if (!sessions.has(phone)) sessions.set(phone, []);
  return sessions.get(phone);
}

function approvalInstruction(approval) {
  const expires = new Date(approval.expiresAt);
  const minutes = Math.max(
    1,
    Math.ceil((expires.getTime() - Date.now()) / 60000)
  );

  return [
    '',
    `קוד אישור: *${approval.code}*`,
    `כדי לאשר שלח: *אשר ${approval.code}*`,
    `האישור תקף לכ-${minutes} דקות.`,
    '',
    'כרגע המערכת במצב READ_ONLY, לכן גם אישור תקין לא יבצע שינוי ב-Meta.'
  ].join('\n');
}

async function handleApproval(from, code) {
  const consumed = consumeApproval(from, code);

  if (!consumed.ok) {
    const messages = {
      NOT_FOUND: 'לא מצאתי אישור פעיל עם הקוד הזה.',
      EXPIRED: 'קוד האישור פג. בקש ממני להכין את הפעולה מחדש.',
      ALREADY_USED: 'קוד האישור הזה כבר נוצל ואי אפשר להשתמש בו שוב.'
    };

    await safeSend(
      from,
      messages[consumed.reason] || 'לא ניתן לאשר את הפעולה.'
    );
    return;
  }

  const result = await executeApprovedAction(
    from,
    consumed.approval.actionPlan
  );

  await safeSend(
    from,
    result.message ||
      'האישור נקלט, אך הפעולה לא בוצעה.'
  );
}

async function handleIncomingMessage(message, contact) {
  const from = String(message.from || '');

  if (!isAuthorized(from)) {
    logger.warn('Unauthorized sender rejected');
    await safeSend(from, 'אין הרשאה להשתמש במערכת מהמספר הזה.');
    return;
  }

  if (message.type !== 'text') {
    await safeSend(
      from,
      'בשלב הזה אני מקבל טקסט. תמונות, וידאו והודעות קוליות יתווספו בהמשך.'
    );
    return;
  }

  const text = String(message.text?.body || '').trim();
  if (!text) return;

  if (text === '/start') {
    await safeSend(
      from,
      'היי, אני קמפיין בצ׳ט. אני יכול לקרוא נתוני Meta, לנתח קמפיינים ולהכין פעולות לאישור. פעולות שינוי עדיין חסומות במצב READ_ONLY.'
    );
    return;
  }

  if (text === '/reset') {
    sessions.delete(from);
    cancelPendingApprovals(from);
    await safeSend(from, 'איפסתי את הקשר השיחה וביטלתי אישורים ממתינים.');
    return;
  }

  const approvalMatch = text.match(/^אשר\s+(\d{6})$/);
  if (approvalMatch) {
    await handleApproval(from, approvalMatch[1]);
    return;
  }

  try {
    const history = getHistory(from);
    const result = await processWithGemini(text, history);

    let reply = result.text;

    for (const plan of result.actionPlans || []) {
      if (plan.missing?.length) {
        continue;
      }

      const approval = createApproval(from, plan);
      reply += `\n\n${formatActionPlan(plan)}${approvalInstruction(approval)}`;
    }

    history.push(
      { role: 'user', content: text },
      { role: 'assistant', content: reply }
    );

    if (history.length > 24) {
      sessions.set(from, history.slice(-24));
    }

    await safeSend(from, reply);
  } catch (error) {
    logger.error('Message handling failed', { error: error.message });
    await safeSend(
      from,
      'הייתה תקלה בעיבוד הבקשה. נסה שוב בעוד רגע.'
    );
  }
}

module.exports = { handleIncomingMessage };
