'use strict';
// Local editorial work only. A proposed calendar never schedules an external post.
const crypto=require('node:crypto'),facts=require('./conversationFacts');
function requested(text){
 const n=String(text).trim();
 if(/לא\s+(?:רוצה|רוצים|צריך|צריכה)\s+(?:כרגע\s+)?(?:תוכן|פוסט|סטורי)/.test(n))return false;
 if(/^(?:תוכן לסושיאל|נעבור לסושיאל|סושיאל|להכין תוכן לסושיאל)$/.test(n))return true;
 return /(?:תכין|תכיני|כתוב|כתבי|הכן|רוצה|צריך|צריכה).*(?:פוסט|סטורי|תוכן לסושיאל|לוח תוכן)|^(?:פוסט|סטורי) מהקובץ ששלחתי$/.test(n);
}
function combined(text){return /^(?:לשלב את שניהם|גם סושיאל וגם פניות|גם תוכן וגם קמפיין)$/.test(String(text).trim());}
function render(p){
 const s=p.socialContent;
 const item=s.items[s.focus===1?1:0];
 return `טיוטה ל${item.format==='STORY'?'סטורי':'פוסט'}:\n\n${item.headline}\n${item.body}\n${item.cta}\n\nלהכין גרפיקה או לשנות את הנוסח?`;
}
function prepare(p,{feedback=null}={}){
 const f=facts.all(p),product=f.product||f.businessType;
 const j=p.journey;
 if(!product){j.stage='DISCOVERY';j.pendingField='businessType';j.requestedOutput='social';return{handled:true,reply:'נכין פוסט וסטורי לעסק. מה העסק עושה?',decisionKey:null};}
 const base=require('./campaignJourney').buildDraft(p);
 const short=/קצר/.test(feedback||''),personal=/אישי|אנושי/.test(feedback||'');
 const items=base.creatives.map((c,i)=>({format:i?'STORY':'POST',headline:c.headline,body:(personal?'נעים להכיר'+(f.businessName?', '+f.businessName:'')+'. ':'')+(short?[`מציעים ${product}.`,f.advantage,base.creatives[i].body.includes(f.offer)&&f.offer?base.creatives[i].body:''].filter(Boolean).join(' '):c.body),cta:c.cta,visual:i?`צילום של ${product}, כותרת קצרה וקריאה לפנייה`:`תמונה מקורית של ${product} עם מיתוג העסק`,status:'DRAFT'}));
 p.socialContent={id:crypto.randomUUID(),planId:p.planId,revision:(p.socialContent?.revision||0)+1,items,mediaAssetId:p.mediaContext?.assetId||null,feedback,stale:false,status:'DRAFT',createdAt:new Date().toISOString()};
 j.requestedOutput='social';j.pendingField=null;j.paused=false;j.detour=false;
 // Preserve an existing paid draft and its stage so switching channels is reversible.
 return{handled:true,reply:render(p),decisionKey:'social_review'};
}
function calendar(p){
 if(!p.socialContent||p.socialContent.stale)return prepare(p);
 p.socialContent.calendar=[{day:1,item:0},{day:3,item:1},{day:5,item:0,task:'צילום או זווית נוספת לפני שימוש חוזר'}];
 return{handled:true,reply:'לשבוע הקרוב אני מציע:\nיום 1 — פוסט על השירות.\nיום 3 — סטורי שמזמין לפנייה.\nיום 5 — צילום או זווית חדשה.\n\nזה לוח לתכנון. נכין את הפוסט הראשון?',decisionKey:'social_review'};
}
function handle(p,text,analysis){
 if(/לא\s+רוצה\s+(?:כרגע\s+)?(?:תוכן|פוסט|סטורי)/.test(text)){p.journey.requestedOutput=null;return{handled:true,reply:'בסדר, נשאיר את התוכן לסושיאל כרגע. מה בא לך לעשות במקום?',decisionKey:'journey_route'};}
 if(/^לא\s+אני\s+רוצה\s+(?:כרגע\s+)?תוכן\s+לסושיאל/.test(text))return{handled:true,reply:'רק לוודא שהבנתי: להכין תוכן לסושיאל עכשיו, או לעבור למודעה שמביאה פניות?',decisionKey:'social_intent'};
 if(/^(?:תראה|תראי|הצג|הציגי) (?:את ה)?סטורי$/.test(text)&&p.socialContent&&!p.socialContent.stale){p.socialContent.focus=1;return{handled:true,reply:render(p),decisionKey:'social_review'};}
 if(text==='תראה את הפוסט'&&p.socialContent&&!p.socialContent.stale){p.socialContent.focus=0;return{handled:true,reply:render(p),decisionKey:'social_review'};}
 if(requested(text))return prepare(p);
 if(text==='לוח תוכן לשבוע')return calendar(p);
 if(text==='שינוי נוסח לסושיאל'&&p.socialContent){p.journey.socialFeedbackPending=true;return{handled:true,reply:'מה לשנות בתוכן? אפשר לבקש קצר יותר, סגנון אישי או לכתוב הנחיה משלך.'};}
 if(p.journey.socialFeedbackPending&&['other','ad'].includes(analysis.intent)&&analysis.messageKind!=='side_question'&&!/[?？]/.test(text)){
  delete p.journey.socialFeedbackPending;return prepare(p,{feedback:text.slice(0,1000)});
 }
 return null;
}
async function enrich(p,result,{writer}={}){
 const s=p.socialContent;
 if(result.decisionKey!=='social_review'||!s||s.stale||s.copySource==='ai_draft'||s.calendar)return result;
 const f=facts.all(p),base=require('./campaignJourney').buildDraft(p);
 if(f.offer&&!base.creatives.some(c=>c.body.includes(f.offer))){delete f.offer;delete f.offerScope;delete f.offerCommitment;delete f.offerMediaSeparate;}
 const requiredTerms=f.offer?[f.offer,f.offerScope,f.offerCommitment,f.offerMediaSeparate===true?'תקציב המדיה משולם בנפרד.':null].filter(Boolean):[];
 try{
  const input={facts:f,requiredTerms,feedback:s.feedback,formats:['POST','STORY'],instruction:'Prepare one concise organic social post and one short story. Aim for 35 words per body, plus all required offer terms verbatim. Focus on one concrete angle per item. No paid-media budget is needed. No external publication occurs.'};
  const output=writer?await writer(input):JSON.parse((await require('./aiService').processMessage(JSON.stringify(input),[],{planningOnly:true,creativeDraft:true})).text);
  const creatives=require('./creativeGeneration').validate(output,JSON.stringify(f),requiredTerms);
  s.items=s.items.map((item,i)=>({...item,...creatives[i]}));s.copySource='ai_draft';
  return{...result,reply:render(p)};
 }catch{return{...result,reply:render(p)+(s.feedback?'\n\nלא הצלחתי להשלים עריכת AI לפי ההנחיה כרגע. הנוסח המוצג הוא טיוטה בסיסית; אפשר לנסות שוב.':'')};}
}
async function sync(clientId,s){
 if(!s||s.stale)return;
 for(let i=0;i<s.items.length;i++){
  const item=s.items[i],hex=crypto.createHash('sha256').update(s.id+':'+i).digest('hex');
  const requestId=`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
  await require('./workspaceService').save(clientId,'content',{title:((item.format==='STORY'?'סטורי: ':'פוסט: ')+item.headline).slice(0,160),body:[item.body,item.cta].join('\n'),channel:item.format==='STORY'?'Instagram':'Facebook',date:null},{requestId});
 }
}
module.exports={requested,combined,prepare,render,calendar,handle,enrich,sync};
