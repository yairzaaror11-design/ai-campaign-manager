'use strict';
const crypto=require('node:crypto'),store=require('./marketingStore');
const FOOTER='אפשר גם לכתוב או לשלוח הודעה קולית';
function context(p){return JSON.stringify([p.planId,p.journey?.stage,p.journey?.pendingField,p.journey?.revision,p.journey?.inputMode,p.journey?.detour,p.connection?.status,p.connection?.pendingQuestion,p.mediaContext?.assetId,p.mediaBudgetQuestion?.amount,p.businessImport?.foundAt,p.businessEntry?.awaitingConfirmation,p.crmFocus?.id,p.crmFocus?.version,JSON.stringify(p.crmMenu||[])]);}
const choice=(title,text,description)=>({title,text,...(description?{description}:{})});
const DECISIONS=["crm_leads","crm_status","business_entry","business_import","plan_review","media_variant", "budget_period", "media_action", "has_ad_account", "connected", "connection_offer", "account_selection", "businessGoal", "dailyBudget", "leadDestination", "offerMediaSeparate", "strategy_review", "creative_review", "welcome"];
function choices(p,decisionKey){
 if(decisionKey==null)return [];
 if(!DECISIONS.includes(decisionKey))throw Error('INVALID_DECISION_KEY');
 const j=p.journey||{},pending=j.pendingField,connection=p.connection;
 if(decisionKey==='crm_leads'&&p.crmMenu?.length)return p.crmMenu.map((x,i)=>choice(`${i+1}. ${x.name.slice(0,16)}`,`פתח פנייה ${i+1}`));
 if(decisionKey==='crm_status'&&p.crmFocus)return[choice('חדשה','סמן כפנייה חדשה'),choice('בטיפול','סמן פנייה בטיפול'),choice('נקבעה פגישה','סמן שנקבעה פגישה'),choice('נסגרה עסקה','סמן שנסגרה עסקה'),choice('לא הבשילה','סמן שהפנייה לא הבשילה')];
 if(decisionKey==='business_entry')return[choice('אין לי קישור','אין לי קישור')];
 if(decisionKey==='business_import'&&p.businessEntry?.awaitingConfirmation)return[choice('הפרטים נכונים','הפרטים נכונים'),choice('לתקן פרטים','לתקן פרטים')];
 if(decisionKey==='plan_review'&&j.stage==='PLAN_REVIEW')return[choice('תצוגה והרשמה','תצוגה מקדימה'),choice('חיבור חשבון Meta','חבר חשבון מטא'),choice('לשנות פרטים','לא')];
 if(decisionKey==='media_variant'&&p.mediaVariants?.length)return p.mediaVariants.map((_,i)=>choice(`גרסה ${i+1}`,`בחרתי גרסה ${i+1}`));
 if(decisionKey==='budget_period'&&p.mediaBudgetQuestion)return[choice('תקציב יומי','זה תקציב יומי'),choice('לכל הקמפיין','זה לכל הקמפיין'),choice('מחיר המוצר','זה מחיר המוצר')];
 if(decisionKey==='media_action'&&p.mediaContext)return[
 choice('נוסח למודעה','תכין לי מודעה עם הקובץ ששלחתי'),
 choice('תוכנית קמפיין','תכין תוכנית קמפיין עם הקובץ ששלחתי'),
 p.mediaContext.type==='image'?choice('גרסאות לתמונה','תיצור לי 3 תמונות מהתמונה ששלחתי'):choice('טקסט לסרטון','נוסח לסרטון ששלחתי')];
 if(decisionKey==='has_ad_account'&&connection?.pendingQuestion==='hasAdAccount')return [choice('יש לי חשבון','כן'),choice('זו הפעם הראשונה','לא')];
 if(decisionKey==='connected'&&connection?.status==='CONNECTED')return[choice('קמפיין חדש','אני רוצה קמפיין'),choice('בדיקת ביצועים','תוצאות השבוע')];
 if(decisionKey==='connection_offer'&&connection?.status==='CONNECTION_OFFERED')return[choice('שלחו קישור','כן'),choice('לא עכשיו','לא')];
 if(decisionKey==='account_selection'&&connection?.status==='ACCOUNT_SELECTION_REQUIRED')return(connection.accounts||[]).slice(0,9).map((a,i)=>choice(`${i+1}. ${String(a.name).slice(0,17)}`,String(i+1),a.id));
 if(pending&&decisionKey===pending){
  if(pending==='dailyBudget'&&j.inputMode!=='budget_custom')return[...require('./budgetGuidance').OPTIONS.map(o=>choice(o.title,`${o.amount} שקל ביום`,o.description)),{...choice('סכום אחר','מה הכוונה?','אפשר להקליד סכום יומי ומטבע'),kind:'budget_custom'}];
  if(pending==='businessGoal'&&require('./businessEntry').enabled()&&p.businessEntry?.linkAsked)return[choice('יותר פניות','פניות מתאימות'),choice('מכירות','מכירות'),choice('תורים ופגישות','תורים ופגישות'),choice('מטרה אחרת','מה הכוונה?')];
  if(pending==='businessGoal')return[choice('יותר מכירות','מכירות'),choice('לקוחות חדשים','לקוחות חדשים'),choice('יותר חשיפה לעסק','חשיפה למותג')];
  if(pending==='leadDestination')return[choice('WhatsApp','פניות בוואטסאפ'),choice('טלפון','שיחות טלפון'),choice('אתר העסק','אתר העסק'),choice('טופס פניות','טופס פניות'),choice('עוד לא החלטתי','לא יודע')];
  if(pending==='offerMediaSeparate')return[choice('המדיה בנפרד','כן'),choice('המדיה כלולה','לא'),choice('עוד לא ידוע','לא יודע')];
 }
 if(decisionKey==='strategy_review'&&j.stage==='STRATEGY_REVIEW')return[choice('נכין מודעות','כן'),choice('רוצה לשנות','לא')];
 if(decisionKey==='creative_review'&&j.stage==='CREATIVE_REVIEW')return[choice('נכין תוכנית','כן'),choice('לשנות את המודעות','לא אהבתי את המודעה')];
 if(decisionKey==='welcome'&&j.stage==='IDLE')return[choice('קמפיין חדש','אני רוצה קמפיין'),choice('חיבור חשבון Meta','חבר חשבון מטא'),choice('בדיקת פרסום קיים','מצב חיבור חשבון מטא')];
 return[];
}
function payload(body,items,nonce){
 if(typeof body!=='string'||body.length>1024||!Array.isArray(items)||items.length<1||items.length>10)throw Error('INVALID_INTERACTIVE_MESSAGE');
 const rows=items.map((c,i)=>({id:`cb:${nonce}:${i}`,title:c.title,...(c.description?{description:c.description}:{})}));
 if(rows.some(r=>!r.title||r.title.length>(items.length<=3?20:24)||(r.description||'').length>72))throw Error('INVALID_INTERACTIVE_CHOICE');
 return{type:'interactive',interactive:{type:items.length<=3?'button':'list',body:{text:body},footer:{text:FOOTER},action:items.length<=3?{buttons:rows.map(r=>({type:'reply',reply:{id:r.id,title:r.title}}))}:{button:'לבחירה',sections:[{title:'האפשרויות שלך',rows}]}}};
}
async function prepare(clientId,reply,decisionKey=null){
 let result={text:reply};
 await store.update(clientId,null,p=>{
  const items=choices(p,decisionKey);
  // Long creative outputs remain ordinary messages; only clear decision points receive controls.
  if(!items.length){if(p.ui){delete p.ui;return{handled:false,changed:true};}return{handled:false};}
  const nonce=crypto.randomBytes(12).toString('hex');
  const long=reply.length>1024;
  const interactivePayload=payload(long?'מה נרצה לעשות בשלב הבא?':reply,items,nonce);
  p.ui={nonce,context:context(p),choices:items,expiresAt:Date.now()+24*60*60*1000};
  result={text:reply,interactivePayload,...(long?{leadingText:reply}:{})};return{handled:false,changed:true};
 });return result;
}
async function consume(clientId,message){
 const type=message.interactive?.type;
 const id=type==='button_reply'?message.interactive.button_reply?.id:type==='list_reply'?message.interactive.list_reply?.id:null;
 if(typeof id!=='string'||!/^cb:[a-f0-9]{24}:\d$/.test(id))return null;
 let selected=null;
 await store.update(clientId,null,p=>{
  const [,nonce,index]=id.split(':');const ui=p.ui;
  if(!ui||ui.nonce!==nonce||ui.context!==context(p)||ui.expiresAt<Date.now())return{handled:false};
  const c=ui.choices[Number(index)];if(!c)return{handled:false};
  selected=c.text;if(c.kind==='budget_custom')p.journey.inputMode='budget_custom';delete p.ui;
  return{handled:false,changed:true};
 });return selected;
}
module.exports={choices,payload,prepare,consume,context};

