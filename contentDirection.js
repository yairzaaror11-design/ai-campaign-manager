'use strict';
const facts=require('./conversationFacts');
const PURPOSES={SHOW_WORK:'הצגת עבודה',EXPLAIN_SERVICE:'הסבר שירות',BUSINESS_UPDATE:'עדכון מהעסק',INQUIRY:'הזמנה לפנייה',PROMOTION:'הצעה מסחרית'};
function choose(p,text){
 const n=String(text),product=facts.value(p,'product')||facts.value(p,'businessType');
 if(/(?:מה|איזה).*(?:כדאי|ממליץ).*(?:פוסט|תוכן)|(?:מעניין|רוצה|אפשר).*(?:עדכונים|חדשות).*(?:עסק|עסקי)/.test(n)){
  p.contentBrief={purpose:'BUSINESS_UPDATE',source:'user_requested_topic'};p.socialInput={kind:'UPDATE'};p.journey.requestedOutput='social';p.journey.detour=false;
  return{handled:true,reply:product?`אפשר להתחיל בעדכון קצר על ${product}. מה חדש אצלך השבוע? אפשר לשלוח גם תמונה, ואכין מזה טיוטת פוסט.`:'נתחיל מעדכון אחד אמיתי מהעסק. מה חדש אצלך השבוע? אפשר לשלוח גם תמונה, ואכין מזה טיוטת פוסט.'};
 }
 if(/^(?:נציג עבודה|פוסט על עבודה|להציג עבודה)$/.test(n)){
  p.contentBrief={purpose:'SHOW_WORK',source:'user_requested_topic'};p.socialInput={kind:'PHOTO'};p.journey.requestedOutput='social';p.journey.detour=false;
  return{handled:true,reply:'נראה ללקוחות עבודה שלך במקום להסתפק בהבטחות. אפשר לשלוח תמונה ומשפט על מה שעשית, ואכין טיוטת פוסט.'};
 }
 return null;
}
function capture(p,text,analysis){
 if(!p.socialInput||analysis.messageKind==='request'||require('./socialContent').requested(text)||/לא.*(?:תוכן|פוסט|סטורי)/.test(text)||analysis.messageKind==='side_question'||['ad','pause','report','connect','disconnect','greeting','summary','clarify','build','plan','strategy'].includes(analysis.intent)||/[?？]/.test(text)||require('./conversationFlexibility').isDetour(text))return null;
 if(/^(כן|לא|בטח|אוקיי|אוקי)$/.test(text))return{handled:true,reply:p.socialInput.kind==='PHOTO'?'אפשר לשלוח את התמונה ומשפט על העבודה.':'מה העדכון שתרצה לשתף? מספיק משפט אחד.'};
 if(/^(אין חדש|אין משהו חדש|אין לי תמונה|בלי תמונה)$/.test(text)){
  p.contentBrief={purpose:'EXPLAIN_SERVICE',source:'fallback_without_new_facts'};delete p.socialInput;return require('./socialContent').prepare(p);
 }
 if(text.length<6||text.length>1000||require('./conversationControl').hasControlContamination(text))return null;
 p.contentBrief={...(p.contentBrief||{}),subject:text,source:'user_explicit',receivedAt:new Date().toISOString()};delete p.socialInput;
 return require('./socialContent').prepare(p);
}
function current(p){return p.contentBrief||{purpose:'EXPLAIN_SERVICE',source:'known_product'};}
module.exports={PURPOSES,choose,capture,current};
