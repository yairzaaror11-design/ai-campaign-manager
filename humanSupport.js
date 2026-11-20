'use strict';
const crypto=require('node:crypto'),db=require('./db'),{uuid}=require('./workspaceService');
function operator(clientId){return String(process.env.SUPPORT_OPERATOR_CLIENT_IDS||'').split(',').map(x=>x.trim()).filter(x=>/^[1-9]\d*$/.test(x)).includes(String(clientId));}
function text(value,max){if(typeof value!=='string'||!value.trim()||value.length>max||value.includes('\0'))throw Error('INVALID_SUPPORT_INPUT');return value.trim();}
// Asking for a person, in the words owners actually use: "נציג", "אפשר נציג?",
// "אפשר לדבר עם בן אדם", "תעביר אותי לנציג", "speak to a human". Anchored to the whole
// message so business text like "מודעה לנציג מכירות" never pauses the agent.
const PERSON='(?:נציג|נציגה|נציג אנושי|נציגה אנושית|בן אדם|בנאדם|בן אדם אמיתי|אדם אמיתי|מישהו אמיתי|מישהו מהצוות|מישהו אנושי)';
const ASK='(?:(?:אפשר|אני|רוצה|מבקש|מבקשת|צריך|צריכה|תן לי|תני לי|בבקשה|רק)\\s+)*';
const VERB='(?:(?:לדבר|לשוחח|לקבל שיחה|שיחה|לקבל מענה|מענה)\\s+(?:עם\\s+|מ)|(?:תעביר|תעבירי|להעביר|תחבר|תחברי|לחבר)\\s+(?:אותי\\s+)?(?:ל|אל\\s+|עם\\s+))?';
const HUMAN_RE=new RegExp('^'+ASK+VERB+PERSON+'(?:\\s+(?:בבקשה|דחוף|עכשיו))?$');
function humanRequested(value){
 const t=String(value??'').trim().replace(/[.!?,׳"'\s]+$/u,'').replace(/\s+/g,' ').replace(/^(?:היי|הי|שלום)[,\s]+/u,'');
 if(!t||t.length>80)return false;
 if(/^(?:speak to a human|talk to a human|human support|human|agent)(?: please)?$/i.test(t))return true;
 return HUMAN_RE.test(t)||/^(?:לדבר|לשוחח) עם (?:אדם|מישהו)$/.test(t);
}
function resumeRequested(value){return /^(?:המשך עם הבוט|להמשיך עם הבוט|חזרה לבוט|המשך עם הסוכן|להמשיך עם הסוכן|חזרה לסוכן|resume bot)[.!?\s]*$/i.test(String(value).trim());}
const RESPONSE_TIME='נציג יחזור אליך עד יום העסקים הבא';
// Tells every support operator (SUPPORT_OPERATOR_CLIENT_IDS) about a new handover, in real time.
async function notifyOperators(clientId,c){
 const ids=String(process.env.SUPPORT_OPERATOR_CLIENT_IDS||'').split(',').map(x=>x.trim()).filter(x=>/^[1-9]\d*$/.test(x)&&x!==String(clientId));
 if(!ids.length){require('./logger').logger.warn('Human support requested but no operator is configured');return 0;}
 const client=(await db.query('SELECT display_name FROM clients WHERE id=$1',[clientId])).rows[0];
 const profile=(await db.query('SELECT payload FROM marketing_profiles WHERE client_id=$1',[clientId])).rows[0]?.payload;
 const who=String(profile?.business?.name||profile?.facts?.businessName||client?.display_name||'').slice(0,80)||'עסק';
 const text=`🙋 בקשה לנציג אנושי\nעסק: ${who} (#${clientId})\nערוץ: ${c.channel==='PORTAL'?'האתר':'וואטסאפ'}\nהודעה: ${String(c.reason).slice(0,300)}\nהמענה האוטומטי ללקוח הושהה עד שתחזרו אליו. הובטח לו מענה עד יום העסקים הבא.`;
 let sent=0;
 for(const id of ids){
  try{
   const phone=(await db.query('SELECT phone FROM clients WHERE id=$1',[id])).rows[0]?.phone;if(!phone)continue;
   await require('./metaConnection').context.run(String(id),()=>require('./whatsappDelivery').messageContext.run({eventId:'support:'+c.id+':'+id,sequence:0,humanSupportNotice:true},()=>require('./whatsapp').safeSend(phone,text)));
   sent++;
  }catch(error){require('./logger').logger.warn('Support operator not notified',{error:/^[A-Z_]+$/.test(error?.message)?error.message:'NOTICE_FAILED'});}
 }
 return sent;
}
async function current(clientId){return(await db.query("SELECT * FROM support_cases WHERE client_id=$1 AND status<>'RESOLVED'",[clientId])).rows[0]||null;}
async function messages(clientId,id,{asOperator=false,actor}={}){
 if(!uuid(id)||asOperator&&!operator(actor))throw Error('SUPPORT_ACCESS_DENIED');
 const c=(await db.query('SELECT * FROM support_cases WHERE id=$1 AND ($2::boolean OR client_id=$3)',[id,asOperator,clientId])).rows[0];if(!c)throw Error('SUPPORT_ACCESS_DENIED');
 const rows=(await db.query('SELECT id,author,body,created_at FROM support_messages WHERE case_id=$1 ORDER BY created_at DESC,id DESC LIMIT 201',[id])).rows;
 return{case:c,messages:rows.slice(0,200).reverse(),hasMore:rows.length>200};
}
async function request(clientId,{reason,channel='PORTAL',eventId}={}){
 reason=text(reason,2000);eventId=text(eventId,200);if(!['PORTAL','WHATSAPP'].includes(channel))throw Error('INVALID_SUPPORT_INPUT');
 let opened=false;
 const result=await db.transaction(async tx=>{
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
   opened=true;
  }
  await tx("INSERT INTO support_messages(id,case_id,author,body,event_id) VALUES($1,$2,'CUSTOMER',$3,$4) ON CONFLICT(case_id,event_id) DO NOTHING",[crypto.randomUUID(),c.id,reason,'request:'+eventId]);
  await tx('INSERT INTO support_requests(client_id,event_id,case_id,fingerprint) VALUES($1,$2,$3,$4)',[clientId,eventId,c.id,fingerprint]);return c;
 });
 if(opened){try{await notifyOperators(clientId,result);}catch{require('./logger').logger.warn('Support operators not notified');}}
 return result;
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
module.exports={RESPONSE_TIME,notifyOperators,operator,humanRequested,resumeRequested,current,messages,request,append,resume,list};
