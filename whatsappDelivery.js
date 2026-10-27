'use strict';
const crypto=require('node:crypto');
const {AsyncLocalStorage}=require('node:async_hooks');
const db=require('./db');
const messageContext=new AsyncLocalStorage();
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
async function recordInbound(message) {
  if(!/^\d{5,20}$/.test(String(message.from))) throw Error('INVALID_SENDER');
  const seconds=Number(message.timestamp);
  if(!Number.isFinite(seconds)||seconds<=0||seconds*1000>Date.now()+300000) throw Error('INVALID_MESSAGE_TIME');
  await db.query(`INSERT INTO whatsapp_contacts(phone,last_inbound_at) VALUES($1,$2)
    ON CONFLICT(phone) DO UPDATE SET last_inbound_at=GREATEST(whatsapp_contacts.last_inbound_at,EXCLUDED.last_inbound_at)`,[message.from,new Date(seconds*1000)]);
}
async function enqueue(to,payload) {
 const context=messageContext.getStore();
 const tenant=require('./metaConnection').context.getStore();
 if(!tenant||!context) throw Error('OUTBOUND_CONTEXT_REQUIRED');
 const client=await db.query('SELECT phone FROM clients WHERE id=$1',[tenant]);
 if(client.rows[0]?.phone!==to) throw Error('OUTBOUND_TENANT_MISMATCH');
 const key=hash(context.eventId+':'+context.sequence++);
 const inserted=await db.query(`INSERT INTO whatsapp_outbox(id,client_id,dedupe_key,recipient,payload) VALUES($1,$2,$3,$4,$5::jsonb)
   ON CONFLICT(dedupe_key) DO NOTHING RETURNING id`,[crypto.randomUUID(),tenant,key,to,JSON.stringify(payload)]);
 return {queued:!!inserted.rows.length};
}
function textPayload(text) {return {type:'text',text:{body:String(text).slice(0,4000),preview_url:false}};}
async function runOne({transport}={}) {
 if(process.env.WHATSAPP_SEND_ENABLED!=='true') return {status:'DISABLED'};
 const claimed=await db.transaction(async tx=>{
   // Interrupted sends never automatically replay: the provider may have accepted them.
   await tx("UPDATE whatsapp_outbox SET status='UNKNOWN',payload='{}'::jsonb WHERE status='PROCESSING' AND lease_until<NOW()");
   const r=await tx(`SELECT o.* FROM whatsapp_outbox o WHERE o.status='PENDING'
    AND NOT EXISTS(SELECT 1 FROM whatsapp_outbox earlier WHERE earlier.recipient=o.recipient AND earlier.status IN ('PENDING','PROCESSING') AND earlier.delivery_order<o.delivery_order)
    ORDER BY o.delivery_order FOR UPDATE SKIP LOCKED LIMIT 20`);
   let row=null;
   for(const candidate of r.rows){
    const lock=await tx('SELECT pg_try_advisory_xact_lock(hashtextextended($1,874223008)) AS locked',[candidate.recipient]);
    if(!lock.rows[0]?.locked)continue;
    const busy=await tx("SELECT id FROM whatsapp_outbox WHERE recipient=$1 AND status='PROCESSING' LIMIT 1",[candidate.recipient]);
    if(!busy.rows.length){row=candidate;break;}
   }
   if(!row)return null;
   const window=await tx("SELECT opted_in,last_inbound_at>NOW()-INTERVAL '24 hours' AS open FROM whatsapp_contacts WHERE phone=$1",[row.recipient]);
   if((['text','image','interactive'].includes(row.payload.type)&&!window.rows[0]?.open)||(row.payload.type==='template'&&!window.rows[0]?.opted_in)) {
     await tx("UPDATE whatsapp_outbox SET status='BLOCKED',error_code='POLICY_WINDOW_OR_OPTIN',payload='{}'::jsonb WHERE id=$1",[row.id]);
     return {blocked:true};
   }
   await tx("UPDATE whatsapp_outbox SET status='PROCESSING',lease_until=NOW()+INTERVAL '2 minutes' WHERE id=$1",[row.id]);
   return row;
 });
 if(!claimed) return {status:'IDLE'};
 if(claimed.blocked) return {status:'BLOCKED'};
 // Lock the client while sending so deletion cannot finish before an in-flight send.
 try {
   await db.transaction(async tx=>{
     const owner=await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[claimed.client_id]);
     const row=await tx("SELECT id FROM whatsapp_outbox WHERE id=$1 AND status='PROCESSING'",[claimed.id]);
     if(!owner.rows.length||!row.rows.length) throw Error('OUTBOUND_CANCELLED');
     const result=await (transport || require('./whatsapp').transport)(claimed.recipient,claimed.payload);
     if(typeof result?.messages?.[0]?.id!=='string') throw Error('MISSING_PROVIDER_ID');
     const providerId=result.messages[0].id;
     await tx("UPDATE whatsapp_outbox SET status='SENT',provider_id=$2,payload='{}'::jsonb,updated_at=NOW() WHERE id=$1",[claimed.id,providerId]);
     const receipts=await tx("SELECT status,error_code FROM whatsapp_receipts WHERE provider_id=$1 ORDER BY CASE status WHEN 'read' THEN 4 WHEN 'delivered' THEN 3 WHEN 'failed' THEN 2 ELSE 1 END DESC LIMIT 1",[providerId]);
     if(receipts.rows.length) await tx('UPDATE whatsapp_outbox SET status=$2,error_code=$3 WHERE id=$1',[claimed.id,receipts.rows[0].status.toUpperCase(),receipts.rows[0].error_code]);
   });
   return {status:'SENT'};
 } catch {
   await db.query("UPDATE whatsapp_outbox SET status='UNKNOWN',payload='{}'::jsonb,error_code='SEND_UNCERTAIN',updated_at=NOW() WHERE id=$1",[claimed.id]);
   return {status:'UNKNOWN'};
 }
}
async function ingestReceipts(body,tx=db.query) {
 for(const entry of body?.entry || []) for(const change of entry.changes || []) for(const receipt of change.value?.statuses || []) {
   if(!['sent','delivered','read','failed'].includes(receipt.status)||typeof receipt.id!=='string'||receipt.id.length>512||!/^\d+$/.test(String(receipt.timestamp))) throw Error('INVALID_RECEIPT');
   if(process.env.WHATSAPP_PHONE_NUMBER_ID && change.value?.metadata?.phone_number_id!==process.env.WHATSAPP_PHONE_NUMBER_ID) throw Error('WRONG_WHATSAPP_NUMBER');
   const inserted=await tx(`INSERT INTO whatsapp_receipts(event_hash,provider_id,status,error_code,provider_timestamp) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT DO NOTHING RETURNING event_hash`,[hash(receipt.id+':'+receipt.status+':'+receipt.timestamp),receipt.id,receipt.status,String(receipt.errors?.[0]?.code || '').slice(0,40),receipt.timestamp]);
   if(!inserted.rows.length) continue;
   const stages={sent:'SENT',delivered:'DELIVERED',read:'READ',failed:'FAILED'};
   const before={sent:['SENT'],delivered:['SENT','DELIVERED'],read:['SENT','DELIVERED','READ'],failed:['SENT']};
   await tx('UPDATE whatsapp_outbox SET status=$2,error_code=$3,updated_at=NOW() WHERE provider_id=$1 AND status=ANY($4::text[])',[receipt.id,stages[receipt.status],String(receipt.errors?.[0]?.code || '').slice(0,40),before[receipt.status]]);
 }
}
async function enqueueTemplate(to,name,language) {
 const allowed=String(process.env.WHATSAPP_APPROVED_TEMPLATES || '').split(',');
 if(!/^[a-z0-9_]+$/.test(name)||!allowed.includes(name)||!/^[a-z]{2}(?:_[A-Z]{2})?$/.test(language)) throw Error('APPROVED_TEMPLATE_REQUIRED');
 return enqueue(to,{type:'template',template:{name,language:{code:language}}});
}
module.exports={messageContext,recordInbound,enqueue,textPayload,runOne,ingestReceipts,enqueueTemplate};
