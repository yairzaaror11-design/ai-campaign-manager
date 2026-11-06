'use strict';
// Sole owner of pilot customer conversation. Infrastructure adapters do not own goals.
const db=require('./db'),tasks=require('./taskAgent');
async function owns(clientId){
 if(process.env.UNIFIED_CONVERSATION_ENABLED!=='true')return false;
 if(process.env.TASK_AGENT_PILOT_ONLY!=='true')return true;
 const client=(await db.query('SELECT phone FROM clients WHERE id=$1',[clientId])).rows[0];
 return String(process.env.AUTHORIZED_PHONE_NUMBERS||'').split(',').map(require('./auth').normalizePhone).filter(Boolean).includes(client?.phone);
}
async function handle(clientId,input,options={}){
 if(!await owns(clientId))return null;
 const message=input.message.trim(),eventId=input.requestId;
 const skills=require('./skillStatus');
 if(skills.requested(message))return skills.reply();
 const active=await tasks.active(clientId);
 if(/^אשר\s+\d{6}$/.test(message)&&!active)return{handled:true,reply:'אין פעולה ממתינה במשימה הנוכחית. לא אשתמש באישור מתוכנית קודמת. אפשר לבקש להכין את הפעולה מחדש לבדיקה.'};
 // Only explicit infrastructure commands may reach their existing adapters.
 if(/^\/(?:meta-|report(?:\s|$)|notifications-)/.test(message))return null;
 if(message.startsWith('/')&&message!=='/start')return{handled:true,reply:'אפשר לכתוב כאן במילים מה תרצה להשיג. אמשיך מאותה בקשה ואציג את התוצרים לבדיקה לפני כל פעולה.'};
 const analysis=require('./conversationAnalysis').localAnalysis(message);
 const profile=await require('./marketingStore').load(clientId);
 const connection=['connect','disconnect','renew','connection_status','select_account'].includes(analysis.intent)||profile?.connection?.status==='ACCOUNT_SELECTION_REQUIRED'&&/^\d{1,3}$/.test(message)||profile?.connection?.status==='CONNECTION_OFFERED'&&analysis.intent==='yes';
 if(connection){const result=await require('./metaConversation').handle(clientId,message,analysis,eventId);if(result.handled)return result;}
 const personal=await require('./personalConversation').handle(clientId,message,eventId);if(personal)return personal;
 if(!active&&analysis.intent==='greeting')return{handled:true,reply:'היי! מה תרצה שנכין או ננהל היום? אפשר לבקש קמפיין, מודעה או טופס ולצרף תמונות של העסק.'};
 if(!active&&analysis.intent==='capabilities')return{handled:true,reply:'אפשר להכין מודעה, עיצוב וטופס לידים, לבדוק נתוני קמפיינים ולהציע פעולות בחשבון המחובר. אברר רק מה שחסר לבקשה ואציג את התוצרים לבדיקה. יצירה ב־Meta והפעלה דורשות אישורים נפרדים.'};
 if(!skills.check().ok)return{handled:true,externalActionsExecuted:false,reply:'בדיקת החיבור של היכולות נכשלה. לא אבצע משימות חדשות עד לתיקון החיבור.'};
 if(!tasks.canPresentReview(active,message)&&!tasks.needsGoalClarification(message)&&!tasks.enabled()&&process.env.TASK_AGENT_ENABLED==='true'&&process.env.TASK_AGENT_REQUIRE_EVAL==='true'){
  try{await options.onProgress?.('המערכת מתעוררת ובודקת את החיבור למודל. הבקשה שלך תמשיך באותו תהליך לאחר שהבדיקה תעבור.');}catch{require('./logger').logger.warn('Model readiness notice unavailable');}
  // Eight sequential model probes can exceed45s. Stay within the existing
  // five-minute inbound lease and continue this original event, never replay it.
  await require('./taskEvaluation').waitUntilReady(120000);
 }
 return tasks.send(clientId,{...input,message:message==='/start'?'היי':message},{...options,deferPlanning:!tasks.enabled()});
}
async function media(clientId,input,options={}){
 if(!await owns(clientId))return null;
 if(!await tasks.active(clientId))return{handled:true,reply:'הקובץ נשמר לשיחה. מה תרצה להכין איתו?'};
 return handle(clientId,input,options);
}
function acceptsInteractive(profile){return ['action_approval','account_selection','connection_offer','connected'].includes(profile?.ui?.decisionKey);}
module.exports={owns,handle,media,acceptsInteractive};
