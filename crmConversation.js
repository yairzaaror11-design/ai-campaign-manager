'use strict';
const store=require('./marketingStore'),crm=require('./crmService'),db=require('./db');
const LABELS={NEW:'חדשה',CONTACTED:'בטיפול',APPOINTMENT:'נקבעה פגישה',WON:'נסגרה עסקה',LOST:'לא הבשילה'};
async function handle(clientId,text){
 const p=await store.load(clientId);
 if(/^(?:הלידים שלי|הפניות שלי|כמה לידים יש לי|תראה לי את הפניות|תראה לי את הלידים)$/.test(text)){
  const leads=(await crm.list(clientId)).slice(0,9),summary=await crm.summary(clientId);
  return store.update(clientId,null,profile=>{profile.crmMenu=leads.map(x=>({id:x.id,name:x.name,version:x.version}));delete profile.crmFocus;
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
  try{await crm.update(clientId,p.crmFocus.id,{status:mapping[text],version:p.crmFocus.version});}
  catch{return{handled:true,reply:'הפנייה עודכנה במקום אחר או אינה זמינה. אפשר לבקש ״הפניות שלי״ כדי לרענן.'};}
  await store.update(clientId,null,profile=>{delete profile.crmFocus;delete profile.crmMenu;return{handled:false,changed:true};});
  return{handled:true,reply:'מצב הפנייה עודכן. אפשר לבקש ״הפניות שלי״ כדי להמשיך לפנייה הבאה.'};
 }
 return null;
}
module.exports={handle,LABELS};
