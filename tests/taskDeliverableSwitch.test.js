'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('a standalone recruitment request replaces the old property plan and repairs a rejected next step without external effects',async()=>{
 const env={...process.env},h=await require('./helpers/isolatedDatabase').openDatabase();
 Object.assign(process.env,{TASK_AGENT_ENABLED:'true',READ_ONLY:'true',META_WRITES_ENABLED:'false'});
 const agent=require('../taskAgent'),meta=require('../metaConnection');let client;
 try{
  client=await require('../clientStore').getOrCreateClient('972500077891');
  const send=(message,requestId,planner)=>meta.context.run(String(client.id),()=>agent.send(client.id,{message,requestId,channel:'WHATSAPP'},{planner}));
  const oldPlan=[{id:'property_copy',kind:'draft',label:'מודעת דירה',dependsOn:[]}];
  const oldPlanner=async c=>({...(c.plan.length?{}:{plan:oldPlan}),next:c.plan[0]?.status==='PREPARED'?{op:'review'}:{op:'draft',stepId:'property_copy',title:'דירה באילת',content:'דירת 2 חדרים למכירה באילת במיליון שקל'}});
  const old=await send('דירת 2 חדרים למכירה באילת במיליון שקל','property',oldPlanner);assert.equal(old.task.status,'WAITING_REVIEW');
  const request='תכין לי קמפיין דרושים עם מודעה וטופס מועמדות, בלי לפרסם';
  const plan=[{id:'role',kind:'collect',label:'פרטי המשרה',dependsOn:[]},{id:'recruitment_copy',kind:'draft',label:'מודעת דרושים',dependsOn:['role']},{id:'form',kind:'meta',intent:'CREATE_LEAD_FORM',label:'טופס מועמדות',dependsOn:['recruitment_copy']},{id:'campaign',kind:'meta',intent:'CREATE_BUNDLE',label:'קמפיין מושהה',dependsOn:['form']}];
  let contexts=[],failOnce=true;
  const planner=async c=>{
   contexts.push(c);assert.equal(c.request,request);assert.doesNotMatch(JSON.stringify(c.messages),/דירה באילת|מיליון שקל/);
   if(!c.plan.length)return{plan,next:{op:'ask',stepId:'role',question:'לאיזו משרה ובאיזה אזור מגייסים?'}};
   if(failOnce){failOnce=false;return{next:{op:'draft',stepId:'property_copy',title:'wrong',content:'must not run'}};}
   if(c.plannerFeedback){assert.equal(c.plannerFeedback.code,'TASK_STEP_NOT_READY');return{next:{op:'collect',stepId:'role',facts:[{key:'role',value:'מעצב גרפי',evidence:'מעצב גרפי בתל אביב'}]}};}
   return{next:c.plan[1].status==='PREPARED'?{op:'review'}:{op:'draft',stepId:'recruitment_copy',title:'דרוש מעצב גרפי',content:'דרוש מעצב גרפי בתל אביב. לשליחת מועמדות השאירו פרטים.',formDraft:{title:'טופס מועמדות',questions:['שם מלא','טלפון ליצירת קשר','מה הניסיון הרלוונטי שלך בעיצוב?']}}};
  };
  const start=await send(request,'recruitment',planner);assert.notEqual(start.task.id,old.task.id);assert.equal(start.task.request,request);assert.match(start.reply,/לאיזו משרה/);
  assert.equal((await h.db.query('SELECT status FROM agent_tasks WHERE id=$1',[old.task.id])).rows[0].status,'CANCELLED');
  assert.deepEqual(await send(request,'recruitment',planner),start);
  const prepared=await send('מעצב גרפי בתל אביב','role',planner);assert.equal(prepared.task.id,start.task.id);assert.equal(prepared.task.status,'WAITING_REVIEW');assert.match(prepared.reply,/מעצב גרפי/);assert.doesNotMatch(prepared.reply,/wrong|דירה|התקדמות נשמרה/);
  const stored=await agent.current(client.id);assert.equal(stored.state.lastError,undefined);assert.equal(stored.state.steps.some(s=>s.id==='property_copy'),false);
  assert.equal((await h.db.query('SELECT id FROM action_plans WHERE client_id=$1',[client.id])).rows.length,0);
  // An invalid decision is corrected once; persistent invalid output fails closed.
  let failedCalls=0;
  const failed=await send('תעדכן את הנוסח','invalid-next',async()=>{failedCalls++;return{next:{op:'meta',stepId:'missing',proposal:{}}};});
  assert.equal(failedCalls,2);assert.equal(failed.task.status,'ERROR');
  await h.db.query("UPDATE agent_tasks SET status='MANUAL_REVIEW' WHERE id=$1",[stored.id]);
  const blocked=await send('תכין לי קמפיין לדירה באילת','uncertain-new',async()=>{throw Error('MUST_NOT_PLAN');});assert.equal(blocked.task.id,stored.id);assert.match(blocked.reply,/לברר את תוצאת הפעולה/);
 }finally{
  if(client)await h.db.query('DELETE FROM clients WHERE id=$1',[client.id]);await h.close();
  for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);
 }
});
