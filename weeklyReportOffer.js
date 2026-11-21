'use strict';
// The weekly report as a plain choice: a button after a report instead of the hidden
// "/notifications-on" command (kept as an alias, together with plain Hebrew phrases).
const db=require('./db');
const ON=/^(?:\/notifications-on|תשלח לי דוח כל שבוע|דוח שבועי אוטומטי|כן,? כל שבוע)[.!\s]*$/;
const OFF=/^(?:\/notifications-off|בלי דוח שבועי|(?:הפסק|תפסיק|להפסיק|תעצור|עצור|תבטל|בטל)(?: את)?(?: ה)? ?דוח(?: ה)? ?שבועי|(?:אני\s+)?לא (?:רוצה|צריך|צריכה) (?:את )?(?:ה)?דוח (?:ה)?שבועי|בלי (?:ה)?דוחות(?: ה?שבועיים)?)[.!\s]*$/;
// Promise only what will happen: weekly reports may be off, and outside WhatsApp's 24-hour
// window a report can only go out through an approved template.
function onText(){
 const stop=' אם תרצה להפסיק, רק תגיד לי.';
 if(process.env.WEEKLY_REPORTS_ENABLED!=='true')return'רשמתי ✓ הדוח השבועי האוטומטי עוד לא פעיל אצלנו. ברגע שיופעל תקבל אותו כל יום ראשון בבוקר. בינתיים אפשר לבקש ״דוח עסקי״ בכל רגע.'+stop;
 if(!process.env.WEEKLY_REPORT_TEMPLATE)return'מעולה ✓ כל יום ראשון בבוקר אשלח לך דוח שבועי קצר על הפרסום והלידים, כשהשיחה בינינו פעילה (וואטסאפ מאפשר לי לכתוב עד 24 שעות מההודעה האחרונה שלך).'+stop;
 return'מעולה ✓ כל יום ראשון בבוקר אשלח לך דוח שבועי קצר על הפרסום והלידים.'+stop;
}
const OFF_TEXT='הדוח השבועי האוטומטי הופסק. אפשר תמיד לבקש ״דוח עסקי״ ואשלח אותו מיד.';
const OFFER_TEXT='רוצה לקבל דוח כזה אוטומטית כל יום ראשון בבוקר?';

async function handleText(from,text){
 const on=ON.test(text),off=!on&&OFF.test(text);
 if(!on&&!off)return false;
 await db.query('UPDATE whatsapp_contacts SET opted_in=$2 WHERE phone=$1',[from,on]);
 await require('./whatsapp').safeSend(from,on?onText():OFF_TEXT);
 return true;
}

// Offers one button after a report, only to owners not yet signed up and only when no
// other decision menu is open (a new menu would replace it). Runs inside the delivery context.
async function offer(clientId,phone){
 try{
  if(process.env.WEEKLY_REPORTS_ENABLED!=='true')return false;
  if((await db.query('SELECT opted_in FROM whatsapp_contacts WHERE phone=$1',[phone])).rows[0]?.opted_in)return false;
  const p=await require('./marketingStore').load(clientId);
  if(p?.ui&&p.ui.expiresAt>Date.now()&&p.ui.decisionKey!=='weekly_report')return false;
  const ui=await require('./conversationUi').prepareChoices(clientId,OFFER_TEXT,[{title:'כן, דוח כל שבוע',text:'/notifications-on'}],'weekly_report');
  await require('./whatsappDelivery').enqueue(phone,ui.interactivePayload);
  return true;
 }catch{return false;}
}
module.exports={handleText,offer,onText,OFF_TEXT,OFFER_TEXT};
