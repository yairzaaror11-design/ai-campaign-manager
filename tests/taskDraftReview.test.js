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
   if(c.plan[0].artifact.formDraft)return{next:{op:'review'}};
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
 }finally{if(client)await h.db.query('DELETE FROM clients WHERE id=$1',[client.id]);await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
