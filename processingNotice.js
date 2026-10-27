'use strict';
async function notifyProcessing(to,text='קיבלתי, בודק ומכין לך תשובה.') {
  const context=require('./whatsappDelivery').messageContext.getStore();
  if(!context||context.processingNoticeQueued) return;
  // One interim reply per authenticated inbound message, including voice->AI chains.
  context.processingNoticeQueued=true;
  try {await require('./whatsapp').safeSend(to,text);}
  catch {require('./logger').logger.warn('Processing notice could not be queued');}
}
module.exports={notifyProcessing};
