'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {openDatabase}=require('./helpers/database'),agent=require('../taskAgent'),meta=require('../metaConnection');
test('a new goal escapes a stalled conversation, revokes only its old approvals and starts without old content',async()=>{
 const env={...process.env},h=await openDatabase();
 Object.assign(process.env,{TASK_AGENT_ENABLED:'true',META_TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64')});
 const client=(await h.db.query("INSERT INTO clients(phone) VALUES('972500066119') RETURNING *")).rows[0];
 let calls=0,context;
 const planner=async c=>{calls++;context=c;return{plan:[{id:'details',kind:'collect',label:'פרטי הבקשה',dependsOn:[]}],next:{op:'ask',stepId:'details',question:'למי מיועד הקורס?'}};};
 const send=(message,requestId,options={})=>meta.context.run(String(client.id),()=>agent.send(client.id,{message,requestId,channel:'WHATSAPP'},{planner,...options}));
 try{
  const old=await send('תיצור קמפיין לדירה בבית קרקע ברחוב אלמוג עם הנחה של 7%','old',{deferPlanning:true});
  const other=(await h.db.query("INSERT INTO clients(phone) VALUES('972500066120') RETURNING *")).rows[0];
  for(const [id,owner] of [['old-approval',client.id],['other-approval',other.id]]){
   await h.db.query("INSERT INTO action_plans(id,client_id,intent,payload) VALUES($1,$2,'CREATE_CAMPAIGN','{}')",[id,owner]);
   await h.db.query("INSERT INTO approvals(client_id,action_id,code,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '10 minutes')",[owner,id,id]);
  }
  await h.db.query("UPDATE agent_tasks SET state=$2::jsonb WHERE id=$1",[old.task.id,JSON.stringify({steps:[{id:'create',kind:'meta',status:'WAITING_APPROVAL',result:{approval:{actionId:'old-approval'}}}],facts:{address:'אלמוג'},messages:[]})]);
  const advice=await send('מה אתה ממליץ לי לשווק?','advice',{deferPlanning:true});
  assert.match(advice.reply,/מה המוצר או השירות/);assert.doesNotMatch(advice.reply,/אלמוג|7%|דירה|המשך במשימה/);assert.notEqual(advice.task.id,old.task.id);
  const switched=await send('אני רוצה לשווק משהו אחר','switch',{deferPlanning:true});
  assert.notEqual(switched.task.id,advice.task.id);assert.equal(switched.task.status,'WAITING_INPUT');assert.equal(calls,0);assert.equal(switched.reply,'בטח, מה המוצר או השירות שתרצה לקדם עכשיו?');
  assert.deepEqual(await send('אני רוצה לשווק משהו אחר','switch',{deferPlanning:true}),switched);
  assert.equal((await h.db.query('SELECT status FROM agent_tasks WHERE id=$1',[old.task.id])).rows[0].status,'CANCELLED');
  assert.equal((await h.db.query("SELECT status FROM approvals WHERE action_id='old-approval'")).rows[0].status,'CANCELLED');
  assert.equal((await h.db.query("SELECT status FROM action_plans WHERE id='old-approval'")).rows[0].status,'CANCELLED');
  assert.equal((await h.db.query("SELECT status FROM approvals WHERE action_id='other-approval'")).rows[0].status,'PENDING');
  const yes=await send('כן','yes',{deferPlanning:true});assert.equal(yes.task.status,'WAITING_INPUT');assert.equal(calls,0);
  assert.equal((await send('עצור','pause')).task.status,'PAUSED');
  assert.equal((await send('המשך במשימה','resume')).task.status,'WAITING_INPUT');
  assert.equal((await send('אשר 123456','stale-code')).task.status,'WAITING_INPUT');assert.equal(calls,0);
  const next=await send('קורס צילום בסמארטפון','new-details');assert.equal(next.task.id,switched.task.id);assert.equal(next.task.request,'קורס צילום בסמארטפון');assert.equal(calls,1);assert.match(next.reply,/למי מיועד הקורס/);assert.doesNotMatch(JSON.stringify(context),/אלמוג|7%|דירה/);
  assert.equal((await h.db.query('SELECT count(*)::int AS n FROM meta_execution_attempts')).rows[0].n,0);
  const followup=await send('אפשר כותרת אחרת?','revision');assert.equal(followup.task.id,next.task.id);
  await h.db.query("UPDATE agent_tasks SET status='MANUAL_REVIEW' WHERE id=$1",[next.task.id]);
  const blocked=await send('אני רוצה לקדם מוצר אחר','uncertain',{deferPlanning:true});assert.equal(blocked.task.id,next.task.id);assert.match(blocked.reply,/לברר את תוצאת הפעולה/);
  await h.db.query("UPDATE agent_tasks SET status='WAITING_MODEL',state=$2::jsonb WHERE id=$1",[next.task.id,JSON.stringify({steps:[{id:'create',kind:'meta',status:'WAITING_APPROVAL',result:{approval:{actionId:'old-approval'}}}],facts:{},messages:[]})]);
  await h.db.query("INSERT INTO meta_execution_attempts(action_id,client_id,status) VALUES('old-approval',$1,'MANUAL_REVIEW')",[client.id]);
  const uncertain=await send('אני רוצה לקדם מוצר אחר','uncertain-attempt',{deferPlanning:true});assert.equal(uncertain.task.id,next.task.id);assert.match(uncertain.reply,/לברר את תוצאת הפעולה/);
  await h.db.query("UPDATE agent_tasks SET status='READY',lease_token=$2,lease_until=NOW()+INTERVAL '1 minute' WHERE id=$1",[next.task.id,crypto.randomUUID()]);
  assert.equal((await send('אני רוצה לקדם מוצר אחר','busy')).busy,true);
 }finally{await h.close();for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);}
});
