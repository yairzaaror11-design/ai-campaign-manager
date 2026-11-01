'use strict';
const crypto=require('node:crypto'),store=require('./marketingStore');
const FOOTER='אפשר גם לכתוב או לשלוח הודעה קולית';
function context(p){return JSON.stringify([p.planId,p.journey?.stage,p.journey?.pendingField,p.journey?.revision,p.journey?.inputMode,p.journey?.detour,p.connection?.status,p.connection?.account?.id,p.connection?.accountPage,p.connection?.accountQuery,JSON.stringify((p.connection?.accounts||[]).map(a=>a.id)),p.connection?.pendingQuestion,p.mediaContext?.assetId,p.mediaBudgetQuestion?.amount,p.businessImport?.foundAt,p.businessEntry?.awaitingConfirmation,p.socialContent?.id,p.socialContent?.revision,p.socialContent?.focus,p.journey?.requestedOutput,p.journey?.socialFeedbackPending,JSON.stringify(p.crmIntake||null),JSON.stringify(p.crmFollowup||null),p.crmFocus?.id,p.crmFocus?.version,JSON.stringify(p.crmMenu||[])]);}
const choice=(title,text,description)=>({title,text,...(description?{description}:{})});
const DECISIONS=["social_intent","advantage","journey_route","social_review","management_connect","crm_leads","crm_status","business_entry","business_import","plan_review","media_variant", "budget_period", "media_action", "has_ad_account", "connected", "connection_offer", "account_selection", "businessGoal", "dailyBudget", "leadDestination", "offerMediaSeparate", "strategy_review", "creative_review", "welcome"];
function choices(p,decisionKey){
 if(decisionKey==null)return [];
 if(!DECISIONS.includes(decisionKey))throw Error('INVALID_DECISION_KEY');
 const j=p.journey||{},pending=j.pendingField,connection=p.connection;
 if(decisionKey==='social_intent')return[choice('תוכן לסושיאל','תוכן לסושיאל'),choice('מודעה לפניות','נעבור לקמפיין פניות')];
 if(decisionKey==='journey_route')return[choice('להביא פניות ותורים','להביא פניות ותורים'),choice('תוכן לסושיאל','תוכן לסושיאל'),choice('לשלב את שניהם','לשלב את שניהם')];
 if(decisionKey==='social_review'&&p.socialContent)return[choice('להכין גרפיקה','תכין לי גרפיקה לפוסט של העסק'),choice('לשנות נוסח','שינוי נוסח לסושיאל'),choice(p.socialContent.focus===1?'לראות את הפוסט':'לראות את הסטורי',p.socialContent.focus===1?'תראה את הפוסט':'תראה את הסטורי'),choice('לוח תוכן לשבוע','לוח תוכן לשבוע'),choice('קמפיין פניות','נעבור לקמפיין פניות')];
 if(decisionKey==='crm_leads'&&p.crmMenu?.length)return p.crmMenu.map((x,i)=>choice(`${i+1}. ${x.name.slice(0,16)}`,`פתח פנייה ${i+1}`));
 if(decisionKey==='crm_status'&&p.crmFocus)return[choice('חדשה','סמן כפנייה חדשה'),choice('בטיפול','סמן פנייה בטיפול'),choice('נקבעה פגישה','סמן שנקבעה פגישה'),choice('נסגרה עסקה','סמן שנסגרה עסקה'),choice('לא הבשילה','סמן שהפנייה לא הבשילה')];
 if(decisionKey==='management_connect')return[choice('חיבור הרשאת יצירה','חבר הרשאת יצירת קמפיינים'),choice('להמשיך בטיוטה','לא עכשיו')];
 if(decisionKey==='business_entry')return[choice('אין לי קישור','אין לי קישור')];
 if(decisionKey==='business_import'&&p.businessEntry?.awaitingConfirmation)return[choice('הפרטים נכונים','הפרטים נכונים'),choice('לתקן פרטים','לתקן פרטים')];
 if(decisionKey==='plan_review'&&j.stage==='PLAN_REVIEW')return[choice('תצוגה והרשמה','תצוגה מקדימה'),choice('המשך ליצירה ב־Meta','המשך ליצירת הקמפיין'),choice('לשנות פרטים','לא'),choice('דיוק התוכנית','דיוק התוכנית'),choice('תוכן לסושיאל','תוכן לסושיאל')];
 if(decisionKey==='media_variant'&&p.mediaVariants?.length)return p.mediaVariants.map((_,i)=>choice(`גרסה ${i+1}`,`בחרתי גרסה ${i+1}`));
 if(decisionKey==='budget_period'&&p.mediaBudgetQuestion)return[choice('תקציב יומי','זה תקציב יומי'),choice('לכל הקמפיין','זה לכל הקמפיין'),choice('מחיר המוצר','זה מחיר המוצר')];
 if(decisionKey==='media_action'&&p.mediaContext)return[
 choice('נוסח למודעה','תכין לי מודעה עם הקובץ ששלחתי'),
 choice('תוכנית קמפיין','תכין תוכנית קמפיין עם הקובץ ששלחתי'),
 choice('פוסט לסושיאל','פוסט מהקובץ ששלחתי'),
 p.mediaContext.type==='image'?choice('גרסאות לתמונה','תיצור לי 3 תמונות מהתמונה ששלחתי'):choice('טקסט לסרטון','נוסח לסרטון ששלחתי')];
 if(decisionKey==='has_ad_account'&&connection?.pendingQuestion==='hasAdAccount')return [choice('יש לי חשבון','כן'),choice('זו הפעם הראשונה','לא')];
 if(decisionKey==='connected'&&connection?.status==='CONNECTED')return[choice('קמפיין חדש','אני רוצה קמפיין'),choice('בדיקת ביצועים','תוצאות השבוע')];
 if(decisionKey==='connection_offer'&&connection?.status==='CONNECTION_OFFERED')return[choice('שלחו קישור','כן'),choice('לא עכשיו','לא')];
 if(decisionKey==='account_selection'&&connection?.status==='ACCOUNT_SELECTION_REQUIRED'){
  const page=require('./accountMenu').page(connection);
  const items=page.items.map((a,i)=>choice(`${page.offset+i+1}. ${String(a.name).slice(0,16)}`,`/meta-select ${a.id}`,a.id));
  if(page.index>0)items.push(choice('הקודם',`/meta-page ${page.index-1}`));
  if(page.hasNext)items.push(choice('חשבונות נוספים',`/meta-page ${page.index+1}`));
  return items;
 }
 if(pending&&decisionKey===pending){
  if(pending==='advantage')return[choice('תציע לי כיוון','תציע לי כיוון')];
  if(pending==='dailyBudget'&&j.inputMode!=='budget_custom')return[...require('./budgetGuidance').OPTIONS.map(o=>choice(o.title,`${o.amount} שקל ביום`,o.description)),{...choice('סכום אחר','מה הכוונה?','אפשר להקליד סכום יומי ומטבע'),kind:'budget_custom'}];
  if(pending==='businessGoal'&&require('./businessEntry').enabled()&&p.businessEntry?.linkAsked)return[choice('יותר פניות','פניות מתאימות'),choice('מכירות','מכירות'),choice('תורים ופגישות','תורים ופגישות'),choice('תוכן לסושיאל','תוכן לסושיאל'),choice('גם תוכן וגם פניות','לשלב את שניהם'),choice('מטרה אחרת','מה הכוונה?')];
  if(pending==='businessGoal')return[choice('יותר מכירות','מכירות'),choice('לקוחות חדשים','לקוחות חדשים'),choice('יותר חשיפה לעסק','חשיפה למותג')];
  if(pending==='leadDestination')return[choice('WhatsApp','פניות בוואטסאפ'),choice('טלפון','שיחות טלפון'),choice('אתר העסק','אתר העסק'),choice('טופס פניות','טופס פניות'),choice('עוד לא החלטתי','לא יודע')];
  if(pending==='offerMediaSeparate')return[choice('המדיה בנפרד','כן'),choice('המדיה כלולה','לא'),choice('עוד לא ידוע','לא יודע')];
 }
 if(decisionKey==='strategy_review'&&j.stage==='STRATEGY_REVIEW')return[choice('נכין מודעות','כן'),choice('רוצה לשנות','לא')];
 if(decisionKey==='creative_review'&&j.stage==='CREATIVE_REVIEW')return[choice('נכין תוכנית','כן'),choice('לשנות את המודעות','לא אהבתי את המודעה')];
 if(decisionKey==='welcome'&&j.stage==='IDLE')return[choice('נפרסם מוצר או שירות','אני רוצה קמפיין'),choice('תוכן לסושיאל','תוכן לסושיאל'),choice('משהו אחר בראש','יש לי משהו אחר בראש')];
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
  reply=require('./personalConversation').decorate(p,reply,decisionKey);result.text=reply;
  const items=choices(p,decisionKey);
  // Long creative outputs remain ordinary messages; only clear decision points receive controls.
  if(!items.length){const changed=!!p.person||!!p.ui;if(p.ui)delete p.ui;return{handled:false,changed};}
  const nonce=crypto.randomBytes(12).toString('hex');
  const long=reply.length>1024;
  const interactivePayload=payload(long?'מה נרצה לעשות בשלב הבא?':reply,items,nonce);
  p.ui={nonce,decisionKey,context:context(p),choices:items,expiresAt:Date.now()+24*60*60*1000};
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
  selected=c.text;if(c.kind==='action_approval'){const ctx=require('./whatsappDelivery').messageContext.getStore();if(!ctx)return{handled:false};ctx.approvedActionId=c.actionId;selected='/approve-current '+c.actionId;}if(c.kind==='budget_custom')p.journey.inputMode='budget_custom';delete p.ui;
  return{handled:false,changed:true};
 });return selected;
}
async function refresh(clientId){
 const p=await store.load(clientId);
 const key=p?.ui?.decisionKey;
 if(key==='action_approval')return{text:'האישור הזה כבר לא עדכני. אפשר לבקש הצעה חדשה לפני ביצוע.'};
 const reply='הבחירה הזו כבר לא עדכנית. הנה האפשרויות המעודכנות; אפשר גם לענות בכתיבה.';
 if(key&&choices(p,key).length)return prepare(clientId,reply,key);
 return {text:reply+' כדי להציג את חשבונות הפרסום אפשר לכתוב ״החשבונות שלי״.'};
}
async function prepareApproval(clientId,approval,summary){
 const nonce=crypto.randomBytes(12).toString('hex');
 const creating=approval.actionPlan.intent==='CREATE_BUNDLE';
 const activating=approval.actionPlan.intent==='ACTIVATE_BUNDLE';
 const items=[{title:creating?'אישור יצירה מושהית':activating?'אישור הפעלה':'אישור השינוי',kind:'action_approval',actionId:approval.actionId,text:'אישור פעולה'},choice('ביטול','בטל את הפעולה הממתינה')];
 await store.update(clientId,null,p=>{p.ui={nonce,decisionKey:'action_approval',context:context(p),choices:items,expiresAt:new Date(approval.expiresAt).getTime()};return{handled:false,changed:true};});
 return{text:summary,leadingText:summary,interactivePayload:payload(creating?'לאשר יצירה במצב מושהה לפי הסיכום? אין הפעלה בשלב זה.':activating?'לאשר הפעלה לפי הסיכום? ההפעלה עשויה להתחיל הוצאה מתקציב הפרסום.':'לאשר את השינוי המדויק שבסיכום?',items,nonce)};
}
module.exports={choices,payload,prepare,prepareApproval,consume,context,refresh};

