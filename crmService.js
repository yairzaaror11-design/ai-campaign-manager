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
async function create(clientId,input,canSave){
 const x=validate(input);
 return db.transaction(async tx=>{
  const c=await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[clientId]);if(!c.rows.length)throw Error('CLIENT_NOT_FOUND');
  if(canSave && !await canSave(tx))return{revoked:true};
  const r=await tx(`INSERT INTO crm_leads(id,client_id,name,phone,email,source,source_event_id,campaign_id,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(client_id,source,source_event_id) DO NOTHING RETURNING *`,[crypto.randomUUID(),clientId,x.name,x.phone,x.email,x.source,x.sourceEventId,x.campaignId,x.note]);
  if(!r.rows.length)return{duplicate:true};
  await require('./metaCrmFeedback').enqueue(tx,r.rows[0]);
  await tx("INSERT INTO lead_events(lead_id,client_id,kind,detail) VALUES($1,$2,'CREATED',$3)",[r.rows[0].id,clientId,String(x.source).slice(0,300)]);
  await tx("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'CRM_LEAD','CREATED')",[clientId]);return r.rows[0];
 });
}
async function list(clientId,{limit=100}={}){return(await db.query('SELECT * FROM crm_leads WHERE client_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2',[clientId,Math.min(5000,Math.max(1,limit))])).rows;}
async function timeline(clientId,id){if(!/^[a-f0-9-]{36}$/i.test(id||''))throw Error('INVALID_LEAD');return(await db.query('SELECT kind,detail,at FROM lead_events WHERE client_id=$1 AND lead_id=$2 ORDER BY at,id LIMIT 200',[clientId,id])).rows;}
async function addReminder(clientId,id,{date,requestId}={}){
 const lead=(await db.query('SELECT name FROM crm_leads WHERE client_id=$1 AND id=$2',[clientId,id])).rows[0];if(!lead)throw Error('LEAD_NOT_FOUND_OR_STALE');
 const task=await require('./workspaceService').save(clientId,'tasks',{title:'לחזור ל'+lead.name.slice(0,150),note:'תזכורת מהפנייה של '+lead.name,date,status:'OPEN'},{requestId});
 await db.query("INSERT INTO lead_events(lead_id,client_id,kind,detail) VALUES($1,$2,'REMINDER',$3)",[id,clientId,String(date)]);return task;
}
// Excel-friendly CSV (UTF-8 BOM, quoted, formula-safe).
function csv(leads){const LABEL={NEW:'חדש',CONTACTED:'בטיפול',APPOINTMENT:'נקבעה פגישה',WON:'נסגרה עסקה',LOST:'לא הבשיל'};const cell=v=>{let t=v==null?'':String(v);if(/^[=+\-@\t\r]/.test(t))t="'"+t;return '"'+t.replace(/"/g,'""')+'"';};const rows=[['שם','טלפון','אימייל','מקור','קמפיין','מצב','הכנסה','מטבע','הערות','נוצר'],...leads.map(l=>[l.name,l.phone,l.email,l.source,l.campaign_id,LABEL[l.status]||l.status,l.revenue_minor==null?'':Number(l.revenue_minor)/100,l.currency,l.note,new Date(l.created_at).toISOString().slice(0,16).replace('T',' ')])];return '\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n');}
async function newMetaLeads(clientId, before) {
 const filter = "client_id=$1 AND source='meta_lead_ads' AND status='NEW'";
 const count = await db.query(`SELECT COUNT(*)::int AS count FROM crm_leads WHERE ${filter}`,[clientId]);
 const page = await db.query(`SELECT * FROM crm_leads WHERE ${filter}
  AND ($2::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM crm_leads WHERE client_id=$1 AND id=$2))
  ORDER BY created_at DESC,id DESC LIMIT 101`,[clientId,before||null]);
 const leads=page.rows.slice(0,100);
 return {count:count.rows[0].count,leads,next:page.rows.length>100?leads.at(-1).id:null};
}
async function update(clientId,id,{status,version,note,revenueMinor,currency}={}){
 if(!/^[a-f0-9-]{36}$/i.test(id||'')||!STATUSES.includes(status)||!Number.isInteger(version)||note!=null&&(typeof note!=='string'||note.length>2000)||revenueMinor!=null&&(!Number.isSafeInteger(revenueMinor)||revenueMinor<0||!['ILS','USD','EUR'].includes(currency)))throw Error('INVALID_LEAD_UPDATE');
 return db.transaction(async tx=>{
  const before=(await tx('SELECT status,note FROM crm_leads WHERE client_id=$1 AND id=$2',[clientId,id])).rows[0];
  const r=await tx(`UPDATE crm_leads SET status=$3,note=COALESCE($4,note),revenue_minor=COALESCE($5,revenue_minor),currency=COALESCE($6,currency),version=version+1,updated_at=NOW() WHERE client_id=$1 AND id=$2 AND version=$7 RETURNING *`,[clientId,id,status,note??null,revenueMinor??null,revenueMinor!=null?currency:null,version]);
  if(!r.rows.length)throw Error('LEAD_NOT_FOUND_OR_STALE');
  await require('./metaCrmFeedback').enqueue(tx,r.rows[0]);
  const row=r.rows[0];
  if(before&&before.status!==row.status)await tx("INSERT INTO lead_events(lead_id,client_id,kind,detail) VALUES($1,$2,'STATUS',$3)",[id,clientId,row.status]);
  if(note!=null&&note!==before?.note)await tx("INSERT INTO lead_events(lead_id,client_id,kind,detail) VALUES($1,$2,'NOTE',$3)",[id,clientId,String(note).slice(0,300)]);
  if(revenueMinor!=null)await tx("INSERT INTO lead_events(lead_id,client_id,kind,detail) VALUES($1,$2,'REVENUE',$3)",[id,clientId,(revenueMinor/100)+' '+currency]);
  await tx("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'CRM_LEAD', $2)",[clientId,status]);return r.rows[0];
 });
}
async function summary(clientId){
 const r=await db.query(`SELECT status,COUNT(*)::int AS count FROM crm_leads WHERE client_id=$1 GROUP BY status`,[clientId]);
 const revenue=await db.query("SELECT currency,SUM(revenue_minor)::text AS amount FROM crm_leads WHERE client_id=$1 AND status='WON' AND revenue_minor IS NOT NULL GROUP BY currency",[clientId]);
 return{counts:Object.fromEntries(r.rows.map(x=>[x.status,x.count])),revenue:revenue.rows,source:'customer_crm',attribution:'user_reported; not independently verified campaign attribution'};
}
module.exports={STATUSES,validate,create,list,timeline,addReminder,csv,newMetaLeads,update,summary};
