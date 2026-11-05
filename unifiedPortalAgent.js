'use strict';
const db=require('./db'),meta=require('./metaConnection');
const enabled=()=>process.env.UNIFIED_PORTAL_AGENT_ENABLED==='true';
async function owns(clientId){return enabled()&&await require('./conversationController').owns(clientId);}
function scope(clientId){if(String(meta.context.getStore())!==String(clientId))throw Error('TENANT_CONTEXT_REQUIRED');}
async function send(clientId,{message,screen,requestId}){
 scope(clientId);
 const controller=require('./conversationController'),tasks=require('./taskAgent'),support=require('./humanSupport'),eventId='portal:'+requestId;
 let result;
 if(support.humanRequested(message)){
  await support.request(clientId,{reason:message,channel:'PORTAL',eventId});result={handled:true,reply:'הבקשה נשמרה למענה אנושי והסוכן הושהה. לחזרה אפשר לכתוב ״המשך עם הבוט״.',externalActionsExecuted:false};
 }else if((await support.current(clientId))?.bot_paused){
  const current=await support.current(clientId);
  if(support.resumeRequested(message)){await support.resume(clientId,current.id,current.version);result={handled:true,reply:'המענה האוטומטי חודש. מה תרצה שנמשיך להכין?',externalActionsExecuted:false};}
  else{await support.append(clientId,current.id,{body:message,eventId});result={handled:true,reply:'ההודעה נוספה לבקשה למענה אנושי. הסוכן עדיין מושהה.',externalActionsExecuted:false};}
 }else if(require('./conversationControl').isReset(message)){
  result=await tasks.cancel(clientId)||{handled:true,externalActionsExecuted:false};result.reply='המשימה הקודמת בוטלה. פרטי העסק והחיבורים נשמרו. מה תרצה להכין עכשיו?';
 }else result=await controller.handle(clientId,{message,requestId:eventId,channel:'PORTAL'});
 if(!result?.handled)result={reply:'אפשר להמשיך בחיבורים ובהרשאות דרך מסך החיבורים.',externalActionsExecuted:false};
 const media=(result.mediaIds||[]).map(id=>({id,url:'/app/api/agent/media/'+encodeURIComponent(id)}));
 return{...result,screen,actions:require('./portalAgent').actions(screen),media,conversationMode:'unified'};
}
async function history(clientId){
 scope(clientId);
 const rows=(await db.query('SELECT request_id,channel,input_text,result,created_at FROM agent_task_turns WHERE client_id=$1 AND input_text IS NOT NULL AND result IS NOT NULL ORDER BY created_at DESC,request_id DESC LIMIT 40',[clientId])).rows.reverse();
 const represented=new Set(rows.map(r=>r.request_id));
 const controls=((await require('./marketingStore').load(clientId))?.portalChat?.messages||[]).filter(m=>!m.requestId||!represented.has('portal:'+m.requestId)).map(m=>({...m,channel:'PORTAL'}));
 const turns=rows.flatMap(row=>[
  {role:'user',content:row.input_text,channel:row.channel,at:row.created_at},
  {role:'assistant',content:row.result.reply||'הוכנה פעולה לבדיקה; נדרש אישור נפרד לפעולה זו.',media:(row.result.mediaIds||[]).map(id=>({id,url:'/app/api/agent/media/'+encodeURIComponent(id)})),channel:row.channel,at:row.created_at}
 ]);
 return{conversationMode:'unified',messages:[...turns,...controls].sort((a,b)=>new Date(a.at).getTime()-new Date(b.at).getTime()).slice(-80)};
}
module.exports={enabled,owns,send,history};
