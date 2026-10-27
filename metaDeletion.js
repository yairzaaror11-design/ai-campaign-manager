'use strict';
const crypto=require('node:crypto');
const express=require('express');
const db=require('./db');
const router=express.Router();
router.use(express.urlencoded({extended:false,limit:'16kb'}));
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function phoneDigest(phone) {
 const key=process.env.DELETION_HMAC_KEY || process.env.META_TOKEN_ENCRYPTION_KEY;
 if(!key) {
   if(process.env.NODE_ENV==='production') throw Error('DELETION_KEY_REQUIRED');
   return hash('development-only:'+phone);
 }
 return crypto.createHmac('sha256',key).update(String(phone).replace(/\D/g,'')).digest('hex');
}
function verifySignedRequest(value) {
 const parts=String(value||'').split('.');
 if(parts.length!==2||!process.env.META_APP_SECRET||String(value).length>16000) throw Error('INVALID_SIGNATURE');
 const sig=Buffer.from(parts[0],'base64url');
 const expected=crypto.createHmac('sha256',process.env.META_APP_SECRET).update(parts[1]).digest();
 if(sig.length!==expected.length||!crypto.timingSafeEqual(sig,expected)) throw Error('INVALID_SIGNATURE');
 const data=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
 if(data.algorithm!=='HMAC-SHA256'||!/^\d+$/.test(data.user_id)||!Number.isFinite(data.issued_at)||Math.abs(Date.now()/1000-data.issued_at)>600) throw Error('INVALID_REQUEST');
 return data;
}
async function deleteClient(clientId,tx) {
 const found=await tx('SELECT phone FROM clients WHERE id=$1',[clientId]);
 if(!found.rows.length) return;
 await tx('SELECT pg_advisory_xact_lock(hashtextextended($1,874223002))',[found.rows[0].phone]);
 const owner=await tx('SELECT phone FROM clients WHERE id=$1 FOR UPDATE',[clientId]);
 if(!owner.rows.length) return;
 const phone=owner.rows[0].phone;
 await tx('INSERT INTO deleted_client_guards(phone_digest) VALUES($1) ON CONFLICT DO NOTHING',[phoneDigest(phone)]);
 await tx("UPDATE whatsapp_inbound_events SET payload='{}'::jsonb,status='MANUAL_REVIEW',last_error='CLIENT_DELETED',locked_until=NULL WHERE regexp_replace(payload->'message'->>'from','[^0-9]','','g')=$1",[phone]);
 await tx('DELETE FROM whatsapp_receipts WHERE provider_id IN (SELECT provider_id FROM whatsapp_outbox WHERE client_id=$1)',[clientId]);
 await tx('DELETE FROM whatsapp_contacts WHERE phone=$1',[phone]);
 await tx("DELETE FROM telnyx_inbound_messages WHERE regexp_replace(from_number,'[^0-9]','','g')=$1",[phone]);
 await tx('DELETE FROM campaign_journal WHERE client_id=$1',[clientId]);
 await tx('DELETE FROM clients WHERE id=$1',[clientId]);
}
router.post('/deletion',require('./rateLimit').middleware('meta-deletion',30),async(req,res)=>{
 try {
  const signed=verifySignedRequest(req.body.signed_request);
  const confirmation=crypto.randomBytes(24).toString('hex');
  await db.transaction(async tx=>{
   const clients=await tx('SELECT id FROM clients WHERE meta_user_id=$1',[signed.user_id]);
   for(const row of clients.rows) await deleteClient(row.id,tx);
   await tx("INSERT INTO deletion_receipts(code_hash,status) VALUES($1,'COMPLETED')",[hash(confirmation)]);
  });
  res.set('Cache-Control','no-store').json({url:require('./metaConnection').config().origin+'/data-deletion/status?code='+confirmation,confirmation_code:confirmation});
 } catch {res.status(400).json({error:'Deletion request could not be completed'});}
});
router.post('/deauthorize',require('./rateLimit').middleware('meta-deauthorize',30),async(req,res)=>{
 try {
  const signed=verifySignedRequest(req.body.signed_request);
  const clients=await db.query('SELECT id FROM clients WHERE meta_user_id=$1',[signed.user_id]);
  for(const client of clients.rows) await require('./metaConnection').disconnect(client.id);
  res.sendStatus(200);
 } catch {res.sendStatus(400);}
});
module.exports={router,verifySignedRequest,deleteClient,phoneDigest};
