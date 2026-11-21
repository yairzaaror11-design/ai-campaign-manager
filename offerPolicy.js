'use strict';
const crypto=require('node:crypto'),facts=require('./conversationFacts');
const FIELDS=['offer','offerScope','offerCommitment','offerMediaSeparate'];
function fingerprint(p,channel){return crypto.createHash('sha256').update(JSON.stringify([p.planId,channel,facts.value(p,'product')||facts.value(p,'businessType'),channel==='social'?p.contentBrief?.purpose:null,...FIELDS.map(k=>facts.value(p,k))])).digest('hex');}
function allowed(p,channel){
 const a=p.offerSelections?.[channel];
 return !!(facts.value(p,'offer')&&a&&a.hash===fingerprint(p,channel)&&Number.isFinite(a.confirmedAt)&&Date.now()-a.confirmedAt>=0&&Date.now()-a.confirmedAt<86400000&&(channel!=='social'||p.contentBrief?.purpose==='PROMOTION'));
}
function filteredFacts(p,channel){const f=facts.all(p);if(!allowed(p,channel))for(const k of FIELDS)delete f[k];return f;}
function copyFacts(p,channel){const f=filteredFacts(p,channel);delete f.dailyBudget;return f;}
function missing(p){if(!p.offerIntent||!/14\s*(?:יום|ימים)/.test(facts.value(p,'offer')||''))return[];return ['offerMediaSeparate','offerScope','offerCommitment'].filter(k=>!facts.read(p,k));}
function review(p){
 const channel=p.offerIntent.channel;
 if(/14\s*(?:יום|ימים)/.test(facts.value(p,'offer')||'')&&['offerMediaSeparate','offerScope','offerCommitment'].some(k=>facts.read(p,k)?.status!=='known')){clear(p);p.offerSelections={...(p.offerSelections||{}),[channel]:null};return require('./campaignJourney').advance(p,{target:p.journey.requestedOutput||'plan',prefix:'נכין את התוכן בלי ההטבה עד שנדע את התנאים שלה.'});}
 p.offerReview={channel,hash:fingerprint(p,channel),expiresAt:Date.now()+600000};
 p.journey.pendingField=null;p.journey.detour=false;
 const f=facts.all(p),terms=[f.offer,f.offerScope,f.offerCommitment,f.offerMediaSeparate===true?'תקציב המדיה משולם בנפרד.':f.offerMediaSeparate===false?'תנאי מימון המדיה דורשים אישור לפני פרסום.':null].filter(Boolean).join('\n');
 return{handled:true,reply:`ההצעה ששמורה היא:\n${terms}\n\nהיא עדיין בתוקף ומתאימה לתוכן הזה?`,decisionKey:'offer_use'};
}
function clear(p){delete p.offerReview;delete p.offerIntent;}
function sanitize(p){
 const d=p.journey?.draft;if(d?.offerFingerprint&&d.offerFingerprint!==(allowed(p,'paid')?fingerprint(p,'paid'):'none'))d.stale=true;
 const oldOffer=facts.value(p,'offer');
 for(const [channel,draft,key]of [['paid',d,'creatives'],['social',p.socialContent,'items']]){
  if(!draft)continue;
  if(draft.offerFingerprint&&draft.offerFingerprint!==(allowed(p,channel)?fingerprint(p,channel):'none'))draft.stale=true;
  if(!draft.offerFingerprint&&oldOffer&&JSON.stringify(draft[key]||[]).includes(oldOffer)&&!allowed(p,channel))draft.stale=true;
 }
}
function handle(p,text,analysis){
 const channel=p.journey.requestedOutput==='social'?'social':'paid';
 if(p.offerReview&&/^(כן|נכון|ההצעה בתוקף לתוכן הזה|נמשיך בלי ההצעה|לא)$/.test(text)){
  const r=p.offerReview;
  if(p.journey.detour&&!/^(ההצעה בתוקף לתוכן הזה|נמשיך בלי ההצעה)$/.test(text))return null;
  if(r.expiresAt<Date.now()||r.hash!==fingerprint(p,r.channel)){delete p.offerReview;return review(p);}
  const yes=/^(כן|נכון|ההצעה בתוקף לתוכן הזה)$/.test(text);
  p.offerSelections={...(p.offerSelections||{}),[r.channel]:yes?{hash:r.hash,confirmedAt:Date.now()}:null};
  clear(p);facts.correctionsInvalidate(p,['offer_selection']);
  return require('./campaignJourney').advance(p,{target:p.journey.requestedOutput||'plan',prefix:yes?'נשתמש בהצעה שאישרת לתוכן הזה.':'נמשיך בלי ההצעה.'});
 }
 if(/^(?:בלי (?:מבצע|הטבה|ההצעה)|אל תשתמש בהצעה)$/.test(text)){
  p.offerSelections={...(p.offerSelections||{}),[channel]:null};clear(p);facts.correctionsInvalidate(p,['offer_selection']);
  return require('./campaignJourney').advance(p,{target:p.journey.requestedOutput||'plan'});
 }
 const explicit=/^(?:תשתמש|השתמש|תשתמשי|השתמשי|נשתמש|שלב|שלבי|תשלב|תשלבי).*(?:הצעה|מבצע|הטבה)|^(?:תכין|תכיני|כתוב|כתבי).*(?:פוסט|מודעה).*(?:עם ההצעה|על המבצע)/.test(text);
 const newOffer=(analysis.updates||[]).some(u=>u.field==='offer')&&analysis.messageKind!=='side_question';
 if(!explicit&&!newOffer)return null;
 if(channel==='social')p.contentBrief={purpose:'PROMOTION',source:'user_explicit'};
 p.offerIntent={channel};delete p.offerReview;
 if(!facts.value(p,'offer')){p.journey.stage='DISCOVERY';p.journey.pendingField='offer';return{handled:true,reply:'מה ההצעה שתרצה להציג, כולל המחיר או התנאים הרלוונטיים?'};}
 return require('./campaignJourney').advance(p,{target:p.journey.requestedOutput||'plan'});
}
function validateCopy(creatives,allowedText){
 const all=creatives.map(c=>[c.headline,c.body,c.cta].join(' ')).join(' ');
 for(const m of all.matchAll(/במתנה|חינם|ללא עלות|\d+\s*%|הנחה של/g))if(!allowedText.includes(m[0]))throw Error('UNAPPROVED_PROMOTION');
}
module.exports={FIELDS,fingerprint,allowed,filteredFacts,copyFacts,missing,review,handle,sanitize,validateCopy,clear};
