'use strict';
const meta=require('./metaConnection'),connection=require('./metaConversation'),store=require('./marketingStore'),menu=require('./accountMenu');
function request(text){
 const n=String(text).trim().replace(/[.!?]+$/,'');
 const named=n.match(/^(?:תעבור|תעברי|עבור|עברי|תחליף|תחליפי|החלף|החליפי|בחר|בחרי)(?: לי)? (?:לחשבון|לחשבון הפרסום|חשבון|את החשבון)\s+(.+)$/);
 const search=n.match(/^(?:חפש|חפשי)(?: לי)? (?:חשבון|חשבונות)\s+(.+)$/);
 const page=n.match(/^\/meta-page (\d{1,3})$/);
 if(named)return{type:'select',query:named[1]};
 if(search)return{type:'list',query:search[1]};
 if(page)return{type:'list',page:Number(page[1]),preserveQuery:true};
 if(/^(?:החשבונות שלי|חשבונות הפרסום|בחירת חשבון|הצג חשבונות|\/meta-accounts)$/.test(n))return{type:'list'};
 if(/^\/report(?: |$)/.test(n)||/כמה (?:כסף )?(?:הוצאתי|הוצאנו|הוצאת)|דוח ביצועים|תוצאות השבוע|(?:כמה לידים|כמה מכירות).*(?:היו|הגיעו|קיבלתי|השבוע|החודש|אתמול|היום)/.test(n))return{type:'report'};
 return null;
}
async function handle(clientId,text){
 const req=request(text);if(!req)return null;
 if(req.type==='report'){
   let period;try{period=require('./reportPeriod').parse(text);}catch{return{handled:true,reply:'טווח התאריכים לא תקין. אפשר לשלוח תאריך התחלה וסיום, למשל 2026-01-01 עד 2026-01-31?'};}
   if(!period)return{handled:true,reply:'לאיזו תקופה להציג את הדוח? אפשר לכתוב ״החודש״, ״בשנה האחרונה״ או שני תאריכים.'};
   try{return{handled:true,reply:await require('./reportService').campaignReport(clientId,period)};}catch{return{handled:true,reply:'לא הצלחתי לקרוא דוח מאומת מהחשבון הנבחר. אפשר לכתוב ״מצב חיבור חשבון מטא״ לבדיקת הגישה.'};}
 }
 const fresh=await connection.verify(clientId);
 if(!['CONNECTED','ACCOUNT_SELECTION_REQUIRED'].includes(fresh.status))return{handled:true,reply:connection.statusReply(fresh)};
 const list=fresh.accounts||[];
 if(req.type==='select'){
   const exact=list.filter(a=>menu.normalize(a.name)===menu.normalize(req.query));
   const matches=exact.length?exact:list.filter(a=>menu.normalize(a.name).includes(menu.normalize(req.query)));
   if(matches.length===1){
     try{await meta.selectAccount(clientId,matches[0].id);return{handled:true,reply:connection.statusReply(await connection.verify(clientId)),decisionKey:'connected'};}
     catch{return{handled:true,reply:'לא ניתן לעבור לחשבון בלי גישה תקפה. אפשר להציג שוב את ״החשבונות שלי״.'};}
   }
   req.query=req.query;req.type='list';
 }
 return store.update(clientId,null,p=>{
   p.connection={...p.connection,status:'ACCOUNT_SELECTION_REQUIRED',accounts:list,accountPage:req.page||0,accountQuery:req.preserveQuery?p.connection?.accountQuery:req.query||''};
   return{handled:true,reply:menu.reply(p.connection),decisionKey:'account_selection',changed:true};
 });
}
module.exports={request,handle};
