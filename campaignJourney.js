'use strict';
const crypto=require('node:crypto');
const facts=require('./conversationFacts');
const {norm,localAnalysis}=require('./conversationAnalysis');
const CORE=['businessType','businessGoal','product','audience','geography','advantage','dailyBudget','leadDestination'];
const QUESTIONS={businessType:'מה העסק עושה, ובאיזה שם הוא פועל?',businessGoal:'מה המטרה העסקית העיקרית של הפרסום?',product:'איזה מוצר או שירות נרצה לקדם?',audience:'מי הלקוחות שרוצים להגיע אליהם?',geography:'באיזה אזור נרצה לפרסם?',advantage:'למה לקוחות בוחרים דווקא בעסק שלך?',dailyBudget:'מה תקציב המדיה היומי ובאיזה מטבע?',leadDestination:'לאן נרצה לקבל פניות: WhatsApp, טלפון, אתר או טופס?',offerMediaSeparate:'האם תקציב המדיה משולם בנפרד מההטבה?',offerScope:'מה בדיוק כלול בתקופת הניהול במתנה?',offerCommitment:'מה תנאי ההצעה, והאם יש התחייבות אחריה?',creativeFeedback:'מה נרצה לשנות במודעה: המסר, הסגנון או ההצעה?'};
const EXPLANATIONS={product:'הכוונה לשירות אחד שנרצה להביא אליו ביקוש. למשל ניהול קמפיינים ב-Meta, ולא שם העסק.',audience:'הכוונה לאנשים או לעסקים שנרצה שיפנו בעקבות המודעה.',dailyBudget:'זה הסכום שמשולם לפלטפורמת הפרסום בכל יום, בנפרד מדמי הניהול.',offerMediaSeparate:'נפריד בין ניהול במתנה לבין הכסף שמשולם ל-Meta על הצגת המודעות.'};
function init(p){
 if(p.journey?.schemaVersion===2)return p.journey;
 p.journey={schemaVersion:2,controller:'marketing',stage:'IDLE',pendingField:null,paused:false,revision:1,asked:[],draft:null,strategyApproved:false,creativeApproved:false,planApproved:false};
 // Existing answers remain in place; only obsolete interview control state is replaced.
 if(p.session?.route==='onboarding'){p.journey.stage='DISCOVERY';p.journey.paused=!!p.session.paused;p.journey.pendingField=Object.keys(facts.FIELDS).find(f=>facts.FIELDS[f].id===p.session.pendingId)||null;}
 return p.journey;
}
function missing(p){return CORE.filter(field=>!facts.read(p,field));}
function offerMissing(p){if(!/14\s*(?:יום|ימים)/.test(facts.value(p,'offer')||''))return[];return ['offerMediaSeparate','offerScope','offerCommitment'].filter(f=>!facts.read(p,f));}
function nextField(p){return [...missing(p),...offerMissing(p)][0]||null;}
function stageReply(p,stage,prefix=''){
 const j=p.journey;j.stage=stage;j.pendingField=null;j.paused=false;
 const d=j.draft&&!j.draft.stale&&j.draft.revision===j.revision?j.draft:buildDraft(p);j.draft=d;
 let reply;
 if(stage==='STRATEGY_REVIEW')reply=`הכיוון המוצע:\nמטרה עסקית: ${d.businessGoal}.\n${d.strategy}\nקהל: ${d.audience}.\nאזור: ${d.geography}.\n${d.budgetText}\n\nלהתקדם לניסוח המודעות?`;
 else if(stage==='CREATIVE_REVIEW')reply=d.creatives.map((a,i)=>`מודעה ${i+1}\n${a.headline}\n${a.body}\n${a.cta}`).join('\n\n')+'\n\nלהכין תוכנית קמפיין עם המודעות האלה?';
 else reply=`טיוטת תוכנית הקמפיין:\n${d.strategy}\nשירות: ${d.product}\nקהל: ${d.audience}\nאזור: ${d.geography}\n${d.budgetText}\nיעד פנייה: ${d.destination}\nמדד עסקי: ${d.businessGoal}\n${d.missing.length?'פרטים שעדיין חסרים: '+d.missing.join(', ')+'.\n':''}הטיוטה נשמרה מקומית. לא נוצר ולא הופעל קמפיין ב-Meta. אפשר לתקן פרטים או לבקש לחבר חשבון פרסום.`;
 return {handled:true,reply:(prefix?prefix+'\n\n':'')+reply,decisionKey:stage==='STRATEGY_REVIEW'?'strategy_review':stage==='CREATIVE_REVIEW'?'creative_review':null};
}
function buildDraft(p){
 const f=facts.all(p),knownBudget=facts.read(p,'dailyBudget')?.status==='known'?f.dailyBudget:null;
 const product=f.product||f.businessType||'השירות של העסק',destination=f.leadDestination||'יעד פנייה שטרם נקבע';
 const sales=/מכירות|הכנסות|לקוחות/.test(f.businessGoal||'');
 const strategy=sales?`המטרה נשארת ${f.businessGoal}. נציע להביא לקוחות מתאימים דרך ${destination}, ונמדוד גם עסקאות והכנסות; פנייה היא שלב בדרך למכירה.`:`נציע לפרסם את ${product} לקהל המתאים ולהפנות ל-${destination}. התאמת יעד האופטימיזציה תיבדק מול אפשרויות החשבון.`;
 const offerFields=['offerMediaSeparate','offerScope','offerCommitment'];
 const termsKnown=!/14\s*(?:יום|ימים)/.test(f.offer||'')||offerFields.every(field=>facts.read(p,field)?.status==='known');
 const promotion=f.offer&&termsKnown?f.offer:'';
 const terms=promotion?[f.offerMediaSeparate===true?'תקציב המדיה משולם בנפרד.':f.offerMediaSeparate===false?'תנאי מימון המדיה דורשים אישור לפני פרסום.':'',f.offerScope,f.offerCommitment].filter(Boolean).join(' '):'';
 const creatives=[
  {headline:promotion||`${product} עם ${f.businessName||'הצוות שלנו'}`,body:[f.audience?`עבור ${f.audience}.`:'',`מציעים ${product}.`,f.advantage?`הדגש שלנו: ${f.advantage}.`:'',promotion,terms].filter(Boolean).join(' '),cta:'לפרטים ובדיקת התאמה, אפשר לפנות אלינו.'},
  {headline:`מחפשים ${product}?`,body:[`${f.businessName||'העסק'} מציע ${product}.`,f.geography?`שירות באזור ${f.geography}.`:'',f.advantage,promotion,terms].filter(Boolean).join(' '),cta:'נדבר על הצורך ונבדוק התאמה.'}
 ];
 return{schemaVersion:1,id:crypto.randomUUID(),revision:p.journey.revision,status:'LOCAL_DRAFT',mediaAssetId:p.mediaContext?.assetId||null,totalBudgetPlan:p.mediaBudgetPlan?.planId===p.planId?p.mediaBudgetPlan:null,businessGoal:f.businessGoal||'לא הוגדרה',strategy,product,audience:f.audience||'טרם הוגדר',geography:f.geography||f.serviceArea||'טרם הוגדר',destination,dailyBudget:knownBudget||null,budgetText:knownBudget?`תקציב מדיה מוצע: ${facts.display(knownBudget)}. זהו סכום לתכנון, ללא אישור להוצאה.`:'תקציב מדיה מאושר טרם הוגדר.',budgetAllocation:knownBudget?[{purpose:'בדיקת הצעה וקהל אחד תחילה, בלי לפצל תקציב לפני למידה',share:1,dailyBudget:knownBudget,status:'PROPOSED'}]:[],measurement:{businessOutcome:f.businessGoal||null,intermediateMetric:'פניות מתאימות כאשר מסלול הקנייה מבוסס פניות',successThreshold:null,reviewRule:'יש להגדיר תקופה ומדגם לפי מחזור המכירה והנתונים הזמינים'},creatives,missing:[...CORE.filter(k=>!facts.value(p,k)),...(!termsKnown?offerFields.filter(field=>facts.read(p,field)?.status!=='known'):[])].map(k=>facts.FIELDS[k].label),requiresApproval:true,createdAt:new Date().toISOString(),stale:false};
}
function advance(p,{target='strategy',prefix=''}={}){
 const j=p.journey;const field=nextField(p);
 if(field){j.stage='DISCOVERY';j.pendingField=field;j.paused=false;if(!j.asked.includes(field))j.asked.push(field);return{handled:true,reply:(prefix?prefix+'\n\n':'')+(field==='dailyBudget'?require('./budgetGuidance').explain()+'\n\n':'')+QUESTIONS[field],decisionKey:['businessGoal','dailyBudget','leadDestination','offerMediaSeparate'].includes(field)?field:null};}
 return stageReply(p,target==='ad'?'CREATIVE_REVIEW':target==='plan'?'PLAN_REVIEW':'STRATEGY_REVIEW',prefix);
}
function parsePending(field,text){
 const n=norm(text);
 if(require('./conversationControl').hasControlContamination(text))return{error:'כדי להתחיל שיחה חדשה אפשר לכתוב ״נתחיל מחדש״. מה נרצה לעשות?'};
 if(/^(לא יודע(?:ת)?|לא ידוע|אין לי נתון|דלג|לא בטוח(?:ה)?)$/.test(n))return{status:'unknown',value:null};
 if(/^(לא רלוונטי|לא חל)$/.test(n))return{status:'not_applicable',value:null};
 if(field==='dailyBudget'){
  const found=localAnalysis(text).updates.find(u=>u.field==='dailyBudget');
  return found?{value:found.value}:{error:'מה הסכום היומי ובאיזה מטבע? למשל 100 ₪ ביום. תקציב חודשי לא יהפוך אוטומטית לתקציב יומי.'};
 }
 if(field==='offerMediaSeparate')return /^(כן|נכון|בנפרד)$/.test(n)?{value:true}:/^(לא|כלול)$/.test(n)?{value:false}:{error:'האם המדיה משולמת בנפרד? אפשר לענות כן, לא או לא ידוע.'};
 if(!text.trim()||text.length>1000)return{error:'אפשר לשלוח תשובה קצרה וממוקדת?'};
 return{value:text.trim(),status:/^בערך|^להערכתי/.test(text)?'estimated':'known'};
}
function transition(p,text,{analysis=localAnalysis(text),now=new Date().toISOString()}={}){
 const j=init(p),n=norm(text);const oldPending=j.pendingField;
 const result=(reply,extra={})=>({handled:true,reply,...extra});
 if(require('./conversationControl').isReset(text))return{handled:false,resetRequested:true};
 if(analysis.analysisUnavailable&&j.stage==='DISCOVERY'&&oldPending)return result('לא הצלחתי לפרש בביטחון את כל הפרטים בהודעה. נשמור על מה שכבר ידוע.\n'+QUESTIONS[oldPending]);
 if(oldPending==='dailyBudget'&&/כמה.*(?:נותן|ייתן|פניות|לידים|מכירות|חשיפות)|מה.*תקציב.*נותן|מה מקבלים|עזרה.*תקציב/.test(text))return result(require('./budgetGuidance').explain()+'\n\n'+QUESTIONS.dailyBudget,{decisionKey:'dailyBudget'});
 if(analysis.intent==='pause'){j.paused=true;return result('עצרנו כאן. הפרטים נשמרו, ואפשר לחזור כשנוח.');}
 if(analysis.intent==='capabilities')return result('אני עוזר להכין קמפיין לעסק: כיוון שיווקי, תמונות ומודעות ותוכנית לפרסום. אפשר גם לבדוק תוצאות מחשבון מחובר. במה נרצה להתחיל?');
 if(text==='נוסח לסרטון ששלחתי'){j.requestedOutput='ad';return advance(p,{target:'ad',prefix:'נכין נוסח שאפשר לשלב בסרטון, לפי פרטי העסק.'});}
 if(analysis.intent==='greeting'){
  if(j.draft&&!j.draft.stale&&['STRATEGY_REVIEW','CREATIVE_REVIEW','PLAN_REVIEW'].includes(j.stage))return stageReply(p,j.stage,'היי, הפרטים מהשיחה הקודמת שמורים. נמשיך מהמקום שבו עצרנו.');
  if(j.stage!=='IDLE'&&j.stage!=='COMPLETE')return advance(p,{target:j.requestedOutput||'strategy',prefix:'היי, הפרטים מהשיחה הקודמת שמורים. נמשיך מהמקום שבו עצרנו.'});
  return result('היי! אני קמפיין בצ׳ט. נכיר בקצרה את העסק, נכין כיוון ומודעות, ואז נציג תוכנית לבדיקה שלך. נחבר חשבון פרסום כשצריך; פרסום ידרוש אישור נפרד. אפשר לבחור בלחיצה, לכתוב או לשלוח הודעה קולית. מה נרצה לעשות היום?',{decisionKey:'welcome'});
 }
 if(analysis.intent==='clarify')return result(oldPending?(EXPLANATIONS[oldPending]||'כדי לבחור כיוון שמתאים לעסק, חסר הפרט הזה.')+'\n'+QUESTIONS[oldPending]:'אפשר לציין איזה פרט כדאי להסביר?');
 if(analysis.intent==='summary')return result(facts.summary(p)||'עדיין לא נמסרו פרטי עסק. אפשר לספר במה העסק עוסק.');
 if(['connect','connection_status','select_account','disconnect','renew','knowledge','report'].includes(analysis.intent))return{handled:false,connectionIntent:analysis.intent};
 if(/^(אפיון חדש|קמפיין חדש)$/.test(n)){p.planId=crypto.randomUUID();p.journey=null;init(p);p.journey.stage='DISCOVERY';return advance(p,{prefix:'נתכנן קמפיין חדש ונשתמש בפרטי העסק שכבר שמורים. אפשר לעדכן כל פרט.'});}
 const changed=[];
 try{for(const u of analysis.updates||[])facts.validate(u.field,u.value);}catch{return result('הפרט לא נשמר כי הערך לא תקין. אפשר לשלוח ערך חיובי עם יחידה ומטבע כשנדרש?');}
 if(oldPending==='offerScope'&&/ניהול|בדיקה|מודעות|קמפיין/.test(text)&&!/[?？]/.test(text)&&analysis.intent==='other'){
  if(facts.write(p,'offerScope',text,{evidence:text,now}))changed.push('offerScope');
 }
 for(const u of analysis.updates||[]){
  if(oldPending==='offerScope'&&u.field==='offer'&&facts.value(p,'offer')&&!/מתנה|הצעה חדשה/.test(text))continue;
  if(facts.write(p,u.field,u.value,{evidence:u.evidence,now}))changed.push(u.field);
 }
 if(changed.length)facts.correctionsInvalidate(p,changed);
 if(analysis.intent==='ad'&&/לא אהבתי|שפר|שנה|שני|לתקן/.test(text)&&j.draft){j.pendingField='creativeFeedback';return result(QUESTIONS.creativeFeedback);}
 if(oldPending==='creativeFeedback'&&!changed.length&&!['pause','greeting','summary','clarify'].includes(analysis.intent)){
  return require('./creativeRevision').revise(p,text);
 }

 if(analysis.intent==='yes'){
  if(j.pendingAction==='prepare_local_draft'){j.pendingAction=null;return advance(p);}
  if(j.stage==='STRATEGY_REVIEW'){j.strategyApproved=true;return stageReply(p,'CREATIVE_REVIEW');}
  if(j.stage==='CREATIVE_REVIEW'){j.creativeApproved=true;return stageReply(p,'PLAN_REVIEW');}
  if(j.stage==='PLAN_REVIEW')return result('אפשר להכין את הטיוטה לחיבור חשבון Meta. פרסום והפעלה דורשים פרטים מלאים ואישור נפרד; ״כן״ אינו אישור להוצאה.');
  if(oldPending==='offerMediaSeparate'){facts.write(p,oldPending,true,{now,evidence:text});return advance(p,{target:j.requestedOutput});}
  return result(oldPending?`כדי להמשיך חסרה תשובה ממוקדת:\n${QUESTIONS[oldPending]}`:'למה מתייחס ה״כן״? אפשר לציין את הפעולה הרצויה.');
 }
 if(analysis.intent==='no'&&oldPending==='offerMediaSeparate'){facts.write(p,oldPending,false,{now,evidence:text});return advance(p,{target:j.requestedOutput});}
 if(analysis.intent==='no')return result('מה נרצה לשנות בכיוון שהצעתי?');
 const wantsBuild=['build','ad','strategy','plan','continue'].includes(analysis.intent);
 if(wantsBuild){
  if(['ad','plan','strategy'].includes(analysis.intent))j.requestedOutput=analysis.intent;
  if(!j.requestedOutput)j.requestedOutput='strategy';
  // Resume the actual current stage instead of silently returning to discovery.
  if(analysis.intent==='continue'&&j.draft&&!j.draft.stale&&['STRATEGY_REVIEW','CREATIVE_REVIEW','PLAN_REVIEW'].includes(j.stage)){
    if(j.paused)return stageReply(p,j.stage);
    if(j.stage==='STRATEGY_REVIEW'){j.strategyApproved=true;return stageReply(p,'CREATIVE_REVIEW');}
    if(j.stage==='CREATIVE_REVIEW'){j.creativeApproved=true;return stageReply(p,'PLAN_REVIEW');}
    return result('הטיוטה המקומית מוכנה ושמורה. אפשר לבקש לחבר חשבון Meta או לתקן פרט בתוכנית. לא בוצע פרסום.');
  }
  return advance(p,{target:j.requestedOutput,prefix:j.stage==='IDLE'?'נכין כיוון לפרסום. אשאל עד שמונה שאלות קצרות לפי מה שחסר, ואפשר לתקן פרטים בכל שלב.':''});
 }
 if((analysis.updates||[]).length){
  if(j.stage==='IDLE')return result('שמרתי את הפרטים על העסק. אפשר לבקש להכין קמפיין או לשאול שאלה.');
  return advance(p,{target:j.requestedOutput||'strategy',prefix:analysis.correction?'עדכנתי רק את הפרטים ששונו.':''});
 }
 if(j.stage==='DISCOVERY'&&oldPending&&!j.paused&&analysis.intent==='other'&&!/[?？]/.test(text)&&!/^(איך|למה|מה |ספר|ספרי|תסביר|תסבירי|אפשר |תיצור |תצור |צור |שאלה אחרת)/.test(text)){
  const parsed=parsePending(oldPending,text);if(parsed.error)return result(parsed.error);
  facts.write(p,oldPending,parsed.value,{status:parsed.status||'known',evidence:text,now});j.pendingField=null;
  return advance(p,{target:j.requestedOutput||'strategy'});
 }
 return{handled:false};
}
module.exports={CORE,QUESTIONS,EXPLANATIONS,init,missing,offerMissing,nextField,advance,buildDraft,parsePending,transition};

