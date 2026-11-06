'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('an existing ad-only recruitment review cannot authorize Meta until its concrete form draft has been reviewed',async()=>{
 const env={...process.env},h=await require('./helpers/isolatedDatabase').openDatabase();let client;
 Object.assign(process.env,{TASK_AGENT_ENABLED:'true',READ_ONLY:'true',META_WRITES_ENABLED:'false'});
 const review=require('../taskDraftReview'),agent=require('../taskAgent'),meta=require('../metaConnection');
 try{
  assert.throws(()=>review.formDraft({title:'טופס',questions:['שם'],approved:true}),/INVALID_FORM_DRAFT/);
  assert.equal(review.hasForm({content:'אכין טופס בהמשך'}),false);
  client=await require('../clientStore').getOrCreateClient('972500077903');
  const request='תכין לי קמפיין דרושים עם מודעה וטופס מועמדות, בלי לפרסם';
  const plan=agent.validatePlan([{id:'copy',kind:'draft',label:'מודעה וטופס',dependsOn:[]},{id:'form',kind:'meta',intent:'CREATE_LEAD_FORM',label:'טופס ב־Meta',dependsOn:['copy']},{id:'campaign',kind:'meta',intent:'CREATE_BUNDLE',label:'קמפיין מושהה',dependsOn:['form']}],request);
  const crypto=require('node:crypto'),id=crypto.randomUUID(),oldHash='old-copy-hash';
  plan[0].status='PREPARED';plan[0].artifact={title:'מודעה',content:'החברה מתרחבת, ניסיון B2B יתרון',hash:oldHash,reviewed:false};
  await h.db.query("INSERT INTO agent_tasks(id,client_id,request,status,state) VALUES($1,$2,$3,'WAITING_REVIEW',$4::jsonb)",[id,client.id,request,JSON.stringify({steps:plan,facts:{role:{value:'איש מכירות',evidence:'גיוס איש מכירות בכל הארץ'}},messages:[{role:'user',content:request},{role:'user',content:'גיוס איש מכירות בכל הארץ'}],reviewHash:'obsolete'})]);
  const formDraft={title:'טופס מועמדות — איש מכירות',questions:['שם מלא','טלפון ליצירת קשר','מה הניסיון הרלוונטי שלך במכירות?']};let corrections=0;
  const planner=async c=>{
   assert.equal(c.planningPhase,'CONTINUE_EXISTING_PLAN');assert.deepEqual(c.plan.map(s=>s.id),['copy','form','campaign']);
   if(c.plan[0].artifact.formDraft)throw Error('READY_PACKAGE_MUST_NOT_CALL_MODEL');
   assert.equal(c.plannerFeedback.code,'TASK_FORM_DRAFT_REQUIRED');corrections++;
   if(corrections===1)return{next:{op:'review'}}; // Must not expose another incomplete package.
   return{next:{op:'draft',stepId:'copy',title:'דרוש איש מכירות',content:'מגייסים איש מכירות בכל הארץ. להגשת מועמדות השאירו פרטים בטופס.',formDraft}};
  };
  const send=(message,requestId)=>meta.context.run(String(client.id),()=>agent.send(client.id,{message,requestId,channel:'WHATSAPP'},{planner}));
  const repaired=await send('מאשר את החבילה','repair-old-review');
  assert.equal(repaired.task.status,'WAITING_REVIEW');assert.equal(corrections,2);assert.match(repaired.reply,/טיוטת טופס, טרם נוצר/);assert.match(repaired.reply,/מה הניסיון הרלוונטי/);assert.doesNotMatch(repaired.reply,/מתרחבת|B2B/);
  const stored=await agent.current(client.id);assert.deepEqual(stored.state.steps[0].artifact.formDraft,formDraft);assert.notEqual(stored.state.steps[0].artifact.hash,oldHash);assert.equal(stored.state.steps[0].artifact.reviewed,false);assert.equal(stored.state.steps[1].status,'PENDING');
  assert.deepEqual(await send('מאשר את החבילה','repair-old-review'),repaired);
  assert.equal((await h.db.query('SELECT id FROM action_plans WHERE client_id=$1',[client.id])).rows.length,0);
  assert.equal((await h.db.query('SELECT action_id FROM meta_execution_attempts WHERE client_id=$1',[client.id])).rows.length,0);
  // Reproduce the live stranded package: already prepared, stale missing-form
  // marker, no external attempt, and the old per-turn loop-limit status.
  const stranded=await agent.current(client.id);stranded.state.reviewIssue='TASK_FORM_DRAFT_REQUIRED';stranded.state.plannerCalls=22;stranded.state.reason='נדרשת חלוקה של המשימה לשלבים נוספים לפני המשך בטוח';delete stranded.state.reviewHash;
  await h.db.query("UPDATE agent_tasks SET status='BLOCKED',state=$2::jsonb WHERE id=$1",[id,JSON.stringify(stranded.state)]);
  const resumed=await send('המשך במשימה','resume-stranded');assert.equal(resumed.task.status,'WAITING_REVIEW');assert.equal(corrections,2);assert.match(resumed.reply,/טיוטת טופס, טרם נוצר/);
  const recovered=await agent.current(client.id);assert.equal(recovered.state.reviewIssue,undefined);assert.equal(recovered.state.reason,undefined);assert.equal(recovered.state.plannerCalls,22);assert.equal(recovered.state.steps[0].artifact.reviewed,false);assert.equal(recovered.state.steps[1].status,'PENDING');
  assert.deepEqual(await send('המשך במשימה','resume-stranded'),resumed);
  assert.equal((await h.db.query('SELECT id FROM action_plans WHERE client_id=$1',[client.id])).rows.length,0);
  // A stored package can be displayed even if an unrelated model probe fails.
  // Approval and fresh planning must still be deferred while that gate is down.
  const evaluation=require('../taskEvaluation'),oldReady=evaluation.ready,oldWait=evaluation.waitUntilReady;
  Object.assign(process.env,{UNIFIED_CONVERSATION_ENABLED:'true',TASK_AGENT_REQUIRE_EVAL:'true',TASK_AGENT_PILOT_ONLY:'true',AUTHORIZED_PHONE_NUMBERS:'972500077903'});
  let waits=0;evaluation.ready=()=>false;evaluation.waitUntilReady=async()=>{waits++;return false;};
  try{
   await h.db.query("UPDATE agent_tasks SET status='WAITING_MODEL' WHERE id=$1",[id]);
   const controller=require('../conversationController');
   const incoming=(message,requestId)=>meta.context.run(String(client.id),()=>controller.handle(client.id,{message,requestId,channel:'WHATSAPP'},{planner:async()=>{throw Error('NO_MODEL_FOR_STORED_REVIEW');}}));
   const displayed=await incoming('המשך במשימה','view-during-outage');assert.equal(displayed.task.status,'WAITING_REVIEW');assert.equal(waits,0);assert.match(displayed.reply,/טיוטת טופס/);
   assert.equal((await agent.current(client.id)).state.steps[0].artifact.reviewed,false);
   const withheld=await incoming('מאשר את החבילה','approval-during-outage');assert.equal(withheld.task.status,'WAITING_MODEL');assert.equal(waits,1);assert.equal((await agent.current(client.id)).state.steps[0].artifact.reviewed,false);
   assert.equal((await h.db.query('SELECT id FROM action_plans WHERE client_id=$1',[client.id])).rows.length,0);
  }finally{evaluation.ready=oldReady;evaluation.waitUntilReady=oldWait;}

 }finally{if(client)await h.db.query('DELETE FROM clients WHERE id=$1',[client.id]);await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
