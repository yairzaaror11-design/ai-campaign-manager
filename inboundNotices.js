'use strict';
// Short replies for senders we will not serve right now, so nobody is met with silence.
// Nothing here mentions other businesses, the pilot list or any account details.
const db=require('./db'),{logger}=require('./logger'),{normalizePhone}=require('./auth');

const WAITLIST_TEXT='היי! אנחנו בפיילוט כרגע. שמרנו את הפרטים שלך ונחזור אליך בקרוב 🙏';
const SLOW_DOWN_TEXT='קיבלתי הרבה הודעות ברצף 🙂 תן לי דקה לטפל בהן, ואז אפשר להמשיך.';

// Sends one text straight to a sender that has no client record (the outbox is per client).
// The sender has just written to us, but the 24-hour window is still checked like the outbox does.
async function sendDirect(phone,text){
 const open=(await db.query("SELECT last_inbound_at>NOW()-INTERVAL '24 hours' AS open FROM whatsapp_contacts WHERE phone=$1",[phone])).rows[0]?.open;
 if(!open)return false;
 await require('./whatsapp').transport(phone,require('./whatsappDelivery').textPayload(text));
 return true;
}

// Not on the pilot list, or a new customer past the daily cap: save the sender and reply at most once a day.
async function waitlist(message,contact,reason){
 const phone=normalizePhone(message?.from);
 if(!/^\d{8,15}$/.test(phone))return{status:'IGNORED'};
 try{
  await require('./whatsappDelivery').recordInbound({...message,from:phone});
  const name=typeof contact?.profile?.name==='string'?contact.profile.name.slice(0,120):null;
  await db.query(`INSERT INTO pilot_waitlist(phone,display_name,reason) VALUES($1,$2,$3)
   ON CONFLICT(phone) DO UPDATE SET messages=pilot_waitlist.messages+1,last_seen_at=NOW(),reason=EXCLUDED.reason,display_name=COALESCE(EXCLUDED.display_name,pilot_waitlist.display_name)`,[phone,name,reason]);
  const due=await db.query("UPDATE pilot_waitlist SET last_notice_on=CURRENT_DATE WHERE phone=$1 AND last_notice_on IS DISTINCT FROM CURRENT_DATE RETURNING phone",[phone]);
  if(!due.rows.length)return{status:'ALREADY_NOTIFIED'};
  // A flood of unknown numbers must not turn into a flood of outgoing messages.
  if(!await require('./rateLimit').take('waitlist-notices',Number(process.env.WAITLIST_NOTICES_PER_DAY||500),86400))return{status:'NOTICE_CAP'};
  return{status:await sendDirect(phone,WAITLIST_TEXT)?'NOTIFIED':'WINDOW_CLOSED'};
 }catch(error){
  logger.warn('Waitlist notice not sent',{error:/^[A-Z_]+$/.test(error?.message)?error.message:'WAITLIST_FAILED'});
  return{status:'FAILED'};
 }
}

// Over the per-minute message limit: one short notice per window, through the normal outbox.
async function slowDown(clientId,from,eventId){
 try{
  if(!await require('./rateLimit').take('chat-slow-notice:'+clientId,1,60))return{status:'ALREADY_NOTIFIED'};
  await require('./metaConnection').context.run(String(clientId),()=>require('./whatsappDelivery').messageContext.run({eventId:'slow:'+eventId,sequence:0},()=>require('./whatsapp').safeSend(from,SLOW_DOWN_TEXT)));
  return{status:'NOTIFIED'};
 }catch(error){
  logger.warn('Slow-down notice not sent',{error:/^[A-Z_]+$/.test(error?.message)?error.message:'SLOW_NOTICE_FAILED'});
  return{status:'FAILED'};
 }
}
module.exports={waitlist,slowDown,WAITLIST_TEXT,SLOW_DOWN_TEXT};
