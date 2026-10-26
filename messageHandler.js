const { isAuthorized } = require('./auth');
const { handleBriefMessage } = require('./briefConversation');
const { handleLifecycleMessage } = require('./lifecycleConversation');
const { configured } = require('./db');
const { safeSend } = require('./whatsapp');
const { processMessage: processWithGemini } = require('./aiService');
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
const { notifyProcessing } = require('./processingNotice');

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
  await notifyProcessing(from,'קיבלתי את בקשת האישור, בודק אותה.');
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
  const kind=message.type==='image'?'תמונה':'סרטון';
  await notifyProcessing(from,`קיבלתי את ה${kind}.`);
  try {
    const media=await receiveWhatsAppMedia(message);
    const client=await getOrCreateClient(from);
    const assetId=await require('./mediaStore').saveMedia(client.id,media);
    await require('./marketingStore').update(client.id,null,p=>{
      p.mediaContext={assetId,type:media.type,caption:media.caption.slice(0,2000),receivedAt:new Date().toISOString()};delete p.mediaVariants;
      return{handled:false,changed:true,audit:'MEDIA_RECEIVED'};
    });
    const reply=`מה נעשה עם ה${kind}?`+(media.type==='image'?'\nהעלאה ל-Meta תדרוש אישור נפרד.':'');
    const ui=await require('./conversationUi').prepare(client.id,reply);
    await safeSend(from,ui.text,ui);
  }catch(error){
    logger.error('Media handling failed',{errorType:error?.name||'Error'});
    await safeSend(from,'לא הצלחתי לפתוח את הקובץ. אפשר לשלוח אותו שוב?');
  }
}


async function processNaturalLanguage(from, text, prefix = '') {
  await notifyProcessing(from);
  const history = await getHistory(from);
  let marketingContext=null;
  if (configured() && require('./marketingConversation').enabled()) {
    const client=await getOrCreateClient(from);
    marketingContext=await require('./marketingStore').context(client.id);
  }
  const result = await processWithGemini(text, history, {marketingContext});
  let reply = prefix ? `${prefix}\n\n${result.text}` : result.text;

  for (const plan of result.actionPlans || []) {
    if (plan.missing?.length) continue;
    let approval;
    try {approval = await createApproval(from, plan);}
    catch {reply+='\nההצעה לא קיבלה קוד אישור: נדרש חשבון מחובר וכל פרטי הפעולה, הקהל, המטבע והתאריכים. לא בוצע שינוי.';continue;}
    reply += `\n\n${formatActionPlan(approval.actionPlan)}${approvalInstruction(approval)}`;
  }

  await appendMessages(from, [
    { role: 'user', content: text },
    { role: 'assistant', content: reply }
  ]);

  await safeSend(from, reply);
}

async function handleVoice(from, message) {
  await notifyProcessing(from,'קיבלתי את ההודעה הקולית, מקשיב ומכין לך תשובה.');
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

  if(message.type==='interactive'){
    const client=await getOrCreateClient(from);
    const selected=await require('./conversationUi').consume(client.id,message);
    if(!selected){await safeSend(from,'הבחירה הזו כבר לא עדכנית. אפשר לענות בכתיבה על השאלה האחרונה או לבקש להמשיך.');return;}
    await routeText(from,selected);return;
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
    if(text!=='/meta-delete-data-confirm') await notifyProcessing(from,'קיבלתי, בודק את חיבור חשבון הפרסום.');
    try {
      const client = await getOrCreateClient(from);
      if(text!=='/meta-delete-data-confirm'&&require('./marketingConversation').enabled()){
        const guided=await require('./marketingConversation').handleMarketingMessage(client.id,text,require('./whatsappDelivery').messageContext.getStore()?.eventId,{onSlow:()=>notifyProcessing(from)});
        if(guided.handled){const ui=await require('./conversationUi').prepare(client.id,guided.reply);await safeSend(from,ui.text,ui);return;}
      }
      let reply;
      if (text === '/meta-delete-data-confirm') {
        await require('./db').transaction(tx=>require('./metaDeletion').deleteClient(client.id,tx));
        return; // No post-deletion message may recreate the client or outbox row.
      }
      else if (text === '/meta-renew') { await meta.renew(client.id); reply='הרשאת Meta חודשה. לא בוצע שינוי בקמפיינים.'; }
      else if (text === '/meta-connect') reply = 'קישור אישי לחיבור Meta (10 דקות, אין להעביר): ' + await meta.createInvite(client.id);
      else if (text === '/meta-accounts') reply = JSON.stringify((await meta.accounts(client.id)).data) + '\nלבחירה: /meta-select act_ID';
      else if (/^\/meta-select act_\d+$/.test(text)) { await meta.selectAccount(client.id,text.split(' ')[1]); reply = 'חשבון המודעות חובר. ניתן להתחיל בריף עם /brief TRAFFIC.'; }
      else if (text === '/meta-disconnect') { await meta.disconnect(client.id); reply = 'החיבור המקומי והטוקן נמחקו. ניתן להסיר את האפליקציה גם בהגדרות Meta.'; }
      else reply = 'פקודות: /meta-connect /meta-accounts /meta-select act_ID /meta-disconnect';
      await safeSend(from,reply);
    } catch { await safeSend(from,'חיבור Meta אינו זמין או שההרשאה פגה. בקש /meta-connect מחדש.'); }
    return;
  }
  if (text === '/notifications-on' || text === '/notifications-off') {
    await require('./db').query('UPDATE whatsapp_contacts SET opted_in=$2 WHERE phone=$1',[from,text==='/notifications-on']);
    await safeSend(from,text==='/notifications-on'?'הסכמת לקבלת עדכונים נרשמה. ניתן לבטל עם /notifications-off.':'הסכמת העדכונים בוטלה.');return;
  }
  if (/^\/report(?: (today|yesterday|last_7d|last_14d|last_30d|this_month|last_month))?$/.test(text)) {
    await notifyProcessing(from,'קיבלתי, מכין לך את דוח הביצועים.');
    try {const client=await getOrCreateClient(from);await safeSend(from,await require('./reportService').campaignReport(client.id,text.split(' ')[1] || 'last_7d'));}
    catch {await safeSend(from,'לא ניתן להפיק דוח כרגע. בדוק שחיבור Meta והחשבון הנבחר בתוקף.');}return;
  }
  if(configured()&&/^בחרתי גרסה [1-3]$/.test(text)){
    const client=await getOrCreateClient(from);let selected=false;
    await require('./marketingStore').update(client.id,null,async p=>{
      const item=p.mediaVariants?.[Number(text.at(-1))-1];if(!item)return{handled:false};
      let asset;try{asset=await require('./mediaStore').loadMedia(client.id,item.id);}catch{selected='expired';delete p.mediaVariants;return{handled:false,changed:true};}
      p.mediaContext={assetId:asset.id,type:'image',caption:'',receivedAt:new Date().toISOString()};delete p.mediaVariants;selected=true;
      return{handled:false,changed:true,audit:'MEDIA_SELECTED'};
    });
    if(selected==='expired'){await safeSend(from,'התמונה כבר לא זמינה. אפשר לשלוח אותה שוב?');return;}
    if(selected){await routeText(from,'תכין לי מודעה עם הקובץ ששלחתי');return;}
  }
  if(configured()&&['זה תקציב יומי','זה לכל הקמפיין','זה מחיר המוצר'].includes(text)){
    const client=await getOrCreateClient(from);let reply=null;
    await require('./marketingStore').update(client.id,null,p=>{
      const pending=p.mediaBudgetQuestion;if(!pending||pending.planId!==p.planId)return{handled:false};
      if(text==='זה תקציב יומי'){
        require('./conversationFacts').write(p,'dailyBudget',{amount:pending.amount,currency:'ILS',period:'day'},{evidence:text,source:'user_confirmed_context'});
        require('./conversationFacts').correctionsInvalidate(p,['dailyBudget']);
        reply=`שמרתי ${pending.amount} ₪ ביום לתכנון. איזו גרסה נרצה להכין למודעה?`;
      }else if(text==='זה לכל הקמפיין'){
        require('./conversationFacts').write(p,'dailyBudget',null,{status:'unknown',evidence:text,source:'user_confirmed_context'});
        require('./conversationFacts').correctionsInvalidate(p,['dailyBudget']);
        p.mediaBudgetQuestion={...pending,period:'total',awaitingDuration:true};
        reply='הבנתי שזה הסכום לכל הקמפיין. לכמה ימים נרצה לפרוס אותו?';return{handled:false,changed:true};
      }else reply='הבנתי שזה מחיר המוצר. איזו גרסה נרצה להכין למודעה?';
      delete p.mediaBudgetQuestion;return{handled:false,changed:true};
    });
    if(reply){const ui=await require('./conversationUi').prepare(client.id,reply);await safeSend(from,ui.text,ui);return;}
  }
  if(configured()&&/^(?:ל)?\d{1,3}\s*(?:ימים|יום)$/.test(text)){
    const client=await getOrCreateClient(from);let reply=null;
    await require('./marketingStore').update(client.id,null,p=>{
      const pending=p.mediaBudgetQuestion;
      if(!pending?.awaitingDuration||pending.planId!==p.planId)return{handled:false};
      const days=Number(text.match(/\d+/)[0]);if(days<1)return{handled:false};
      p.mediaBudgetPlan={total:pending.amount,currency:'ILS',days,status:'PROPOSED',dailyAverage:pending.amount/days};delete p.mediaBudgetQuestion;
      reply=`זה תכנון של ${pending.amount} ₪ ל-${days} ימים, בממוצע ${(pending.amount/days).toFixed(2)} ₪ ביום. איזו גרסה נרצה להכין למודעה?`;
      return{handled:false,changed:true};
    });if(reply){const ui=await require('./conversationUi').prepare(client.id,reply);await safeSend(from,ui.text,ui);return;}
  }
  const graphicRequest=require('./graphicService').graphicRequest(text);
  if(graphicRequest!==null) {
    if(graphicRequest.count>3){await safeSend(from,'אפשר להכין עד 3 גרסאות בבקשה אחת. כמה להכין?');return;}
    await notifyProcessing(from,'קיבלתי, מכין לך את הגרפיקה. אשלח אותה כאן כשהיא תהיה מוכנה.');
    const ready=[];
    try {
      const client=await getOrCreateClient(from);
      await require('./graphicService').createVariants(client.id,graphicRequest,async(media,index,count)=>{
        ready.push({id:media.id,index});
        await require('./whatsappDelivery').enqueue(from,{type:'image',image:{id:media.whatsapp_media_id,caption:count===1?'הגרפיקה מוכנה. מה דעתך על הכיוון?':`גרסה ${index+1} מתוך ${count}.`}});
      });
      if(graphicRequest.count>1)await require('./marketingStore').update(client.id,null,p=>{p.mediaVariants=ready;return{handled:false,changed:true};});
      if(graphicRequest.ambiguousBudget){
        await require('./marketingStore').update(client.id,null,p=>{p.mediaBudgetQuestion={amount:graphicRequest.ambiguousBudget,planId:p.planId};return{handled:false,changed:true};});
        const reply=`הסכום של ${graphicRequest.ambiguousBudget} ₪ הוא תקציב ליום, לכל הקמפיין או מחיר המוצר?`;
        const ui=await require('./conversationUi').prepare(client.id,reply);await safeSend(from,ui.text,ui);
      }else if(graphicRequest.count>1){const ui=await require('./conversationUi').prepare(client.id,'איזו גרסה נרצה להכין למודעה?');await safeSend(from,ui.text,ui);}
    } catch(error){
      const reply=['REFERENCE_IMAGE_REQUIRED','MEDIA_EXPIRED_OR_NOT_OWNED'].includes(error.message)?'כדי לשמור על מראה המוצר, אפשר לשלוח שוב את התמונה שלו?':error.completed?`הכנתי ${error.completed} גרסאות. השאר לא הושלמו כרגע. אפשר לבחור מהן או לנסות את השאר בהמשך.`:'יצירת הגרפיקה לא הושלמה כרגע. אפשר לנסות שוב עם תיאור קצר של הכיוון הרצוי.';
      await safeSend(from,reply);
    }
    return;
  }
  if (text === '/start' && (!configured() || !require('./marketingConversation').enabled())) {
    await safeSend(
      from,
      'היי, אני קמפיין בצ׳ט. אפשר לבקש קמפיין, גרפיקה ודוחות בעברית. לחיבור חשבון פרסום: /meta-connect. ליצירת גרפיקה: צור לי גרפיקה ותאר את העסק והמסר. לדוח: /report. כל שינוי בקמפיין דורש אישור; פרסום זמין רק כאשר הרשאות הכתיבה מופעלות.'
    );
    return;
  }

  if (text === '/reset') {
    await resetSession(from);
    await cancelPendingApprovals(from);
    if(configured() && require('./marketingConversation').enabled()) {
      const client=await getOrCreateClient(from);
      await require('./marketingStore').pause(client.id);
    }
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
      const client=await getOrCreateClient(from);
      const profile=await require('./marketingStore').load(client.id);
      const openBrief=await require('./briefStore').loadBrief(client.id);
      const owner=require('./conversationOwner').owner({text,profile,hasOpenBrief:!!openBrief});
      let handled;
      if(owner==='lifecycle')handled=await handleLifecycleMessage(from,text);
      else if(owner==='brief')handled=await handleBriefMessage(from,text);
      else if(owner==='marketing'&&require('./marketingConversation').enabled())handled=await require('./marketingConversation').handleMarketingMessage(client.id,text,require('./whatsappDelivery').messageContext.getStore()?.eventId,{onSlow:()=>notifyProcessing(from)});
      if(handled?.handled){
        const reply=prefix?`${prefix}\n\n${handled.reply}`:handled.reply;
        await appendMessages(from,[{role:'user',content:text},{role:'assistant',content:handled.historyReply||reply}]);
        if(owner==='marketing'){const ui=await require('./conversationUi').prepare(client.id,reply);await safeSend(from,ui.text,ui);}else await safeSend(from,reply);return;
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
  const delivery=require('./whatsappDelivery');
  await delivery.recordInbound(message);
  if(!await require('./rateLimit').take('chat:'+client.id,20)) return;
  return delivery.messageContext.run({eventId:message.id,sequence:0},()=>
    require('./metaConnection').context.run(String(client.id),()=>handleTenantMessage(message, contact)));
}
module.exports = { handleIncomingMessage };
