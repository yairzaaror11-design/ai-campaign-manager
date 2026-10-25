'use strict';
const { getOrCreateClient } = require('./clientStore');
const { loadBrief, saveBrief } = require('./briefStore');
const { WORKFLOWS, newBrief, updateBrief, nextQuestion, reviewBrief, approveBrief, cancelBrief, draftStrategy } = require('./campaignWorkflows');

function summary(brief) {
  return Object.entries(brief.fields).map(([key, value]) => key + ': ' + value).join('\n');
}

async function handleBriefMessage(phone, text) {
  const client = await getOrCreateClient(phone);
  let brief = await loadBrief(client.id);
  const start = text.match(/^\/brief\s+(\w+)(?:\s+(\d+(?:\.\d+)?))?$/i);
  if (start) {
    const type = start[1].toUpperCase();
    if (!WORKFLOWS[type]) return { handled: true, reply: 'סוג קמפיין לא נתמך: ' + Object.keys(WORKFLOWS).join(', ') };
    if (!client.meta_ad_account_id) return { handled: true, reply: 'לפני אפיון הקמפיין צריך לחבר ולאמת חשבון מודעות Meta.' };
    if (brief) return { handled: true, reply: 'קיים בריף פתוח. שלח /brief-cancel לפני יצירת חדש.' };
    brief = newBrief({ tenantId: String(client.id), adAccountId: client.meta_ad_account_id, type, dailyBudget: start[2] ? Number(start[2]) : undefined });
    await saveBrief(client.id, brief);
    return { handled: true, reply: nextQuestion(brief)?.question || 'הבריף מוכן לבדיקה.' };
  }
  if (!brief) return { handled: false };
  if (text === '/brief-cancel') {
    await saveBrief(client.id, cancelBrief(brief));
    return { handled: true, reply: 'הבריף בוטל.' };
  }
  if (text === '/brief-status') return { handled: true, reply: summary(brief) + '\n' + (nextQuestion(brief)?.question || 'שלח /brief-review לסיכום.') };
  if (text === '/brief-review') {
    if (nextQuestion(brief)) return { handled: true, reply: nextQuestion(brief).question };
    brief = reviewBrief(brief);
    await saveBrief(client.id, brief);
    return { handled: true, reply: 'סיכום הבריף (גרסה ' + brief.revision + '):\n' + summary(brief) + '\nלאישור שלח /brief-approve ' + brief.revision + '. לתיקון: /brief-set FIELD VALUE' };
  }
  const approval = text.match(/^\/brief-approve\s+(\d+)$/);
  if (approval) {
    try {
      brief = approveBrief(brief, Number(approval[1]));
      await saveBrief(client.id, brief);
      const strategy = draftStrategy(brief);
      return { handled: true, reply: 'הבריף אושר. הצעת אסטרטגיה ראשונית: ' + JSON.stringify(strategy) + '\nלא נוצר קמפיין ולא בוצעה פעולה ב-Meta.' };
    } catch { return { handled: true, reply: 'האישור נדחה: הגרסה השתנתה או שהבריף טרם נבדק.' }; }
  }
  const set = text.match(/^\/brief-set\s+(\w+)\s+([\s\S]+)$/);
  if (set) {
    try { brief = updateBrief(brief, { [set[1]]: set[2].trim() }); }
    catch (error) { return { handled: true, reply: 'שדה לא תקין: ' + error.message }; }
    await saveBrief(client.id, brief);
    return { handled: true, reply: nextQuestion(brief)?.question || 'כל הפרטים התקבלו. שלח /brief-review.' };
  }
  if (text.startsWith('/')) return { handled: false };
  const question = nextQuestion(brief);
  if (!question) return { handled: true, reply: 'שלח /brief-review להצגת הסיכום.' };
  brief = updateBrief(brief, { [question.field]: text });
  await saveBrief(client.id, brief);
  return { handled: true, reply: nextQuestion(brief)?.question || 'הבריף הושלם. שלח /brief-review להצגת סיכום ולאישור.' };
}

module.exports = { handleBriefMessage };
