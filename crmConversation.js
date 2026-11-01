'use strict';
const store=require('./marketingStore'),crm=require('./crmService'),db=require('./db');
const LABELS={NEW:'חדשה',CONTACTED:'בטיפול',APPOINTMENT:'נקבעה פגישה',WON:'נסגרה עסקה',LOST:'לא הבשילה'};
async function handle(clientId,text){
 const p=await store.load(clientId);
 if(/^(?:סיכום פניות|סיכום מכירות|איך הפניות מתקדמות)$/.test(text)){
  const s=await crm.summary(clientId);
  const amount=s.revenue.map(x=>`${Number(x.amount)/100} ${x.currency}`).join(', ');
  return{handled:true,reply:'הפניות במערכת:\n'+Object.entries(LABELS).map(([key,label])=>`${label}: ${s.counts[key]||0}`).join('\n')+(amount?'\nהכנסות מעסקאות שסומנו כנסגרו: '+amount:'')+'\nאלה נתוני המעקב שהוזנו למערכת; הם אינם ייחוס מאומת לקמפיין.'};
 }
 if(/^(?:הוסף פנייה|הוספת פנייה|פנייה חדשה)$/.test(text))return store.update(clientId,null,profile=>{profile.crmIntake={stage:'NAME'};return{handled:true,reply:'מה שם הפונה? אפשר לכתוב ״בטל הוספה״ בכל שלב.'};});
 if(p?.crmIntake&&text==='בטל הוספה')return store.update(clientId,null,profile=>{delete profile.crmIntake;return{handled:true,reply:'הוספת הפנייה בוטלה.'};});
 if(p?.crmIntake?.stage==='NAME'&&!/[?？]/.test(text)&&text.length<=120&&!/^(?:איך|למה|כמה|מה |תכין|תיצור|נעבור)/.test(text))return store.update(clientId,null,profile=>{profile.crmIntake={stage:'CONTACT',name:text.trim()};return{handled:true,reply:'מה מספר הטלפון או כתובת האימייל של הפונה?'};});
 if(p?.crmIntake?.stage==='CONTACT'&&/^(?:\+?[\d ()-]{7,30}|[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(text)){
  const event=require('./whatsappDelivery').messageContext.getStore()?.eventId;
  const input={name:p.crmIntake.name,...(text.includes('@')?{email:text}:{phone:text}),source:'whatsapp_manual',sourceEventId:event||null};
  await crm.create(clientId,input);
  await store.update(clientId,null,profile=>{delete profile.crmIntake;return{handled:false,changed:true};});
  return{handled:true,reply:'הפנייה נוספה. אפשר לבקש ״הפניות שלי״ כדי לעדכן טיפול, פגישה או עסקה.'};
 }
 if(p?.crmFollowup&&/^(?:דלג|לא ידוע|לא עכשיו)$/.test(text))return store.update(clientId,null,profile=>{delete profile.crmFollowup;return{handled:true,reply:'מצב הפנייה נשמר. אפשר להשלים את הפרט בהמשך.'};});
 if(p?.crmFollowup){
  const follow=p.crmFollowup;
  const m=text.match(/^(?:סכום העסקה(?: הוא)?\s*)?(\d+(?:\.\d{1,2})?)\s*(₪|שח|ש״ח|שקל(?:ים)?|ILS|USD|EUR|דולר|אירו)$/i);
  let update=null;
  if(follow.kind==='REVENUE'&&m){const cents=Math.round(Number(m[1])*100);if(Number.isSafeInteger(cents))update={revenueMinor:cents,currency:/₪|ש|ILS/i.test(m[2])?'ILS':/USD|דולר/i.test(m[2])?'USD':'EUR'};}
  if(follow.kind==='LOST_REASON'&&require('./conversationAnalysis').localAnalysis(text).intent==='other'&&!/[?？]/.test(text)&&!require('./conversationFlexibility').isDetour(text)&&text.length<=1000)update={note:'סיבת אי סגירה שדווחה: '+text};
  if(update){
   try{await crm.update(clientId,follow.id,{status:follow.status,version:follow.version,...update});}
   catch{return{handled:true,reply:'הפנייה השתנתה בינתיים. אפשר לפתוח אותה שוב דרך ״הפניות שלי״.'};}
   await store.update(clientId,null,profile=>{delete profile.crmFollowup;return{handled:false,changed:true};});
   return{handled:true,reply:follow.kind==='REVENUE'?'סכום העסקה נשמר. אפשר לבקש ״סיכום פניות״.':'הסיבה נשמרה למעקב ולשיפור.'};
  }
 }
 if(/^(?:הלידים שלי|הפניות שלי|כמה לידים יש לי|תראה לי את הפניות|תראה לי את הלידים)$/.test(text)){
  const leads=(await crm.list(clientId)).slice(0,9),summary=await crm.summary(clientId);
  return store.update(clientId,null,profile=>{delete profile.crmIntake;delete profile.crmFollowup;profile.crmMenu=leads.map(x=>({id:x.id,name:x.name,version:x.version}));delete profile.crmFocus;
   return{handled:true,reply:leads.length?`נשמרו ${Object.values(summary.counts).reduce((a,b)=>a+b,0)} פניות במערכת.\n`+leads.map((l,i)=>`${i+1}. ${l.name} — ${LABELS[l.status]}`).join('\n')+'\nבאיזו פנייה נטפל?':'עדיין אין פניות במערכת. אפשר להוסיף פנייה בדשבורד או לפרסם דף פניות מהטיוטה.',decisionKey:leads.length?'crm_leads':null};
  });
 }
 const selected=text.match(/^פתח פנייה ([1-9])$/);
 if(selected&&p?.crmMenu){
  const item=p.crmMenu[Number(selected[1])-1];if(!item)return{handled:true,reply:'אפשר לבקש שוב ״הפניות שלי״ כדי לרענן את הרשימה.'};
  const row=(await db.query('SELECT id,name,phone,email,status,version FROM crm_leads WHERE client_id=$1 AND id=$2',[clientId,item.id])).rows[0];
  if(!row)return{handled:true,reply:'הפנייה כבר אינה זמינה. אפשר לרענן את הרשימה.'};
  return store.update(clientId,null,profile=>{profile.crmFocus={id:row.id,version:row.version};return{handled:true,reply:`${row.name}\n${[row.phone,row.email].filter(Boolean).join(' · ')}\nמצב: ${LABELS[row.status]}\nאיך נעדכן את מצב הטיפול?`,decisionKey:'crm_status'};});
 }
 const mapping={'סמן כפנייה חדשה':'NEW','סמן פנייה בטיפול':'CONTACTED','סמן שנקבעה פגישה':'APPOINTMENT','סמן שנסגרה עסקה':'WON','סמן שהפנייה לא הבשילה':'LOST'};
 if(mapping[text]&&p?.crmFocus){
  let updated;
  try{updated=await crm.update(clientId,p.crmFocus.id,{status:mapping[text],version:p.crmFocus.version});}
  catch{return{handled:true,reply:'הפנייה עודכנה במקום אחר או אינה זמינה. אפשר לבקש ״הפניות שלי״ כדי לרענן.'};}
  await store.update(clientId,null,profile=>{delete profile.crmFocus;delete profile.crmMenu;delete profile.crmFollowup;if(['WON','LOST'].includes(updated.status))profile.crmFollowup={id:updated.id,version:updated.version,status:updated.status,kind:updated.status==='WON'?'REVENUE':'LOST_REASON'};return{handled:false,changed:true};});
  return{handled:true,reply:updated.status==='WON'?'העסקה סומנה כנסגרה. מה סכום העסקה ובאיזה מטבע? למשל 500 ₪. אפשר גם לדלג.':updated.status==='LOST'?'הפנייה סומנה כלא הבשילה. מה הייתה הסיבה? אפשר גם לדלג.':'מצב הפנייה עודכן. אפשר לבקש ״הפניות שלי״ כדי להמשיך לפנייה הבאה.'};
 }
 return null;
}
module.exports={handle,LABELS};
