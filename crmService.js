'use strict';
const crypto=require('node:crypto'),db=require('./db');
const STATUSES=['NEW','CONTACTED','APPOINTMENT','WON','LOST'];
function validate(input){
 if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.length>120)throw Error('INVALID_LEAD');
 for(const [k,max]of Object.entries({phone:30,email:254,source:200,note:2000,campaignId:100,sourceEventId:200}))if(input[k]!=null&&(typeof input[k]!=='string'||input[k].length>max))throw Error('INVALID_LEAD');
 if(!input.phone&&!input.email)throw Error('LEAD_CONTACT_REQUIRED');
 if(input.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))throw Error('INVALID_LEAD_EMAIL');
 if(input.phone&&!/^\+?[\d ()-]{7,30}$/.test(input.phone))throw Error('INVALID_LEAD_PHONE');
 return{name:input.name.trim(),phone:input.phone||null,email:input.email||null,source:input.source||'manual',note:input.note||'',campaignId:input.campaignId||null,sourceEventId:input.sourceEventId||null};
}
async function create(clientId,input){
 const x=validate(input);
 return db.transaction(async tx=>{
  const c=await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[clientId]);if(!c.rows.length)throw Error('CLIENT_NOT_FOUND');
  const r=await tx(`INSERT INTO crm_leads(id,client_id,name,phone,email,source,source_event_id,campaign_id,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(client_id,source,source_event_id) DO NOTHING RETURNING *`,[crypto.randomUUID(),clientId,x.name,x.phone,x.email,x.source,x.sourceEventId,x.campaignId,x.note]);
  if(!r.rows.length)return{duplicate:true};
  await tx("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'CRM_LEAD','CREATED')",[clientId]);return r.rows[0];
 });
}
async function list(clientId){return(await db.query('SELECT * FROM crm_leads WHERE client_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',[clientId])).rows;}
async function update(clientId,id,{status,version,note,revenueMinor,currency}={}){
 if(!/^[a-f0-9-]{36}$/i.test(id||'')||!STATUSES.includes(status)||!Number.isInteger(version)||note!=null&&(typeof note!=='string'||note.length>2000)||revenueMinor!=null&&(!Number.isSafeInteger(revenueMinor)||revenueMinor<0||!['ILS','USD','EUR'].includes(currency)))throw Error('INVALID_LEAD_UPDATE');
 return db.transaction(async tx=>{
  const r=await tx(`UPDATE crm_leads SET status=$3,note=COALESCE($4,note),revenue_minor=COALESCE($5,revenue_minor),currency=COALESCE($6,currency),version=version+1,updated_at=NOW() WHERE client_id=$1 AND id=$2 AND version=$7 RETURNING *`,[clientId,id,status,note??null,revenueMinor??null,revenueMinor!=null?currency:null,version]);
  if(!r.rows.length)throw Error('LEAD_NOT_FOUND_OR_STALE');
  await tx("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'CRM_LEAD', $2)",[clientId,status]);return r.rows[0];
 });
}
async function summary(clientId){
 const r=await db.query(`SELECT status,COUNT(*)::int AS count FROM crm_leads WHERE client_id=$1 GROUP BY status`,[clientId]);
 const revenue=await db.query("SELECT currency,SUM(revenue_minor)::text AS amount FROM crm_leads WHERE client_id=$1 AND status='WON' AND revenue_minor IS NOT NULL GROUP BY currency",[clientId]);
 return{counts:Object.fromEntries(r.rows.map(x=>[x.status,x.count])),revenue:revenue.rows,source:'customer_crm',attribution:'user_reported; not independently verified campaign attribution'};
}
module.exports={STATUSES,validate,create,list,update,summary};
