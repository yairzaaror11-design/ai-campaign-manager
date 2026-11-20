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
async function sendWhatsAppMessage(to,text,options={}) {
 const delivery=require('./whatsappDelivery');
 const enqueueText=async body=>{let result;for(let i=0;i<body.length;i+=3800)result=await delivery.enqueue(to,delivery.textPayload(body.slice(i,i+3800)));return result;};
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
module.exports={transport,sendWhatsAppMessage,safeSend,markReadTyping,statusTransport};

