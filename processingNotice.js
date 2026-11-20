'use strict';
const SLOW_TEXT='קיבלתי, עובד על זה. התשובה תגיע תוך רגע.';
async function notifyProcessing(to,text='קיבלתי, בודק ומכין לך תשובה.') {
  // The immediate generic notice stays off: fast replies need no interim message.
  // Slow requests get one delayed notice from withProgressNotice instead.
  if(text==='קיבלתי, בודק ומכין לך תשובה.')return;
  const context=require('./whatsappDelivery').messageContext.getStore();
  if(!context||context.processingNoticeQueued) return;
  // One interim reply per authenticated inbound message, including voice->AI chains.
  context.processingNoticeQueued=true;
  try {await require('./whatsapp').safeSend(to,text);}
  catch {require('./logger').logger.warn('Processing notice could not be queued');}
}
function delayMs(){const n=Number(process.env.PROCESSING_NOTICE_DELAY_MS);return Number.isFinite(n)&&n>=0?n:5000;}
// Runs the handling of one inbound message (inside its delivery context). The sender sees
// "read" and "typing…" right away; if nothing has been sent after ~5 seconds, one short
// progress message goes out. Never more than one per request, never for fast replies.
async function withProgressNotice(to,messageId,work){
  require('./whatsapp').markReadTyping(messageId).catch(()=>{});
  const context=require('./whatsappDelivery').messageContext.getStore();
  let done=false;
  const timer=context?setTimeout(async()=>{
    // Something (the reply itself or another notice) already went out: stay quiet.
    if(done||context.processingNoticeQueued||context.sequence>0)return;
    context.processingNoticeQueued=true;
    try{await require('./whatsapp').safeSend(to,SLOW_TEXT);}
    catch{require('./logger').logger.warn('Delayed processing notice could not be queued');}
  },delayMs()):null;
  timer?.unref?.();
  try{return await work();}
  finally{done=true;if(timer)clearTimeout(timer);}
}
module.exports={notifyProcessing,withProgressNotice,SLOW_TEXT};
