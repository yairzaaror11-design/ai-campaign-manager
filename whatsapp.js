'use strict';
const axios=require('axios');
async function transport(to,payload) {
 if(process.env.WHATSAPP_SEND_ENABLED!=='true') throw Error('WHATSAPP_SEND_DISABLED');
 if(!process.env.WHATSAPP_PHONE_NUMBER_ID||!process.env.WHATSAPP_ACCESS_TOKEN) throw Error('WHATSAPP_NOT_CONFIGURED');
 try {
   return (await axios.post('https://graph.facebook.com/'+(process.env.META_GRAPH_VERSION || 'v26.0')+'/'+process.env.WHATSAPP_PHONE_NUMBER_ID+'/messages',
    {messaging_product:'whatsapp',recipient_type:'individual',to,...payload},
    {headers:{Authorization:'Bearer '+process.env.WHATSAPP_ACCESS_TOKEN},timeout:15000,maxRedirects:0})).data;
 } catch {throw Error('WHATSAPP_SEND_UNCERTAIN');}
}
// Splits a long reply into WhatsApp-sized parts at a paragraph break, else a line break,
// else the end of a sentence, else a space; a hard cut only for one endless word.
function splitMessage(text,max=3800){
 const parts=[];let rest=String(text);
 while(rest.length>max){
  const window=rest.slice(0,max+1),floor=Math.floor(max*0.5);
  let cut=-1;
  for(const re of [/\n\s*\n/g,/\n/g,/[.!?…]["״׳')]*(?=\s)/g,/\s/g]){
   let m,last=-1;re.lastIndex=0;
   while((m=re.exec(window)))if(m.index+m[0].length<=max)last=m.index+m[0].length;
   if(last>=floor){cut=last;break;}
  }
  if(cut<1)cut=max;
  const head=rest.slice(0,cut).trimEnd();
  if(head)parts.push(head);
  rest=rest.slice(cut).replace(/^\s+/,'');
 }
 if(rest.trim()||!parts.length)parts.push(rest);
 return parts;
}
async function sendWhatsAppMessage(to,text,options={}) {
 const delivery=require('./whatsappDelivery');
 const enqueueText=async body=>{let result;for(const part of splitMessage(body))result=await delivery.enqueue(to,delivery.textPayload(part));return result;};
 if(options.leadingText)await enqueueText(options.leadingText);
 if(options.interactivePayload)return delivery.enqueue(to,options.interactivePayload);
 return enqueueText(String(text));
}
// Marks the inbound message as read and shows "typing…" to the sender (Cloud API; the
// indicator clears on our reply or after ~25 seconds). Best effort: it is a status, not
// a message, so it never goes through the outbox and a failure never blocks the reply.
async function markReadTyping(messageId) {
 if(typeof messageId!=='string'||!/^wamid\.[A-Za-z0-9._=+\/-]{1,500}$/.test(messageId))return false;
 if(process.env.WHATSAPP_SEND_ENABLED!=='true'||process.env.WHATSAPP_TYPING_INDICATOR==='false')return false;
 try {await module.exports.statusTransport({messaging_product:'whatsapp',status:'read',message_id:messageId,typing_indicator:{type:'text'}});return true;}
 catch {return false;}
}
async function statusTransport(body) {
 if(!process.env.WHATSAPP_PHONE_NUMBER_ID||!process.env.WHATSAPP_ACCESS_TOKEN) throw Error('WHATSAPP_NOT_CONFIGURED');
 return (await axios.post('https://graph.facebook.com/'+(process.env.META_GRAPH_VERSION || 'v26.0')+'/'+process.env.WHATSAPP_PHONE_NUMBER_ID+'/messages',body,
  {headers:{Authorization:'Bearer '+process.env.WHATSAPP_ACCESS_TOKEN},timeout:5000,maxRedirects:0})).data;
}
const safeSend=sendWhatsAppMessage;
module.exports={transport,sendWhatsAppMessage,safeSend,splitMessage,markReadTyping,statusTransport};

