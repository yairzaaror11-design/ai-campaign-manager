'use strict';
const crypto=require('node:crypto');
const axios=require('axios');
const db=require('./db');
function graphicPrompt(text) {
 if(/^\/graphic\s+/i.test(text)) return text.replace(/^\/graphic\s+/i,'').trim();
 if(/^(?:צור|צרי|תצור|תצורי|תיצור|תיצרי|תכין|תכיני|תייצר|תייצרי)(?:\s+לי)?\s+(?:גרפיקה|תמונה|באנר)/.test(text)) return text;
 return null;
}
async function generate(prompt) {
 if(!process.env.GEMINI_API_KEY||!/^gemini-[a-z0-9.-]+$/.test(process.env.GEMINI_IMAGE_MODEL || '')) throw Error('GRAPHICS_CONFIGURATION_REQUIRED');
 let response;
 try {response=(await axios.post('https://generativelanguage.googleapis.com/v1beta/models/'+process.env.GEMINI_IMAGE_MODEL+':generateContent',{
 contents:[{role:'user',parts:[{text:'Create a polished advertisement graphic from this business brief. Follow the requested language and brand details. Do not invent endorsements, guarantees, contact details or claims. Return an image. Brief: '+prompt}]}],
 generationConfig:{responseModalities:['IMAGE'],maxOutputTokens:2048,thinkingConfig:{thinkingLevel:'MINIMAL'},imageConfig:{aspectRatio:'1:1',imageSize:'1K'}}
 },{headers:{'x-goog-api-key':process.env.GEMINI_API_KEY},timeout:90000,maxRedirects:0,maxContentLength:8*1024*1024})).data;}catch{throw Error('GRAPHIC_PROVIDER_FAILED');}
 const part=response.candidates?.[0]?.content?.parts?.find(p=>p.inlineData?.data)?.inlineData;
 if(!part||!['image/png','image/jpeg'].includes(part.mimeType)) throw Error('GRAPHIC_IMAGE_REQUIRED');
 const buffer=Buffer.from(part.data,'base64');
 const png=buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 const jpeg=buffer[0]===255&&buffer[1]===216&&buffer[2]===255;
 if(buffer.length<16||buffer.length>5*1024*1024||!(part.mimeType==='image/png'?png:jpeg)) throw Error('INVALID_GENERATED_IMAGE');
 return {buffer,mimeType:part.mimeType};
}
async function upload(image) {
 if(!/^\d+$/.test(process.env.WHATSAPP_PHONE_NUMBER_ID || '')||!process.env.WHATSAPP_ACCESS_TOKEN) throw Error('WHATSAPP_NOT_CONFIGURED');
 const body=new FormData();body.set('messaging_product','whatsapp');body.set('type',image.mimeType);body.set('file',new Blob([image.buffer],{type:image.mimeType}),image.mimeType==='image/png'?'creative.png':'creative.jpg');
 try {const r=(await axios.post('https://graph.facebook.com/'+(process.env.META_GRAPH_VERSION || 'v26.0')+'/'+process.env.WHATSAPP_PHONE_NUMBER_ID+'/media',body,{headers:{Authorization:'Bearer '+process.env.WHATSAPP_ACCESS_TOKEN},timeout:30000,maxRedirects:0,maxBodyLength:6*1024*1024})).data;
 if(!/^\d+$/.test(r.id || '')) throw Error('INVALID_MEDIA_ID');return r.id;
 }catch{throw Error('GRAPHIC_UPLOAD_FAILED');}
}
async function createGraphic(clientId,prompt,{generateImage=generate,uploadImage=upload}={}) {
 if(process.env.GRAPHICS_ENABLED!=='true') throw Error('GRAPHICS_DISABLED');
 const tenant=require('./metaConnection').context.getStore();
 const event=require('./whatsappDelivery').messageContext.getStore();
 if(String(tenant)!==String(clientId)||!event?.eventId) throw Error('GRAPHIC_CONTEXT_REQUIRED');
 if(typeof prompt!=='string'||prompt.length<3||prompt.length>2000) throw Error('INVALID_GRAPHIC_BRIEF');
 const dedupe=crypto.createHash('sha256').update(String(clientId)+':'+event.eventId).digest('hex');
 const claim=await db.query("INSERT INTO graphic_jobs(id,client_id,status,expires_at) VALUES($1,$2,'PROCESSING',NOW()+INTERVAL '1 day') ON CONFLICT DO NOTHING RETURNING id",[dedupe,clientId]);
 if(!claim.rows.length) {
 const existing=(await db.query("SELECT media_id FROM graphic_jobs WHERE id=$1 AND client_id=$2 AND status='COMPLETE' AND expires_at>NOW()",[dedupe,clientId])).rows[0];
 if(existing) return require('./mediaStore').loadMedia(clientId,existing.media_id);
 throw Error('GRAPHIC_ALREADY_ATTEMPTED');
 }
 try {
 if(!await require('./rateLimit').take('graphics:'+clientId,3,3600)) throw Error('GRAPHIC_RATE_LIMIT');
 const maximum=Number(process.env.GRAPHICS_ATTEMPT_LIMIT || 100);
 if(!Number.isInteger(maximum)||maximum<1||maximum>100) throw Error('INVALID_GRAPHICS_LIMIT');
 const reserved=await db.query("INSERT INTO graphic_usage_counters(name,attempts) VALUES('pilot',1) ON CONFLICT(name) DO UPDATE SET attempts=graphic_usage_counters.attempts+1 WHERE graphic_usage_counters.attempts<$1 RETURNING attempts",[maximum]);
 if(!reserved.rows.length) throw Error('GRAPHIC_PILOT_LIMIT');
 const image=await generateImage(prompt);
 const whatsappId=await uploadImage(image);
 const id=await db.transaction(async tx=>{
 // Prevent in-flight generation from recreating deleted client data.
 const owner=await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[clientId]);if(!owner.rows.length) throw Error('CLIENT_DELETED');
 const id=crypto.randomUUID();
 await tx("INSERT INTO tenant_media(id,client_id,whatsapp_media_id,media_type,mime_type,caption,expires_at) VALUES($1,$2,$3,'image',$4,$5,NOW()+INTERVAL '1 day')",[id,clientId,whatsappId,image.mimeType,prompt]);
 await tx("UPDATE graphic_jobs SET status='COMPLETE',media_id=$2 WHERE id=$1",[dedupe,id]);return id;
 });
 return require('./mediaStore').loadMedia(clientId,id);
 }catch(e){await db.query("UPDATE graphic_jobs SET status='FAILED' WHERE id=$1 AND status='PROCESSING'",[dedupe]);throw e;}
}
module.exports={graphicPrompt,generate,upload,createGraphic};
