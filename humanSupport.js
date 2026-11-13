'use strict';
const crypto=require('node:crypto'),db=require('./db'),{uuid}=require('./workspaceService');
function operator(clientId){return String(process.env.SUPPORT_OPERATOR_CLIENT_IDS||'').split(',').map(x=>x.trim()).filter(x=>/^[1-9]\d*$/.test(x)).includes(String(clientId));}
function text(value,max){if(typeof value!=='string'||!value.trim()||value.length>max||value.includes('\0'))throw Error('INVALID_SUPPORT_INPUT');return value.trim();}
function humanRequested(value){return /^(?:(?:אני\s+)?(?:רוצה|מבקש|מבקשת|צריך|צריכה)\s+)?(?:לדבר|לשוחח)\s+עם\s+(?:נציג|נציגה|אדם|בן אדם|מישהו אמיתי)[.!?\s]*$|^(?:נציג אנושי|נציג בבקשה|אפשר נציג|תעביר אותי לנציג|תעבירי אותי לנציג|speak to a human|human support)[.!?\s]*$/i.test(String(value).trim());}
function resumeRequested(value){return /^(?:המשך עם הבוט|להמשיך עם הבוט|חזרה לבוט|resume bot)[.!?\s]*$/i.test(String(value).trim());}
async function current(clientId){return(await db.query("SELECT * FROM support_cases WHERE client_id=$1 AND status<>'RESOLVED'",[clientId])).rows[0]||null;}
async function messages(clientId,id,{asOperator=false,actor}={}){
 if(!uuid(id)||asOperator&&!operator(actor))throw Error('SUPPORT_ACCESS_DENIED');
 const c=(await db.query('SELECT * FROM support_cases WHERE id=$1 AND ($2::boolean OR client_id=$3)',[id,asOperator,clientId])).rows[0];if(!c)throw Error('SUPPORT_ACCESS_DENIED');
 const rows=(await db.query('SELECT id,author,body,created_at FROM support_messages WHERE case_id=$1 ORDER BY created_at DESC,id DESC LIMIT 201',[id])).rows;
 return{case:c,messages:rows.slice(0,200).reverse(),hasMore:rows.length>200};
}
async function request(clientId,{reason,channel='PORTAL',eventId}={}){
 reason=text(reason,2000);eventId=text(eventId,200);if(!['PORTAL','WHATSAPP'].includes(channel))throw Error('INVALID_SUPPORT_INPUT');
 return db.transaction(async tx=>{
  if(!(await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[clientId])).rows.length)throw Error('CLIENT_NOT_FOUND');
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify({reason,channel})).digest('hex');
  const cached=(await tx('SELECT r.fingerprint,c.* FROM support_requests r JOIN support_cases c ON c.id=r.case_id WHERE r.client_id=$1 AND r.event_id=$2',[clientId,eventId])).rows[0];
  if(cached){if(cached.fingerprint!==fingerprint)throw Error('SUPPORT_REQUEST_CONFLICT');delete cached.fingerprint;return cached;}
  let c=(await tx("SELECT * FROM support_cases WHERE client_id=$1 AND status<>'RESOLVED' FOR UPDATE",[clientId])).rows[0];
  if(!c){
   const history=(await tx('SELECT role,content FROM conversation_messages WHERE client_id=$1 ORDER BY created_at DESC,id DESC LIMIT 12',[clientId])).rows.reverse().map(x=>({role:x.role,content:x.content.slice(0,800)}));
   const p=(await tx('SELECT payload FROM marketing_profiles WHERE client_id=$1',[clientId])).rows[0]?.payload;
   const portal=(p?.portalChat?.messages||[]).slice(-6).map(x=>({role:x.role,content:String(x.content).slice(0,800)}));
   c=(await tx("INSERT INTO support_cases(id,client_id,channel,reason,context) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING *",[crypto.randomUUID(),clientId,channel,reason,JSON.stringify([...history,...portal])])).rows[0];
   // Do not deliver already queued automatic replies after an explicit handover.
   await tx("UPDATE whatsapp_outbox SET status='BLOCKED',error_code='HUMAN_HANDOVER',payload='{}'::jsonb WHERE client_id=$1 AND status='PENDING'",[clientId]);
   await tx("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'HUMAN_HANDOVER','BOT_PAUSED')",[clientId]);
  }
  await tx("INSERT INTO support_messages(id,case_id,author,body,event_id) VALUES($1,$2,'CUSTOMER',$3,$4) ON CONFLICT(case_id,event_id) DO NOTHING",[crypto.randomUUID(),c.id,reason,'request:'+eventId]);
  await tx('INSERT INTO support_requests(client_id,event_id,case_id,fingerprint) VALUES($1,$2,$3,$4)',[clientId,eventId,c.id,fingerprint]);return c;
 });
}
async function append(clientId,id,{body,eventId,asOperator=false,actor}={}){
 body=text(body,4000);eventId=text(eventId,200);if(!uuid(id)||asOperator&&!operator(actor))throw Error('SUPPORT_ACCESS_DENIED');
 return db.transaction(async tx=>{
  const c=(await tx("SELECT * FROM support_cases WHERE id=$1 AND ($2::boolean OR client_id=$3) AND status<>'RESOLVED' FOR UPDATE",[id,asOperator,clientId])).rows[0];if(!c)throw Error('SUPPORT_ACCESS_DENIED');
  const key=(asOperator?'operator:'+actor+':':'customer:')+eventId;
  const prior=(await tx('SELECT body FROM support_messages WHERE case_id=$1 AND event_id=$2',[id,key])).rows[0];if(prior&&prior.body!==body)throw Error('SUPPORT_REQUEST_CONFLICT');
  if(!prior)await tx('INSERT INTO support_messages(id,case_id,author,body,event_id) VALUES($1,$2,$3,$4,$5)',[crypto.randomUUID(),id,asOperator?'OPERATOR':'CUSTOMER',body,key]);
  await tx('UPDATE support_cases SET updated_at=NOW() WHERE id=$1',[id]);return{ok:true};
 });
}
async function resume(clientId,id,version,{asOperator=false,actor}={}){
 if(!uuid(id)||!Number.isSafeInteger(version)||version<1||asOperator&&!operator(actor))throw Error('SUPPORT_ACCESS_DENIED');
 return db.transaction(async tx=>{
  const c=(await tx("UPDATE support_cases SET status='RESOLVED',bot_paused=false,version=version+1,updated_at=NOW() WHERE id=$1 AND ($2::boolean OR client_id=$3) AND version=$4 AND status<>'RESOLVED' RETURNING client_id",[id,asOperator,clientId,version])).rows[0];if(!c)throw Error('SUPPORT_STALE');
  await tx("INSERT INTO support_messages(id,case_id,author,body,event_id) VALUES($1,$2,'SYSTEM','המענה האוטומטי חודש. לא נשלחו מחדש הודעות שנעצרו.',$3)",[crypto.randomUUID(),id,'resume:'+version]);
  await tx("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'HUMAN_HANDOVER',$2)",[c.client_id,asOperator?'RESUMED_BY_OPERATOR':'RESUMED_BY_CUSTOMER']);return{ok:true};
 });
}
async function list(clientId,{asOperator=false}={}){
 if(asOperator&&!operator(clientId))throw Error('SUPPORT_ACCESS_DENIED');
 return{cases:(await db.query('SELECT id,client_id,channel,reason,status,bot_paused,version,created_at,updated_at FROM support_cases WHERE ($1::boolean OR client_id=$2) ORDER BY updated_at DESC LIMIT 100',[asOperator,clientId])).rows};
}
module.exports={operator,humanRequested,resumeRequested,current,messages,request,append,resume,list};
