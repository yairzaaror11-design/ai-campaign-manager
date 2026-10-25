const { isAuthorized } = require('./auth');
const { handleBriefMessage } = require('./briefConversation');
const { handleLifecycleMessage } = require('./lifecycleConversation');
const { configured } = require('./db');
const { safeSend } = require('./whatsapp');
const { processWithGemini } = require('./gemini');
const { formatActionPlan } = require('./actionPlan');
const {
  createApproval,
  consumeApproval,
  cancelPendingApprovals
} = require('./approvalEngine');
const { executeApprovedAction } = require('./actionExecutor');
const { receiveWhatsAppMedia } = require('./mediaHandler');
const { transcribeVoiceMessage } = require('./voiceHandler');
const { logger } = require('./logger');
const {
  getHistory,
  appendMessages,
  resetSession
} = require('./sessionStore');
const { getOrCreateClient } = require('./clientStore');

function approvalInstruction(approval) {
  const minutes = Math.max(
    1,
    Math.ceil((new Date(approval.expiresAt).getTime() - Date.now()) / 60000)
  );

  return [
    '',
    `קוד אישור: *${approval.code}*`,
    `כדי לאשר שלח: *אשר ${approval.code}*`,
    `האישור תקף לכ-${minutes} דקות.`,
    '',
    process.env.READ_ONLY === 'false'
      ? 'לאחר אישור, המערכת עשויה לבצע את הפעולה בחשבון Meta.'
      : 'READ_ONLY פעיל כרגע, לכן האישור ייבדק אך לא ישנה את Meta.'
  ].join('\n');
}

async function handleApproval(from, code) {
  const consumed = await consumeApproval(from, code);

  if (!consumed.ok) {
    const messages = {
      NOT_FOUND: 'לא מצאתי אישור פעיל עם הקוד הזה.',
      EXPIRED: 'קוד האישור פג. בקש להכין את הפעולה מחדש.',
      ALREADY_USED: 'קוד האישור כבר נוצל ואי אפשר להשתמש בו שוב.'
    };
    await safeSend(from, messages[consumed.reason] || 'לא ניתן לאשר את הפעולה.');
    return;
  }

  const result = await executeApprovedAction(from, consumed.approval.actionPlan);
  await safeSend(from, result.message || 'האישור נקלט, אך הפעולה לא בוצעה.');
}

async function handleMedia(from, message) {
  try {
    const media = await receiveWhatsAppMedia(message);
    const kind = media.type === 'image' ? 'תמונה' : 'סרטון';

    const captionText = media.caption
      ? `\nהכיתוב שקיבלתי: "${media.caption}"`
      : '';

    await safeSend(
      from,
      `קיבלתי את ה${kind} בהצלחה.${captionText}\nהקובץ עבר בדיקת סוג וגודל. בשלב הבא נחבר אותו ליצירת קריאייטיב ולהעלאה ל-Meta. כרגע לא פורסם ולא שונה שום קמפיין.`
    );
  } catch (error) {
    logger.error('Media handling failed', { error: error.message });
    await safeSend(
      from,
      'לא הצלחתי לעבד את קובץ המדיה. כרגע נתמכים JPG, PNG, WebP, MP4 ו-MOV בגודל סביר.'
    );
  }
}


async function processNaturalLanguage(from, text, prefix = '') {
  const history = await getHistory(from);
  const result = await processWithGemini(text, history);
  let reply = prefix ? `${prefix}\n\n${result.text}` : result.text;

  for (const plan of result.actionPlans || []) {
    if (plan.missing?.length) continue;
    const approval = await createApproval(from, plan);
    reply += `\n\n${formatActionPlan(plan)}${approvalInstruction(approval)}`;
  }

  await appendMessages(from, [
    { role: 'user', content: text },
    { role: 'assistant', content: reply }
  ]);

  await safeSend(from, reply);
}

async function handleVoice(from, message) {
  try {
    const transcript = await transcribeVoiceMessage(message);
    await routeText(from, transcript, `שמעתי: "${transcript}"`);
  } catch (error) {
    logger.error('Voice handling failed', { error: error.message });
    await safeSend(
      from,
      'לא הצלחתי לתמלל את ההודעה הקולית. נסה לשלוח אותה שוב.'
    );
  }
}

async function handleTenantMessage(message, contact) {
  const from = String(message.from || '');

  if (!isAuthorized(from)) {
    logger.warn('Unauthorized sender rejected');
    await safeSend(from, 'אין הרשאה להשתמש במערכת מהמספר הזה.');
    return;
  }

  await getOrCreateClient(from, contact?.profile?.name || null);

  if (['image', 'video'].includes(message.type)) {
    await handleMedia(from, message);
    return;
  }

  if (message.type === 'audio') {
    await handleVoice(from, message);
    return;
  }

  if (message.type !== 'text') {
    await safeSend(
      from,
      'כרגע אני תומך בטקסט, תמונות, סרטונים והודעות קוליות.'
    );
    return;
  }

  const text = String(message.text?.body || '').trim();
  if (!text) return;
  await routeText(from, text);
}

async function routeText(from, text, prefix = '') {
  const meta = require('./metaConnection');
  if (text.startsWith('/meta-')) {
    try {
      const client = await getOrCreateClient(from);
      let reply;
      if (text === '/meta-delete-data-confirm') {
        await require('./db').transaction(tx=>require('./metaDeletion').deleteClient(client.id,tx));
        reply = 'נתוני הלקוח נמחקו מהמסד הפעיל, כולל שיחות, טיוטות והרשאות. קמפיינים ב־Meta לא שונו.';
      }
      else if (text === '/meta-connect') reply = 'קישור אישי לחיבור Meta (10 דקות, אין להעביר): ' + await meta.createInvite(client.id);
      else if (text === '/meta-accounts') reply = JSON.stringify((await meta.accounts(client.id)).data) + '\nלבחירה: /meta-select act_ID';
      else if (/^\/meta-select act_\d+$/.test(text)) { await meta.selectAccount(client.id,text.split(' ')[1]); reply = 'חשבון המודעות חובר. ניתן להתחיל בריף עם /brief TRAFFIC.'; }
      else if (text === '/meta-disconnect') { await meta.disconnect(client.id); reply = 'החיבור המקומי והטוקן נמחקו. ניתן להסיר את האפליקציה גם בהגדרות Meta.'; }
      else reply = 'פקודות: /meta-connect /meta-accounts /meta-select act_ID /meta-disconnect';
      await safeSend(from,reply);
    } catch { await safeSend(from,'חיבור Meta אינו זמין או שההרשאה פגה. בקש /meta-connect מחדש.'); }
    return;
  }
  if (text === '/start') {
    await safeSend(
      from,
      'היי, אני קמפיין בצ׳ט. אני תומך בטקסט, תמונות, סרטונים והודעות קוליות. מנוע Meta ומנוע האישורים מותקנים, אבל פעולות שינוי עדיין נעולות ב-READ_ONLY.'
    );
    return;
  }

  if (text === '/reset') {
    await resetSession(from);
    await cancelPendingApprovals(from);
    await safeSend(from, 'איפסתי את הקשר השיחה וביטלתי אישורים ממתינים.');
    return;
  }

  const approvalMatch = text.match(/^אשר\s+(\d{6})$/);
  if (approvalMatch) {
    await handleApproval(from, approvalMatch[1]);
    return;
  }

  try {
    if (configured()) {
      const lifecycleResult = await handleLifecycleMessage(from, text);
      if (lifecycleResult.handled) {
        await safeSend(from, lifecycleResult.reply);
        return;
      }
      const briefResult = await handleBriefMessage(from, text);
      if (briefResult.handled) {
        await safeSend(from, briefResult.reply);
        return;
      }
    }
    await processNaturalLanguage(from, text, prefix);
  } catch (error) {
    logger.error('Message handling failed', { error: error.message });
    await safeSend(from, 'הייתה תקלה בעיבוד הבקשה. נסה שוב בעוד רגע.');
  }
}

async function handleIncomingMessage(message, contact) {
  if (!isAuthorized(message.from)) return handleTenantMessage(message, contact);
  const client = await getOrCreateClient(message.from,contact?.profile?.name);
  return require('./metaConnection').context.run(String(client.id),()=>handleTenantMessage(message, contact));
}
module.exports = { handleIncomingMessage };
