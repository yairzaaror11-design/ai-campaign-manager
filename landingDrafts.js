'use strict';
const crypto=require('node:crypto'),db=require('./db'),workspace=require('./workspaceService');
function checked(input){
 const payload={};for(const [field,max]of Object.entries({businessName:120,title:200,body:8000,cta:120,product:1000})){const v=input?.[field]??(field==='product'?'':undefined);if(typeof v!=='string'||v.length>max||['businessName','title','body','cta'].includes(field)&&!v.trim())throw Error('INVALID_LANDING_DRAFT');payload[field]=v.trim();}
 return {...payload,privacyContact:process.env.PRIVACY_CONTACT_EMAIL||null};
}
async function mutate(clientId,operation,input,work){
 if(!workspace.uuid(input?.requestId))throw Error('INVALID_LANDING_REQUEST');
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify({operation,input})).digest('hex');
 return db.transaction(async tx=>{
  const client=await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[clientId]);if(!client.rows.length)throw Error('CLIENT_NOT_FOUND');
  const previous=(await tx('SELECT fingerprint,result FROM workspace_requests WHERE client_id=$1 AND request_id=$2',[clientId,input.requestId])).rows[0];if(previous){if(previous.fingerprint!==fingerprint)throw Error('WORKSPACE_REQUEST_CONFLICT');return previous.result;}
  const result=await work(tx);await tx('INSERT INTO workspace_requests(client_id,request_id,fingerprint,result) VALUES($1,$2,$3,$4::jsonb)',[clientId,input.requestId,fingerprint,JSON.stringify(result)]);return result;
 });
}
async function save(clientId,input,id){
 const payload=checked(input?.payload);if(id!==undefined&&(!workspace.uuid(id)||!Number.isSafeInteger(input?.revision)||input.revision<1))throw Error('INVALID_LANDING_DRAFT');
 return mutate(clientId,'landing-draft:'+String(id||'new'),input,async tx=>{
  let r;if(id)r=(await tx("UPDATE landing_pages SET payload=$3::jsonb,revision=revision+1,updated_at=NOW() WHERE client_id=$1 AND id=$2 AND revision=$4 AND status='DRAFT' RETURNING id,payload,status,revision,created_at",[clientId,id,JSON.stringify(payload),input.revision])).rows[0];
  else r=(await tx("INSERT INTO landing_pages(id,client_id,slug,payload) VALUES($1,$2,$3,$4::jsonb) RETURNING id,payload,status,revision,created_at",[crypto.randomUUID(),clientId,crypto.randomBytes(20).toString('hex'),JSON.stringify(payload)])).rows[0];
  if(!r)throw Error('WORKSPACE_STALE');await tx("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'LANDING_DRAFT_SAVED',$2)",[clientId,r.id]);return r;
 });
}
async function publish(clientId,id,input){
 if(!workspace.uuid(id)||input?.confirmPublish!==true||!Number.isSafeInteger(input.revision)||input.revision<1)throw Error('LANDING_PUBLISH_CONFIRMATION_REQUIRED');
 return mutate(clientId,'landing-publish:'+id,input,async tx=>{
  if(!(await tx('SELECT client_id FROM customer_accounts WHERE client_id=$1',[clientId])).rows.length)throw Error('REGISTRATION_REQUIRED');
  const r=(await tx("UPDATE landing_pages SET status='PUBLISHED',revision=revision+1,published_at=NOW(),updated_at=NOW() WHERE client_id=$1 AND id=$2 AND revision=$3 AND status='DRAFT' RETURNING id,slug,status,revision",[clientId,id,input.revision])).rows[0];if(!r)throw Error('WORKSPACE_STALE');
  await tx("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'LANDING_PUBLISHED',$2)",[clientId,id]);return {...r,url:require('./portalStore').origin()+'/p/'+r.slug};
 });
}
module.exports={checked,save,publish};
