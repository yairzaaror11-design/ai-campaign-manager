'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {openDatabase}=require('./helpers/database'),agent=require('../taskAgent'),meta=require('../metaConnection');
test('the apartment answer after a new-goal question requires its first plan and repairs one malformed model response before drafting',async()=>{
 const env={...process.env},h=await openDatabase();
 Object.assign(process.env,{TASK_AGENT_ENABLED:'true'});
 const c=(await h.db.query("INSERT INTO clients(phone) VALUES('972500066121') RETURNING *")).rows[0];
 const request='דירת 2 חדרים למכירה באילת במיליון שקל',contexts=[];
 const plan=[{id:'details',label:'פרטי הנכס',kind:'collect',dependsOn:[]},{id:'copy',label:'טיוטת מודעה',kind:'draft',dependsOn:['details']}];
 const planner=async context=>{
  contexts.push(context);
  if(context.planningPhase==='INITIAL_PLAN_REQUIRED'){
   if(!context.plannerFeedback)return{next:{op:'ask',stepId:'details',question:'יש תמונות של הדירה?'}};
   assert.equal(context.plannerFeedback.code,'INVALID_TASK_PLAN');
   return{plan,next:{op:'collect',stepId:'details',facts:[{key:'rooms',value:'2',evidence:request},{key:'location',value:'אילת',evidence:request},{key:'price',value:'מיליון שקל',evidence:request}]}};
  }
  assert.equal(context.plannerFeedback,undefined);
  return{next:context.plan[1].status==='PENDING'?{op:'draft',stepId:'copy',title:'דירת 2 חדרים למכירה באילת',content:'למכירה באילת: דירת 2 חדרים במחיר מיליון שקל. לפרטים נוספים ולתיאום ביקור צרו קשר.'}:{op:'review'}};
 };
 const send=(message,requestId,options={})=>meta.context.run(String(c.id),()=>agent.send(c.id,{message,requestId,channel:'WHATSAPP'},{planner,...options}));
 try{
  const first=await send('אני רוצה לשווק משהו אחר','new-goal',{deferPlanning:true});assert.equal(first.task.status,'WAITING_INPUT');assert.equal(contexts.length,0);
  const result=await send(request,'details');assert.equal(result.task.id,first.task.id);assert.equal(result.task.status,'WAITING_REVIEW');assert.match(result.reply,/דירת 2 חדרים/);assert.match(result.reply,/מיליון שקל/);assert.doesNotMatch(result.reply,/אלמוג|7%|התקדמות נשמרה/);
  assert.equal(contexts[0].messages.length,2);assert.equal(contexts[0].planningPhase,'INITIAL_PLAN_REQUIRED');assert.equal(contexts[1].planningPhase,'INITIAL_PLAN_REQUIRED');assert.equal(contexts[2].planningPhase,'CONTINUE_EXISTING_PLAN');
  const stored=await agent.current(c.id);assert.equal(stored.request,request);assert.equal(stored.state.lastError,undefined);assert.equal(stored.state.plannerCalls,4);
  const count=contexts.length;assert.deepEqual(await send(request,'details'),result);assert.equal(contexts.length,count);
  await agent.cancel(c.id);
  let failedCalls=0;const fail=await send(request,'bad-plan',{planner:async()=>{failedCalls++;return{plan:[{id:'bad',label:'unsupported',kind:'shell',dependsOn:[]}],next:{op:'finish'}};}});
  assert.equal(failedCalls,2);assert.equal(fail.task.status,'ERROR');assert.equal((await agent.current(c.id)).state.steps.length,0);
  assert.equal((await h.db.query('SELECT count(*)::int AS n FROM action_plans')).rows[0].n,0);assert.equal((await h.db.query('SELECT count(*)::int AS n FROM meta_execution_attempts')).rows[0].n,0);
 }finally{await h.close();for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);}
});
