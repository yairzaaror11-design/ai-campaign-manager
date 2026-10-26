'use strict';
const store=require('./marketingStore'),facts=require('./conversationFacts'),journey=require('./campaignJourney');
function enabled(){return process.env.BUSINESS_LINK_ONBOARDING_ENABLED==='true';}
function linkIn(text){const m=String(text).match(/https:\/\/[^\s<>"']+/);return m?m[0].replace(/[),.]+$/,''):null;}
function summary(candidate){
 const labels={businessName:'שם העסק',businessType:'תחום ושירותים',product:'מוצר או שירות',serviceArea:'מיקום'};
 return Object.entries(candidate.facts).map(([k,v])=>`${labels[k]}: ${v}`).join('\n')+(candidate.brand.colors.length?'\nצבע שנמצא באתר: '+candidate.brand.colors.join(', '):'')+'\n\nאלה הפרטים שמצאתי בעמוד הציבורי. הם נכונים?';
}
async function handle(clientId,text,eventId,{onSlow,inspect=require('./publicWebsite').inspect}={}){
 if(!enabled())return null;
 const p=await store.load(clientId),url=linkIn(text),n=String(text).trim();
 if(/^(?:פתח(?:י)? (?:לי )?חשבון|הרשמה|דשבורד|החשבון שלי|תצוגה מקדימה|ניהול לידים)$/.test(n)){
  const address=await require('./portalStore').createTicket(clientId);
  return{handled:true,reply:'כאן אפשר לראות את התוכנית ולפתוח חשבון בלי לאבד את השיחה. הקישור אישי ותקף לעשר דקות:\n'+address,historyReply:'נשלח קישור אישי לתצוגה מקדימה ולהרשמה. כתובת הקישור לא נשמרה בהיסטוריית AI.'};
 }
 const crmResult=await require('./crmConversation').handle(clientId,n);if(crmResult)return crmResult;

 if(url){
  if(!await require('./rateLimit').take('business-inspect:'+clientId,6,3600))return{handled:true,reply:'בדקנו כמה קישורים ברצף. אפשר להמשיך עם הפרטים שכבר מסרת ולנסות קישור נוסף בהמשך.'};
  if(onSlow)await onSlow();
  let candidate;
  try{candidate=await inspect(url);}catch{return store.update(clientId,eventId,profile=>{profile.businessEntry={...(profile.businessEntry||{}),linkAsked:true,awaitingLink:false};journey.init(profile);profile.journey.stage='DISCOVERY';profile.journey.pendingField='businessType';return{handled:true,reply:'לא הצלחתי לקרוא מספיק מידע מהקישור. אפשר פשוט לספר מה העסק מוכר או איזה שירות הוא נותן?'};});}
  return store.update(clientId,eventId,profile=>{profile.businessImport=candidate;profile.businessEntry={...(profile.businessEntry||{}),linkAsked:true,awaitingConfirmation:true,awaitingLink:false};return{handled:true,reply:summary(candidate),decisionKey:'business_import',audit:'BUSINESS_SOURCE_PROPOSED'};});
 }
 if(p?.businessEntry?.awaitingConfirmation&&/^(כן|הפרטים נכונים|נכון)$/.test(n))return store.update(clientId,eventId,profile=>{
  if(!profile.businessImport||!profile.businessEntry?.awaitingConfirmation)return{handled:false};
  const changed=[];journey.init(profile);
  for(const [field,value]of Object.entries(profile.businessImport.facts))if(value&&facts.write(profile,field,value,{source:'website_user_confirmed',evidence:profile.businessImport.source}))changed.push(field);
  facts.write(profile,'website',profile.businessImport.source,{source:'website_user_confirmed',evidence:profile.businessImport.source});
  profile.brand={...profile.businessImport.brand,source:profile.businessImport.source,status:'USER_CONFIRMED',confirmedAt:new Date().toISOString()};
  profile.websiteChecks=profile.businessImport.checks;profile.businessEntry.awaitingConfirmation=false;profile.businessImport.status='CONFIRMED';
  facts.correctionsInvalidate(profile,changed);return journey.advance(profile,{prefix:'שמרתי את הפרטים שאישרת. נשלים רק מה שחסר.'});
 });
 if(p?.businessEntry?.awaitingConfirmation&&/^(לא|לתקן פרטים|יש טעות)$/.test(n))return store.update(clientId,eventId,profile=>{
  profile.businessEntry.awaitingConfirmation=false;journey.init(profile);profile.journey.stage='DISCOVERY';profile.journey.pendingField='businessType';
  return{handled:true,reply:'הפרטים מהקישור לא נשמרו כפרטי העסק. אפשר לתאר במשפט את העסק והשירות שנרצה לקדם?'};
 });
 if(p?.businessEntry?.awaitingLink&&/^(אין לי קישור|אין אתר|אין לי אתר|בלי אתר)$/.test(n))return store.update(clientId,eventId,profile=>{
  profile.businessEntry.awaitingLink=false;journey.init(profile);profile.journey.stage='DISCOVERY';profile.journey.pendingField='businessType';
  return{handled:true,reply:'אין בעיה, אפשר להתחיל גם בלי אתר. מה העסק עושה?'};
 });
 if(!p?.businessEntry?.linkAsked&&!facts.value(p||store.emptyProfile(),'businessType')&&/^(היי|הי|שלום|\/start|אני רוצה קמפיין|קמפיין חדש|נתחיל)$/.test(n))return store.update(clientId,eventId,profile=>{
  profile.businessEntry={linkAsked:true,awaitingLink:true};
  return{handled:true,reply:'היי 👋 נתחיל בהיכרות קצרה, נכין מודעה ותוכנית, ורק אחר כך נחבר חשבון פרסום.\nאפשר לשלוח קישור לאתר או לאינסטגרם של העסק? אם אין קישור, ספרו במשפט מה העסק עושה.\nפרטי השיחה מעובדים בעזרת AI ונשמרים להמשך. מידע על פרטיות: '+require('./portalStore').origin()+'/privacy',decisionKey:'business_entry'};
 });
 if(p?.businessEntry?.awaitingLink){
  await store.update(clientId,null,profile=>{profile.businessEntry.awaitingLink=false;journey.init(profile);profile.journey.stage='DISCOVERY';profile.journey.pendingField='businessType';return{handled:false,changed:true};});
 }
 return null;
}
module.exports={enabled,linkIn,summary,handle};
