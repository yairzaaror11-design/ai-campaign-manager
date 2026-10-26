'use strict';
const crypto=require('node:crypto'),store=require('./marketingStore');
const FOOTER='אפשר גם לכתוב או לשלוח הודעה קולית';
function context(p){return JSON.stringify([p.planId,p.journey?.stage,p.journey?.pendingField,p.journey?.revision,p.journey?.inputMode,p.connection?.status,p.connection?.pendingQuestion,p.mediaContext?.assetId,p.mediaBudgetQuestion?.amount]);}
const choice=(title,text,description)=>({title,text,...(description?{description}:{})});
function choices(p,reply){
 const j=p.journey||{},pending=j.pendingField,connection=p.connection;
 if(p.mediaVariants?.length&&reply.includes('איזו גרסה נרצה להכין למודעה?'))return p.mediaVariants.map((_,i)=>choice(`גרסה ${i+1}`,`בחרתי גרסה ${i+1}`));
 if(p.mediaBudgetQuestion&&reply.startsWith('הסכום של '))return[choice('תקציב יומי','זה תקציב יומי'),choice('לכל הקמפיין','זה לכל הקמפיין'),choice('מחיר המוצר','זה מחיר המוצר')];
 if(p.mediaContext&&reply.startsWith('מה נעשה עם ה'))return[
 choice('נוסח למודעה','תכין לי מודעה עם הקובץ ששלחתי'),
 choice('תוכנית קמפיין','תכין תוכנית קמפיין עם הקובץ ששלחתי'),
 p.mediaContext.type==='image'?choice('גרסאות לתמונה','תיצור לי 3 תמונות מהתמונה ששלחתי'):choice('טקסט לסרטון','נוסח לסרטון ששלחתי')];
 if(connection?.pendingQuestion==='hasAdAccount'&&reply.includes('יש כבר חשבון'))return [choice('יש לי חשבון','כן'),choice('זו הפעם הראשונה','לא')];
 if(connection?.status==='CONNECTED'&&reply.includes('אומת וחובר'))return[choice('קמפיין חדש','אני רוצה קמפיין'),choice('בדיקת ביצועים','תוצאות השבוע')];
 if(connection?.status==='CONNECTION_OFFERED'&&reply.includes('לשלוח קישור'))return[choice('שלחו קישור','כן'),choice('לא עכשיו','לא')];
 if(connection?.status==='ACCOUNT_SELECTION_REQUIRED'&&reply.includes('באיזה חשבון'))return(connection.accounts||[]).slice(0,9).map((a,i)=>choice(`${i+1}. ${String(a.name).slice(0,17)}`,String(i+1),a.id));
 if(pending&&reply.includes(require('./campaignJourney').QUESTIONS[pending])){
  if(pending==='dailyBudget'&&j.inputMode!=='budget_custom')return[...require('./budgetGuidance').OPTIONS.map(o=>choice(o.title,`${o.amount} שקל ביום`,o.description)),{...choice('סכום אחר','מה הכוונה?','אפשר להקליד סכום יומי ומטבע'),kind:'budget_custom'}];
  if(pending==='businessGoal')return[choice('יותר מכירות','מכירות'),choice('לקוחות חדשים','לקוחות חדשים'),choice('יותר חשיפה לעסק','חשיפה למותג')];
  if(pending==='leadDestination')return[choice('WhatsApp','פניות בוואטסאפ'),choice('טלפון','שיחות טלפון'),choice('אתר העסק','אתר העסק'),choice('טופס פניות','טופס פניות'),choice('עוד לא החלטתי','לא יודע')];
  if(pending==='offerMediaSeparate')return[choice('המדיה בנפרד','כן'),choice('המדיה כלולה','לא'),choice('עוד לא ידוע','לא יודע')];
 }
 if(j.stage==='STRATEGY_REVIEW'&&reply.endsWith('להתקדם לניסוח המודעות?'))return[choice('נכין מודעות','כן'),choice('רוצה לשנות','לא')];
 if(j.stage==='CREATIVE_REVIEW'&&/להכין תוכנית קמפיין.*\?$/.test(reply))return[choice('נכין תוכנית','כן'),choice('לשנות את המודעות','לא אהבתי את המודעה')];
 if(j.stage==='IDLE'&&/מה נרצה לעשות היום|במה נרצה להתחיל/.test(reply))return[choice('קמפיין חדש','אני רוצה קמפיין'),choice('חיבור חשבון Meta','חבר חשבון מטא'),choice('בדיקת פרסום קיים','מצב חיבור חשבון מטא')];
 return[];
}
function payload(body,items,nonce){
 if(typeof body!=='string'||body.length>1024||!Array.isArray(items)||items.length<1||items.length>10)throw Error('INVALID_INTERACTIVE_MESSAGE');
 const rows=items.map((c,i)=>({id:`cb:${nonce}:${i}`,title:c.title,...(c.description?{description:c.description}:{})}));
 if(rows.some(r=>!r.title||r.title.length>(items.length<=3?20:24)||(r.description||'').length>72))throw Error('INVALID_INTERACTIVE_CHOICE');
 return{type:'interactive',interactive:{type:items.length<=3?'button':'list',body:{text:body},footer:{text:FOOTER},action:items.length<=3?{buttons:rows.map(r=>({type:'reply',reply:{id:r.id,title:r.title}}))}:{button:'לבחירה',sections:[{title:'האפשרויות שלך',rows}]}}};
}
async function prepare(clientId,reply){
 let result={text:reply};
 await store.update(clientId,null,p=>{
  const items=choices(p,reply);
  // Long creative outputs remain ordinary messages; only clear decision points receive controls.
  if(!items.length||reply.length>1024){if(p.ui){delete p.ui;return{handled:false,changed:true};}return{handled:false};}
  const nonce=crypto.randomBytes(12).toString('hex');
  const interactivePayload=payload(reply,items,nonce);
  p.ui={nonce,context:context(p),choices:items,expiresAt:Date.now()+24*60*60*1000};
  result={text:reply,interactivePayload};return{handled:false,changed:true};
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
