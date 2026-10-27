'use strict';
// A planning adapter to the existing journey engine. Never calls WhatsApp or Meta executors.
const crypto=require('node:crypto'),store=require('./marketingStore');
const SCREENS=['pages','onboarding','home','brand','products','creative','content','campaign','landing','research','integrations','sales','leads','pipeline','customers','tasks','scripts','automations','whatsapp','bot','finance','profitability','expenses','forecasts','advisor','calendar','bookings','services','team','calendar-settings','agent','account','users','billing','help','support'];
const ACTIONS={campaign:{screen:'campaign',label:'פתיחת תוכנית הקמפיין'},brand:{screen:'brand',label:'פרטי המותג'},leads:{screen:'leads',label:'ניהול לידים'},content:{screen:'content',label:'יצירת טיוטת פוסט'},tasks:{screen:'tasks',label:'ניהול משימות'},integrations:{screen:'integrations',label:'בדיקת חיבורים'}};
function actions(screen){return [ACTIONS[['leads','pipeline','sales','customers'].includes(screen)?'leads':['brand','products','research'].includes(screen)?'brand':screen==='content'?'content':'campaign'],ACTIONS.tasks,ACTIONS.integrations];}
async function send(clientId,{message,screen,requestId}={}){
 if(typeof message!=='string'||!message.trim()||message.length>2000||!SCREENS.includes(screen)||!require('./workspaceService').uuid(requestId))throw Error('INVALID_AGENT_MESSAGE');
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify({message,screen})).digest('hex');
 const snapshot=await store.load(clientId)||store.emptyProfile();
 const prior=snapshot.portalChat?.requests?.find(x=>x.id===requestId);
 if(prior){if(prior.fingerprint!==fingerprint)throw Error('WORKSPACE_REQUEST_CONFLICT');return prior.result;}
 const candidate=structuredClone(snapshot);
 const prepared=await prepareReply(clientId,candidate,message,screen);
 return store.update(clientId,null,p=>{
  const chat=p.portalChat||{messages:[],requests:[]};
  const cached=chat.requests.find(x=>x.id===requestId);if(cached){if(cached.fingerprint!==fingerprint)throw Error('WORKSPACE_REQUEST_CONFLICT');return cached.result;}
  if((p.version||0)!==(snapshot.version||0))throw Error('WORKSPACE_STALE');
  Object.assign(p,candidate);
  const reply=prepared;
  const response={reply,screen,actions:actions(screen),externalActionsExecuted:false};
  const now=new Date().toISOString();
  chat.messages=[...chat.messages,{role:'user',content:message,screen,at:now},{role:'assistant',content:reply,screen,at:now}].slice(-24);
  chat.requests=[...chat.requests,{id:requestId,fingerprint,result:response}].slice(-12);p.portalChat=chat;
  return {...response,handled:false,changed:true,audit:'PORTAL_AGENT_PLANNING'};
 });
}
async function prepareReply(clientId,p,message,screen){
  let reply;
  const blocked=require('./conversationControl').isReset(message)||/מחק|מחיקה|פרסם|פרסום עכשיו|הפעל|שלח הודעה|שנה תקציב|\/meta-|\/campaign-|אישור הפעלה/.test(message);
  const analysis=blocked?require('./conversationAnalysis').localAnalysis(message):await require('./conversationAnalysis').analyze(message,p,{history:p.portalChat?.messages||[]});
  if(blocked)reply='כאן אפשר להכין ולבדוק תוכניות. פעולה חיצונית או מחיקה דורשת תצוגה ואישור בתהליך המתאים. אפשר לפתוח את מסך הקמפיין או החיבורים כדי להמשיך.';
  else if(['connect','disconnect','renew','connection_status'].includes(analysis.intent))reply='פרטי החיבור נמצאים במסך החיבורים. נבדוק שם את החשבון דרך מנגנון Meta הקיים, ונציג את ההרשאות לפני החיבור.';
  else if(analysis.intent==='report')reply='אפשר לפתוח את מסך הקמפיין ולבקש את דוח השבוע. נתוני לידים שהוספת נמצאים במסך המכירות; הם אינם נתוני ייחוס מאומתים של Meta.';
  else {
   const result=require('./marketingConversation').transition(p,message,{analysis});
   if(result.handled)reply=result.reply;
   else {
    try {
     const context=await require('./marketingStore').context(clientId)||{};
     const facts=require('./conversationFacts');
     context.facts=Object.fromEntries(Object.keys(facts.FIELDS).map(field=>{const a=facts.read(p,field);return[field,a?{value:typeof a.value==='string'?a.value.slice(0,200):a.value,status:a.status}:null];}));
     context.capabilities={planning:true,workspaceRecords:['products','content drafts','tasks','expenses'],automaticPublishing:false,calendarBookings:false,teamInbox:false,externalActions:false};
     context.screen=screen;context.workspace=await require('./workspaceContext').read(clientId,{limit:3});
     const response=await require('./aiService').processMessage(message,p.portalChat?.messages||[],{planningOnly:true,marketingContext:context});
     reply=response.text;
    }catch{reply='לא הצלחתי להכין תשובה חופשית כרגע. הפרטים שלך נשמרו; אפשר לנסות שוב או להמשיך דרך המסך הפתוח.';}
   }
  }
 return reply;
}
async function history(clientId){const p=await store.load(clientId);return {messages:p?.portalChat?.messages||[]};}
module.exports={SCREENS,actions,send,history};
