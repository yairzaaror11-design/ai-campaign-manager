'use strict';
const facts=require('./conversationFacts');
function revise(p,text){
 const j=p.journey,n=require('./conversationAnalysis').norm(text);
 const mode=/קצר/.test(n)?'short':/אישי|אנושי|פשוט/.test(n)?'personal':/^(?:המסר|מסר(?: אחר)?|הכל|הכול|את הכל|את הכול|הסגנון|סגנון)$/.test(n)?'message':null;
 if(!mode){
  j.creativeFeedback=text.slice(0,1000);
  j.pendingField='creativeFeedback';
  return{handled:true,reply:/הצעה/.test(n)?'מה ההצעה החדשה שתרצה להציג במודעה?':'כדי לשנות את הנוסח, אפשר לבקש ״מסר אחר״, ״הכול״, ״קצר יותר״ או ״סגנון אישי״. מה לשנות?'};
 }
 const old=j.draft;
 if(!old||old.stale){j.pendingField=null;return require('./campaignJourney').advance(p,{target:'ad'});}
 const f=facts.all(p),product=f.product||f.businessType||'השירות של העסק';
 const base=require('./campaignJourney').buildDraft(p);
 const offer=base.creatives[0].body;
 const round=(j.creativeEditRevision||0)+1;
 const openers=round%2?['הצעד הבא של העסק מתחיל כאן','בואו נדבר על הצורך של העסק']:['כיוון חדש לעסק שלך','מכירים את העסק לפני שמתחילים'];
 const creatives=base.creatives.map((a,i)=>{
  if(mode==='short')return{headline:round%2?`${product} — בואו נדבר`:`נכיר את ${f.businessName||'העסק שלך'}`,body:offer,cta:'שלחו הודעה ונבדוק התאמה.'};
  if(mode==='personal')return{headline:openers[i],body:`נעים להכיר, ${f.businessName||'הצוות שלנו'} כאן. ${offer}`,cta:'ספרו לנו מה העסק צריך ונבדוק יחד התאמה.'};
  return{headline:openers[i],body:[f.audience?`${f.audience}, נתחיל ממה שחשוב לעסק שלכם.`:'נתחיל מהצורך של העסק.',`מחפשים ${product}?`,f.advantage?f.advantage+'.':'',f.offer?offer:`נכיר את העסק ונבדוק איך ${product} מתאים לו.`].filter(Boolean).join(' '),cta:round%2?'בואו נכיר — שלחו הודעה.':'לתיאום שיחת התאמה, פנו אלינו.'};
 });
 // A shorter version retains the explicitly agreed offer terms.
 if(mode==='short')for(const c of creatives)c.body=base.creatives[1].body.replace(/^.*?מציע /,'').replace(/שירות באזור [^.]+\.\s*/, '');
 if(JSON.stringify(creatives)===JSON.stringify(old.creatives))return{handled:true,reply:'כדי להכין גרסה שונה, מה תרצה להדגיש בנוסח החדש?'};
 facts.correctionsInvalidate(p,['creative_feedback']);
 j.creativeEditRevision=round;j.creativeFeedback=text.slice(0,1000);j.pendingField=null;j.stage='CREATIVE_REVIEW';
 j.draft={...base,revision:j.revision,creatives,stale:false,requiresApproval:true};
 return{handled:true,reply:'עדכנתי את הנוסח. הנה הגרסאות החדשות לבדיקה:\n\n'+creatives.map((a,i)=>`מודעה ${i+1}\n${a.headline}\n${a.body}\n${a.cta}`).join('\n\n')+'\n\nלהכין תוכנית קמפיין עם המודעות האלה?',decisionKey:'creative_review'};
}
module.exports={revise};
