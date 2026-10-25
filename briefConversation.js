'use strict';
const { getOrCreateClient } = require('./clientStore');
const { createLifecycle } = require('./campaignLifecycle');
const { save: saveLifecycle } = require('./lifecycleStore');
const { processWithGemini } = require('./gemini');
const { loadBrief, saveBrief } = require('./briefStore');
const { WORKFLOWS, newBrief, updateBrief, nextQuestion, reviewBrief, approveBrief, cancelBrief, draftStrategy } = require('./campaignWorkflows');

function summary(brief) {
  return Object.entries(brief.fields).map(([key, value]) => key + ': ' + value).join('\n');
}

async function handleBriefMessage(phone, text) {
  const client = await getOrCreateClient(phone);
  let brief = await loadBrief(client.id);
  const previousRevision = brief?.revision ?? null;
  const start = text.match(/^\/brief\s+(\w+)(?:\s+(\d+(?:\.\d+)?))?$/i);
  if (start) {
    const type = start[1].toUpperCase();
    if (!WORKFLOWS[type]) return { handled: true, reply: 'סוג קמפיין לא נתמך: ' + Object.keys(WORKFLOWS).join(', ') };
    if (!client.meta_ad_account_id) return { handled: true, reply: 'לפני אפיון הקמפיין צריך לחבר ולאמת חשבון מודעות Meta.' };
    if (brief) return { handled: true, reply: 'קיים בריף פתוח. שלח /brief-cancel לפני יצירת חדש.' };
    const { latest } = require('./lifecycleStore');
    const activeFlow = await latest(client.id);
    if (activeFlow && !['ACTIVE_VERIFIED', 'CANCELLED'].includes(activeFlow.payload.status)) {
      return { handled: true, reply: 'קיים תהליך קמפיין ממתין. שלח /campaign-status להמשך.' };
    }
    brief = newBrief({ tenantId: String(client.id), adAccountId: client.meta_ad_account_id, type, dailyBudget: start[2] ? Number(start[2]) : undefined });
    await saveBrief(client.id, brief, null);
    return { handled: true, reply: nextQuestion(brief)?.question || 'הבריף מוכן לבדיקה.' };
  }
  if (!brief) return { handled: false };
  if (text === '/brief-cancel') {
    await saveBrief(client.id, cancelBrief(brief), previousRevision);
    return { handled: true, reply: 'הבריף בוטל.' };
  }
  if (text === '/brief-status') return { handled: true, reply: summary(brief) + '\n' + (nextQuestion(brief)?.question || 'שלח /brief-review לסיכום.') };
  if (text === '/brief-review') {
    if (nextQuestion(brief)) return { handled: true, reply: nextQuestion(brief).question };
    brief = reviewBrief(brief);
    await saveBrief(client.id, brief, previousRevision);
    return { handled: true, reply: 'סיכום הבריף (גרסה ' + brief.revision + '):\n' + summary(brief) + '\nלאישור שלח /brief-approve ' + brief.revision + '. לתיקון: /brief-set FIELD VALUE' };
  }
  const approval = text.match(/^\/brief-approve\s+(\d+)$/);
  if (approval) {
    try {
      brief = approveBrief(brief, Number(approval[1]));
      const strategy = draftStrategy(brief);
      if (process.env.MOCK_META_ENABLED !== 'true') {
        const connection = await require('./metaConnection').credentials(client.id);
        if (connection.meta_ad_account_id !== brief.adAccountId) throw Error('TENANT_ACCOUNT_MISMATCH');
        const draftId = require('node:crypto').randomUUID();
        await require('./db').transaction(async tx => {
          const locked = await tx('SELECT meta_ad_account_id FROM clients WHERE id=$1 FOR UPDATE',[client.id]);
          if (locked.rows[0]?.meta_ad_account_id !== brief.adAccountId) throw Error('TENANT_ACCOUNT_MISMATCH');
          const saved = await tx('UPDATE campaign_briefs SET payload=$3::jsonb,status=$4,revision=$5,updated_at=NOW() WHERE id=$1 AND client_id=$2 AND revision=$6 RETURNING id',
            [brief.id,client.id,JSON.stringify(brief),brief.status,brief.revision,previousRevision]);
          if (!saved.rows.length) throw Error('STALE_BRIEF_UPDATE');
          await tx('INSERT INTO campaign_local_drafts(id,client_id,ad_account_id,payload) VALUES($1,$2,$3,$4::jsonb)',
            [draftId,client.id,brief.adAccountId,JSON.stringify({brief,strategy,status:'LOCAL_DRAFT',requiresPublicationApproval:true})]);
        });
        return { handled: true, reply: 'נשמרה טיוטה מקומית לחשבון המחובר: ' + draftId + '\nאסטרטגיה: ' + JSON.stringify(strategy) + '\nלא נוצר קמפיין ב־Meta ולא בוצע חיוב. פרסום אינו זמין בשלב זה.' };
      }
      await saveBrief(client.id, brief, previousRevision);
      const creativeResponse = await processWithGemini('כתוב מודעת Meta בעברית בפורמט שתי שורות: כותרת ואז טקסט, עבור ' + brief.fields.businessName + ' / ' + brief.fields.product + '. ללא הבטחות לא מבוססות. אל תפעיל כלים.', []);
      const lines = String(creativeResponse.text).split('\\n').filter(Boolean);
      const creatives = [{ headline: (lines[0] || 'מודעה לבדיקה').slice(0, 100), copy: (lines.slice(1).join(' ') || lines[0] || 'טקסט לבדיקה').slice(0, 1000), assetId: 'mock-asset-' + brief.id }];
      const flow = createLifecycle({ tenantId: String(client.id), brief, strategy, creatives });
      await saveLifecycle(client.id, flow);
      return { handled: true, reply: 'הבריף אושר. אסטרטגיה: ' + JSON.stringify(strategy) + '\\nקריאייטיב: ' + JSON.stringify(creatives) + '\\nתוכנית Mock בלבד. לאישור יצירת טיוטה PAUSED שלח /campaign-draft ' + flow.planHash + '\\nהפעלה תדרוש אישור נוסף.' };
    } catch (error) {
      if (error.message === 'STALE_BRIEF_UPDATE') return { handled: true, reply: 'הבריף השתנה. שלח /brief-status לקבלת המצב העדכני.' };
      if (/approval|revision|status|review/i.test(error.message)) return { handled: true, reply: 'אישור הבריף נדחה: ' + error.message };
      throw error; // Infrastructure and Gemini failures must not masquerade as rejected approvals.
    }
  }
  const set = text.match(/^\/brief-set\s+(\w+)\s+([\s\S]+)$/);
  if (set) {
    try { brief = updateBrief(brief, { [set[1]]: set[2].trim() }); }
    catch (error) { return { handled: true, reply: 'שדה לא תקין: ' + error.message }; }
    await saveBrief(client.id, brief, previousRevision);
    return { handled: true, reply: nextQuestion(brief)?.question || 'כל הפרטים התקבלו. שלח /brief-review.' };
  }
  if (text.startsWith('/')) return { handled: false };
  const question = nextQuestion(brief);
  if (!question) return { handled: true, reply: 'שלח /brief-review להצגת הסיכום.' };
  brief = updateBrief(brief, { [question.field]: text });
  await saveBrief(client.id, brief, previousRevision);
  return { handled: true, reply: nextQuestion(brief)?.question || 'הבריף הושלם. שלח /brief-review להצגת סיכום ולאישור.' };
}

module.exports = { handleBriefMessage };
