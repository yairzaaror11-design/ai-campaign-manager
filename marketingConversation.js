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
function transition(p,text,{now=new Date().toISOString()}={}) {
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
  if(/^(נמשיך|המשך|ממשיכים|אפשר להמשיך)$/.test(n)||(n==='כן'&&p.session?.awaitingContinue)) {
    if(!p.session) return {handled:false};
    p.session.paused=false;p.session.awaitingContinue=false;p.session.answersSinceSummary=0;
    return deliverNext(p);
  }
  if(!p.session?.pendingId||p.session.paused||p.session.awaitingContinue||text.startsWith('/')||asksOrChangesTask(text)) return {handled:false};
  const q=qs.question(p.session.pendingId);
  const a=qs.parseAnswer(q,text);
  if(a.error) return {handled:true,reply:a.error};
  record(p,q,a,now);p.session.pendingId=null;p.session.answersSinceSummary++;
  if(p.session.answersSinceSummary>=3&&qs.nextQuestion(p)) {
    p.session.awaitingContinue=true;
    return {handled:true,reply:'זה מה ששמרתי עד עכשיו:\n'+qs.summary(p)+'\n\nלהמשיך? אפשר לכתוב ״נמשיך״ או לעצור כאן.'};
  }
  return deliverNext(p,a.status==='unknown'?'סימנתי שלא ידוע; לא נשלים את הנתון בניחוש.':a.status==='not_applicable'?'סימנתי שלא רלוונטי לאפיון הנוכחי.':'');
}
async function handleMarketingMessage(clientId,text,eventId) {
  if(!enabled()) return {handled:false};
  return store.update(clientId,eventId,p=>transition(p,text));
}
module.exports={enabled,routeRequested,transition,handleMarketingMessage,asksOrChangesTask};
