'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),axios=require('axios');
const agent=require('../taskAgent'),meta=require('../metaConnection'),{openDatabase}=require('./helpers/database');
const plan=()=>[
 {id:'details',label:'השלמת פרטי המשרה',kind:'collect',dependsOn:[]},
 {id:'pages',label:'בדיקת דף הפרסום',kind:'read',dependsOn:['details']},
 {id:'copy',label:'נוסח מודעת הדרושים',kind:'draft',dependsOn:['details']},
 {id:'form',label:'שאלות הטופס',kind:'draft',dependsOn:['details']},
 {id:'create_form',label:'יצירת הטופס בחשבון המחובר',kind:'meta',intent:'CREATE_LEAD_FORM',dependsOn:['pages','copy','form']}
];
const parameters=()=>({name:'Customer service job',pageId:'555',locale:'HE_IL',privacyPolicyUrl:'https://business.example/privacy',questions:[{type:'FULL_NAME'},{type:'PHONE'},{type:'CUSTOM',key:'experience',label:'מה הניסיון הרלוונטי שלך?'}]});
const planner=async c=>{
 if(!c.plan.length)return{plan:plan(),next:{op:'ask',stepId:'details',question:'לאיזו משרה ובאיזה אזור מגייסים?'}};
 const by=id=>c.plan.find(s=>s.id===id);
 if(by('details').status!=='DONE')return{next:{op:'collect',stepId:'details',facts:[{key:'role',value:'נציגי שירות',evidence:'נציגי שירות בחיפה'},{key:'location',value:'חיפה',evidence:'נציגי שירות בחיפה'}]}};
 if(by('pages').status!=='DONE')return{next:{op:'read',stepId:'pages',tool:'get_meta_pages',args:{}}};
 if(by('copy').status==='PENDING')return{next:{op:'draft',stepId:'copy',title:'מודעת דרושים',content:'דרושים נציגי שירות בחיפה. להגשת מועמדות השאירו פרטים.'}};
 if(by('form').status==='PENDING')return{next:{op:'draft',stepId:'form',title:'שאלות הטופס',content:JSON.stringify(parameters())}};
 if(c.plan.some(s=>s.status==='PREPARED'))return{next:{op:'review'}};
 if(by('create_form').status==='PENDING')return{next:{op:'meta',stepId:'create_form',proposal:{intent:'CREATE_LEAD_FORM',summary:'יצירת טופס למשרת נציגי שירות',target:{accountId:'act_11'},parameters:parameters()}}};
 return{next:{op:'finish'}};
};
test('task plans reject cycles, hidden executors and unsupported capabilities',()=>{
 assert.throws(()=>agent.validatePlan([{id:'a',label:'x',kind:'read',dependsOn:['a']}]),/INVALID_TASK_PLAN/);
 assert.throws(()=>agent.validatePlan([{id:'copy',label:'copy',kind:'draft',dependsOn:[]}],'תיצור לי קמפיין דרושים'),/MISSING_OUTCOME/);
 assert.deepEqual(agent.requiredOutcomes('תכין לי טיוטת קמפיין'),[]);
 assert.throws(()=>agent.validatePlan([{id:'a',label:'x',kind:'shell',dependsOn:[]}]),/INVALID_TASK_PLAN/);
 assert.throws(()=>agent.validatePlan([{id:'a',label:'x',kind:'meta',intent:'DELETE_ANYTHING',dependsOn:[]}]),/UNSUPPORTED/);
});
test('bot task persists goal, asks only missing details, prepares a package, gets exact approvals and verifies a real executor result',async t=>{
 const env={...process.env},get=axios.get,post=axios.post,h=await openDatabase();
 Object.assign(process.env,{TASK_AGENT_ENABLED:'true',META_TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),APPROVAL_HMAC_KEY:crypto.randomBytes(32).toString('hex'),META_APP_ID:'123',META_APP_SECRET:'secret',META_LOGIN_CONFIG_ID:'456',APP_PUBLIC_URL:'https://campaign.example',META_WRITES_ENABLED:'true',READ_ONLY:'false'});
 const a=await require('../clientStore').getOrCreateClient('972500033331'),b=await require('../clientStore').getOrCreateClient('972500033332');
 await h.db.query("INSERT INTO meta_connections(client_id,meta_user_id,token_ciphertext,app_id,expires_at) VALUES($1,'test-user',$2,'123',NOW()+INTERVAL '1 hour')",[a.id,meta.encrypt('fixture-user',a.id)]);await h.db.query("UPDATE clients SET meta_ad_account_id='act_11' WHERE id=$1",[a.id]);
 let writes=0,calls=0;
 axios.get=async url=>{
  if(url.endsWith('/me/permissions'))return{data:{data:[{permission:'ads_management',status:'granted'}]}};
  if(url.endsWith('/act_11'))return{data:{id:'act_11',currency:'ILS',name:'Account',timezone_name:'Asia/Jerusalem'}};
  if(url.endsWith('/me/accounts'))return{data:{data:[{id:'555',name:'Page',access_token:'fixture-page'}]}};
  if(url.endsWith('/777'))return{data:{id:'777',page_id:'555',name:parameters().name,locale:'HE_IL',privacy_policy_url:parameters().privacyPolicyUrl,questions:parameters().questions,status:'ACTIVE'}};
  throw Error('Unexpected provider read');
 };
 axios.post=async(url,body)=>{assert.ok(url.endsWith('/555/leadgen_forms'));writes++;return{data:{id:'777'}};};
 const options={planner:async c=>{calls++;assert.equal(JSON.stringify(c).includes('fixture-page'),false);return planner(c);},readTool:async()=>({pages:[{id:'555',name:'Page'}],access_token:'fixture-page'})};
 const send=(message,requestId,extra={})=>meta.context.run(String(a.id),()=>agent.send(a.id,{message,requestId,channel:'WHATSAPP',...extra},options));
 let first,review,pending;
 try{
  await t.test('initial missing detail question and stable replay without new planning',async()=>{
   first=await send('תכין מודעה וטופס למשרה בעסק שלי','turn-1');assert.equal(first.task.status,'WAITING_INPUT');assert.match(first.reply,/משרה/);const n=calls;
   assert.deepEqual(await send('תכין מודעה וטופס למשרה בעסק שלי','turn-1'),first);assert.equal(calls,n);
   await assert.rejects(send('בקשה אחרת','turn-1'),/TASK_REQUEST_CONFLICT/);
  });
  await t.test('answer drives all independent steps automatically to a combined review',async()=>{
   review=await send('נציגי שירות בחיפה','turn-2');assert.equal(review.task.id,first.task.id);assert.equal(review.task.request,'תכין מודעה וטופס למשרה בעסק שלי');assert.equal(review.task.status,'WAITING_REVIEW');assert.equal(review.task.artifacts.length,2);assert.match(review.reply,/דרושים נציגי שירות בחיפה/);assert.equal(writes,0);
   assert.equal((await agent.current(b.id)),null);
   const stored=await agent.current(a.id);assert.equal(stored.state.steps.find(s=>s.id==='pages').result.access_token,undefined);
  });
  await t.test('bare yes does not approve a package and stale review cannot approve a newer revision',async()=>{
   const yes=await send('כן','turn-3');assert.equal(yes.task.status,'WAITING_REVIEW');assert.equal(writes,0);
   await assert.rejects(send('מאשר את החבילה','turn-stale',{taskRevision:review.task.revision}),/TASK_STALE/);
  });
  await t.test('package approval produces a separate exact Meta proposal, never an automatic write',async()=>{
   pending=await send('מאשר את החבילה','turn-4');assert.equal(pending.task.status,'WAITING_APPROVAL');assert.equal(writes,0);assert.match(pending.reply,/שדות ושאלות/);
   assert.equal(JSON.stringify(pending.task).includes('codeCiphertext'),false);assert.equal(pending.task.externalActionsExecuted,false);const saved=(await h.db.query('SELECT result FROM agent_task_turns WHERE client_id=$1 AND request_id=$2',[a.id,'turn-4'])).rows[0].result;assert.equal(saved.reply,undefined);assert.equal(typeof saved.replyCiphertext,'string');assert.deepEqual(await send('מאשר את החבילה','turn-4'),pending);
   const no=await send('כן','turn-5');assert.equal(no.task.status,'WAITING_APPROVAL');assert.equal(writes,0);
  });
  await t.test('exact approval executes once, reconciles verified IDs and continues to completion',async()=>{
   const code=pending.reply.match(/אשר (\d{6})/)[1];
   const done=await send('אשר '+code,'turn-6');assert.equal(done.task.status,'COMPLETE',JSON.stringify(done));assert.equal(done.task.externalActionsExecuted,true);assert.equal(done.task.steps.at(-1).verified,true);assert.equal(writes,1);
   assert.deepEqual(await send('אשר '+code,'turn-6'),done);assert.equal(writes,1);
   const row=await agent.current(a.id);assert.equal(row.state.steps.at(-1).result.id,'777');
  });
  await t.test('cancelling a task blocks an already-consumed approval before any external write',async()=>{
   await send('תכין שוב מודעה וטופס','cancel-1');await send('נציגי שירות בחיפה','cancel-2');
   const pendingCancel=await send('מאשר את החבילה','cancel-3'),code=pendingCancel.reply.match(/אשר (\d{6})/)[1];
   const consumed=await require('../approvalEngine').consumeApprovalForClient(a.id,code);assert.equal(consumed.ok,true);
   await agent.cancel(a.id);const before=writes;
   const result=await meta.context.run(String(a.id),()=>require('../actionExecutor').executeApprovedForClient(a.id,consumed.approval.actionPlan));
   assert.equal(result.ok,false);assert.equal(writes,before);assert.equal((await agent.current(a.id)).status,'CANCELLED');
  });
 }finally{axios.get=get;axios.post=post;await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});

test('task safety: no invented facts, no unsupported tools, no false completion and no replay of uncertain side effects',async t=>{
 const env={...process.env},h=await openDatabase();process.env.TASK_AGENT_ENABLED='true';
 let count=0;
 async function attempt(next,steps,message='תכין משהו',opts={}){
  const c=(await h.db.query('INSERT INTO clients(phone) VALUES($1) RETURNING *',['972500044'+String(++count).padStart(3,'0')])).rows[0];
  return meta.context.run(String(c.id),async()=>{const response=await agent.send(c.id,{message,requestId:'request',channel:'WHATSAPP'},{planner:async()=>({plan:steps,next}),...opts});return{response,client:c,stored:await agent.current(c.id)};});
 }
 try{
  await t.test('ungrounded model fact cannot be saved',async()=>{
   const r=await attempt({op:'collect',stepId:'input',facts:[{key:'salary',value:'30000',evidence:'30000'}]},[{id:'input',kind:'collect',label:'תנאים',dependsOn:[]}]);
   assert.equal(r.response.task.status,'ERROR');assert.equal(r.stored.state.facts.salary,undefined);
  });
  await t.test('planner cannot call arbitrary Graph paths or executors',async()=>{
   const r=await attempt({op:'read',stepId:'read',tool:'executeApprovedAction',args:{}},[{id:'read',kind:'read',label:'קריאה',dependsOn:[]}]);assert.equal(r.response.task.status,'ERROR');
  });
  await t.test('finish cannot hide an uncompleted step',async()=>{
   const r=await attempt({op:'finish'},[{id:'draft',kind:'draft',label:'מודעה',dependsOn:[]}]);assert.equal(r.response.task.status,'ERROR');assert.notEqual(r.response.task.status,'COMPLETE');
  });
  await t.test('a concurrent user turn cannot run a second copy',async()=>{
   let release,entered;const started=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
   const c=(await h.db.query('INSERT INTO clients(phone) VALUES($1) RETURNING *',['972500044099'])).rows[0];
   const first=meta.context.run(String(c.id),()=>agent.send(c.id,{message:'תכין מודעה',requestId:'one',channel:'WHATSAPP'},{planner:async()=>{entered();await gate;return{plan:[{id:'i',kind:'collect',label:'פרט',dependsOn:[]}],next:{op:'ask',stepId:'i',question:'מה המוצר?'}};}}));
   await started;const second=await meta.context.run(String(c.id),()=>agent.send(c.id,{message:'תכין מודעה',requestId:'two',channel:'WHATSAPP'}));assert.equal(second.busy,true);release();await first;
  });
  await t.test('expired lease with an uncertain image is put into review instead of being re-executed',async()=>{
   const r=await attempt({op:'ask',stepId:'i',question:'מה המוצר?'},[{id:'i',kind:'collect',label:'פרט',dependsOn:[]}]);
   r.stored.state.steps=[{id:'image',kind:'image',label:'תמונה',dependsOn:[],status:'RUNNING'}];
   await h.db.query("UPDATE agent_tasks SET state=$2::jsonb,lease_token=$3,lease_until=NOW()-INTERVAL '1 second' WHERE id=$1",[r.stored.id,JSON.stringify(r.stored.state),crypto.randomUUID()]);
   let planned=false;const result=await meta.context.run(String(r.client.id),()=>agent.send(r.client.id,{message:'המשך',requestId:'resume',channel:'WHATSAPP'},{planner:async()=>{planned=true;throw Error('Must not retry');}}));assert.equal(result.task.status,'MANUAL_REVIEW');assert.equal(planned,false);
  });
  await t.test('human handover interrupts planning without generating an automatic follow-up',async()=>{
   const c=(await h.db.query('INSERT INTO clients(phone) VALUES($1) RETURNING *',['972500044098'])).rows[0];
   const response=await meta.context.run(String(c.id),()=>agent.send(c.id,{message:'תכין מודעה',requestId:'pause-human',channel:'WHATSAPP'},{planner:async()=>{
    await require('../humanSupport').request(c.id,{reason:'נציג אנושי',eventId:'human-during-plan'});
    return{plan:[{id:'d',label:'מודעה',kind:'draft',dependsOn:[]}],next:{op:'draft',stepId:'d',title:'טיוטה',content:'תוכן לבדיקה'}};
   }}));
   assert.match(response.reply,/הושהתה/);assert.equal((await agent.current(c.id)).status,'HUMAN_PAUSED');assert.equal((await agent.current(c.id)).lease_token,null);
  });
  await t.test('an image from another tenant cannot be used as a task reference',async()=>{
   const other=(await h.db.query('INSERT INTO clients(phone) VALUES($1) RETURNING *',['972500044097'])).rows[0],media=crypto.randomUUID();
   await h.db.query("INSERT INTO tenant_media(id,client_id,whatsapp_media_id,media_type,mime_type,expires_at) VALUES($1,$2,'fixture','image','image/png',NOW()+INTERVAL '1 day')",[media,other.id]);
   let generated=false;const r=await attempt({op:'image',stepId:'image',prompt:'תמונה לעסק',referenceMediaId:media},[{id:'image',label:'תמונה',kind:'image',dependsOn:[]}],'תכין תמונה',{imageOptions:{generateImage:async()=>{generated=true;throw Error('Unexpected generation');}}});
   assert.equal(r.response.task.status,'ERROR');assert.equal(generated,false);
  });
  await t.test('image generation returns a real tenant media reference and waits for package review',async()=>{
   process.env.GRAPHICS_ENABLED='true';process.env.OBJECT_STORAGE_ENABLED='false';
   const c=(await h.db.query('INSERT INTO clients(phone) VALUES($1) RETURNING *',['972500044096'])).rows[0];let generated=0,notice='';
   const options={onProgress:async text=>{notice=text;},planner:async context=>!context.plan.length?{plan:[{id:'image',kind:'image',label:'עיצוב לעסק',dependsOn:[]}],next:{op:'image',stepId:'image',prompt:'תמונת מוצר נקייה לעסק'}}:context.plan[0].status==='PREPARED'?{next:{op:'review'}}:{next:{op:'finish'}},imageOptions:{generateImage:async()=>{generated++;return{buffer:Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(32)]),mimeType:'image/png'};},uploadImage:async()=>'456'}};
   const result=await meta.context.run(String(c.id),()=>agent.send(c.id,{message:'תכין תמונה לעסק',requestId:'image-1',channel:'WHATSAPP'},options));
   assert.equal(result.task.status,'WAITING_REVIEW');assert.equal(generated,1);assert.equal(result.mediaIds.length,1);assert.equal(result.task.steps[0].status,'PREPARED');assert.doesNotMatch(notice,/קמפיין/);
   const media=await require('../mediaStore').loadMedia(c.id,result.mediaIds[0]);assert.equal(media.whatsapp_media_id,'456');
   const approved=await meta.context.run(String(c.id),()=>agent.send(c.id,{message:'מאשר את החבילה',requestId:'image-2',channel:'WHATSAPP'},options));assert.equal(approved.task.status,'COMPLETE');assert.equal(generated,1);
   process.env.GRAPHICS_ENABLED='false';
  });
  await t.test('cancellation invalidates the lease; deleting a tenant removes task memory',async()=>{
   const r=await attempt({op:'ask',stepId:'i',question:'מה המוצר?'},[{id:'i',kind:'collect',label:'פרט',dependsOn:[]}]);
   await agent.cancel(r.client.id);assert.equal((await agent.current(r.client.id)).status,'CANCELLED');
   await h.db.query('DELETE FROM clients WHERE id=$1',[r.client.id]);assert.equal(await agent.current(r.client.id),null);assert.equal((await h.db.query('SELECT request_id FROM agent_task_turns WHERE client_id=$1',[r.client.id])).rows.length,0);
  });
 }finally{await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
