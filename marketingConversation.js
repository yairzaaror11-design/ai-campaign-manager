'use strict';
const crypto=require('node:crypto');
const qs=require('./marketingQuestions');
const store=require('./marketingStore');
function enabled() {return process.env.MARKETING_DISCOVERY_ENABLED!=='false';}
function routeRequested(text) {
  const n=qs.normalized(text);
  if (/^(?:בוא |בואו |נתחיל |התחל |בוא נבדוק |בדיקת |בדוק |אפיון |נבדוק )?(?:רווחיות|כדאיות)$/.test(n)) return 'profitability';
  if (/^(?:בוא נבדוק |בדיקת |נבדוק |אפיון )?(?:לידים ומכירות|איכות לידים|לידים שלא נסגרים)$/.test(n)) return 'leads';
  if (/^(?:בוא נבדוק |בדיקת |נבדוק |אפיון )?(?:מדידה|תקינות מדידה)$/.test(n)) return 'measurement';
  if (/^(?:בוא נבדוק |בדיקת |נבדוק |אפיון )?(?:קהלי יעד|קהל יעד)$/.test(n)) return 'audience';
  if (/^(?:בוא נבדוק |בדיקת |נבדוק |אפיון )?(?:קריאייטיב|מסר למודעה)$/.test(n)) return 'creative';
  if (/^(?:בוא נתכנן |תכנון |נתכנן )ניסוי$/.test(n)) return 'experiment';
  if (/^(?:\/discovery|\/start|נתחיל|בוא נתחיל|התחל אפיון|אפיון עסק|היי|הי|שלום|שלום לך|שלום בוט)$/.test(n) || /^(?:אני )?(?:רוצה|צריך|צריכה) (?:לבנות |להכין )?קמפיין(?: חדש)?$/.test(n)) return 'onboarding';
  return null;
}
function asksOrChangesTask(text) {
  return /[?？]/.test(text)||/^(?:איך|למה|מה זה|מה הכוונה|תסביר|תסבירי|אפשר הסבר|צור|צרי|תכין|תכיני|הכן|הפעל|פרסם|אשר|שנה תקציב|תן לי|תני לי|אני רוצה לשאול)(?:\s|$)/.test(text);
}
function deliverNext(p,prefix='') {
  const q=qs.nextQuestion(p);
  if(!q) {
    p.session.pendingId=null;p.session.complete=true;
    return {handled:true,reply:`${prefix}${prefix?'\n\n':''}סיימנו את האפיון הזה.\n${qs.summary(p)}\n\nאפשר עכשיו לבקש המלצה, לבדוק קהל יעד, רווחיות או מדידה.`};
  }
  p.session.pendingId=q.id;
  return {handled:true,reply:(prefix?prefix+'\n\n':'')+q.whatsapp_text};
}
function record(p,q,answer,now) {
  const scope=qs.scopeFor(q,p),key=scope+':'+q.storage_field,prior=p.answers[key];
  const history=prior?[...(prior.history||[]),{value:prior.value,status:prior.status,verified_at:prior.verified_at}].slice(-8):[];
  p.answers[key]={questionId:q.id,field:q.storage_field,scope,value:answer.value,status:answer.status,unit:answer.unit||q.answer_type,source:'user_explicit',verified_at:now,period:null,confidence:answer.status==='estimated'?'low':'user_reported',history};
}
function diagnosticTransition(p,text,{now=new Date().toISOString()}={}) {
  const n=qs.normalized(text);
  if(/^(עצור|עצירה|נעצור|אחר כך|הפסק|מספיק|לא עכשיו)$/.test(n)) {
    if(!p.session) return {handled:false};
    p.session.paused=true;return {handled:true,reply:'עצרנו כאן. התשובות נשמרו. אפשר לכתוב ״נמשיך״ כשנוח לך.'};
  }
  if(/^(סיכום אפיון|מה כבר ידוע|\/discovery-status)$/.test(n)) return {handled:true,reply:qs.summary(p)||'עדיין לא נשמרו תשובות. אפשר לכתוב ״נתחיל״.'};
  const change=text.match(/^(?:עדכן|תקן)\s+([A-Z]+-\d{3})\s+([\s\S]+)$/i);
  if(change) {
    const q=qs.question(change[1].toUpperCase());
    if(!q||!qs.answerFor(p,q.id)) return {handled:true,reply:'לא מצאתי תשובה שמורה לשאלה הזו באפיון הנוכחי.'};
    const a=qs.parseAnswer(q,change[2]);if(a.error) return {handled:true,reply:a.error};
    record(p,q,a,now);return {handled:true,reply:'התשובה עודכנה.\n'+qs.summary(p)};
  }
  const newPlan=/^(אפיון חדש|קמפיין חדש)$/.test(n);
  const requested=newPlan?'onboarding':routeRequested(text);
  if(requested) {
    if(newPlan) p.planId=crypto.randomUUID();
    // A greeting in an existing interview resumes the same pending question.
    if(p.session&&!p.session.complete&&requested==='onboarding'&&!newPlan) {
      p.session.paused=false;p.session.awaitingContinue=false;
      return deliverNext(p,'נמשיך מהמקום שבו עצרנו.');
    }
    p.session={route:requested,pendingId:null,answersSinceSummary:0,paused:false,awaitingContinue:false,complete:false};
    return deliverNext(p,requested==='onboarding'?'היי, אני קמפיין בצ׳ט. נכיר את העסק ונבנה כיוון לפרסום, שאלה אחת בכל פעם. אפשר לכתוב ״לא ידוע״ או ״עצור״.':'נבדוק את זה יחד, שאלה אחת בכל פעם. אפשר לכתוב ״לא ידוע״ או ״עצור״.');
  }
  if(/^(להמשיך|נמשיך|המשך|ממשיכים|אפשר להמשיך)$/.test(n)||(n==='כן'&&p.session?.awaitingContinue)) {
    if(!p.session) return {handled:false};
    p.session.paused=false;p.session.awaitingContinue=false;p.session.answersSinceSummary=0;
    return deliverNext(p);
  }
  if(!p.session?.pendingId||p.session.paused||p.session.awaitingContinue||text.startsWith('/')||asksOrChangesTask(text)) return {handled:false};
  const q=qs.question(p.session.pendingId);
  const a=qs.parseAnswer(q,text);
  if(a.error) return {handled:true,reply:a.error};
  record(p,q,a,now);p.session.pendingId=null;p.session.answersSinceSummary++;
  return deliverNext(p,a.status==='unknown'?'סימנתי שלא ידוע; לא נשלים את הנתון בניחוש.':a.status==='not_applicable'?'סימנתי שלא רלוונטי לאפיון הנוכחי.':'');
}
function transition(p,text,options={}) {
 if(require('./conversationGreeting').isGreeting(text))return require('./campaignJourney').transition(p,text,{...options,analysis:{intent:'greeting',updates:[],correction:false}});
 if(/^(?:עדכן|תקן)\s+[A-Z]+-\d{3}\s+/i.test(text)){
  const r=diagnosticTransition(p,text,options);
  if(r.handled&&r.reply.startsWith('התשובה עודכנה')){require('./conversationFacts').correctionsInvalidate(p,['explicit_correction']);r.reply='התשובה עודכנה.\n'+require('./conversationFacts').summary(p);}
  return r;
 }
 if(require('./conversationControl').isReset(text))return{handled:false,resetRequested:true};
 const requested=routeRequested(text);
 const analysis=options.analysis||require('./conversationAnalysis').localAnalysis(text);
 if(requested&&requested!=='onboarding'){
  p.session=null;const r=diagnosticTransition(p,text,options);p.session.controller='diagnostic';return r;
 }
 if(p.session?.controller==='diagnostic'&&!['build','ad','strategy','plan'].includes(analysis.intent))return diagnosticTransition(p,text,options);
 const r=require('./campaignJourney').transition(p,text,{...options,analysis});
 if(r.handled&&p.session?.route==='onboarding')p.session=null;
 return r;
}
async function hydrateLegacy(clientId,p){
 if(p.journey?.historyImported)return p;
 const history=(await require('./db').query("SELECT content,created_at FROM (SELECT id,content,created_at FROM conversation_messages WHERE client_id=$1 AND role='user' ORDER BY created_at DESC,id DESC LIMIT 200) recent ORDER BY created_at ASC",[clientId])).rows;
 const latest=new Map();for(const row of history)for(const u of require('./conversationAnalysis').localAnalysis(row.content).updates)latest.set(u.field,{...u,now:row.created_at});
 for(const u of latest.values())if(!require('./conversationFacts').read(p,u.field))require('./conversationFacts').write(p,u.field,u.value,{evidence:u.evidence,source:'legacy_user_history',now:u.now});
 require('./campaignJourney').init(p).historyImported=true;return p;
}
async function handleMarketingMessage(clientId,text,eventId,options={}) {
  if(!enabled()) return {handled:false};
  for(let attempt=0;attempt<2;attempt++){
    const existing=await store.load(clientId);
    const previous=eventId&&existing?.events.find(e=>e.id===eventId);if(previous)return previous.result;
    const snapshot=await hydrateLegacy(clientId,existing||store.emptyProfile());
    const analysis=await require('./conversationAnalysis').analyze(text,snapshot,options);
    if(analysis.intent==='report'){
      if(options.onSlow)await options.onSlow();const status=await require('./metaConversation').verify(clientId);
      if(!status.canRead)return{handled:true,reply:require('./metaConversation').statusReply(status)};
      try{return{handled:true,reply:await require('./reportService').campaignReport(clientId,'last_7d')};}
      catch{return{handled:true,reply:'לא הצלחתי לקרוא את הדוח כרגע. אין לי נתונים שאפשר לדווח עליהם בביטחון.'};}
    }
    const metaIntent=['connect','connection_status','select_account','disconnect','renew','knowledge'].includes(analysis.intent)||text.startsWith('/meta-')||/להתחיל לפרסם (?:בפייסבוק|במטא)/.test(text)||(['yes','no'].includes(analysis.intent)&&snapshot.connection?.pendingQuestion==='hasAdAccount')||(analysis.intent==='yes'&&snapshot.connection?.status==='CONNECTION_OFFERED')||(snapshot.connection?.status==='ACCOUNT_SELECTION_REQUIRED'&&/^\d+$/.test(text));
    if(metaIntent){if(options.onSlow&&analysis.intent!=='knowledge')await options.onSlow();return require('./metaConversation').handle(clientId,text,analysis,eventId);}
    try{return await store.update(clientId,eventId,p=>{
      if((p.version||0)!==(existing?.version||0))throw Error('STALE_CONVERSATION_ANALYSIS');
      if(!existing)p.planId=snapshot.planId;
      p.answers=snapshot.answers;if(!p.journey)p.journey=snapshot.journey;
      const result=transition(p,text,{analysis});
      if(result.handled)result.audit=p.journey?.stage||'DIAGNOSTIC';
      if(!result.handled&&Object.keys(p.answers).length!==Object.keys(existing?.answers||{}).length)result.changed=true;
      return result;
    });}catch(error){if(error.message!=='STALE_CONVERSATION_ANALYSIS'||attempt)throw error;}
  }
}
module.exports={enabled,routeRequested,transition,diagnosticTransition,handleMarketingMessage,asksOrChangesTask};

