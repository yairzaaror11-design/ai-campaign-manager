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
 return delivery.enqueue(to,options.interactivePayload||delivery.textPayload(text));
}
const safeSend=sendWhatsAppMessage;
module.exports={transport,sendWhatsAppMessage,safeSend};
