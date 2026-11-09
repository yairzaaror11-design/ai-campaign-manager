'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {openDatabase}=require('./helpers/database');
const agent=require('../taskAgent'),meta=require('../metaConnection');

test('an inexact price quote gets one correction before the ad draft is prepared',async()=>{
 const env={...process.env},h=await openDatabase();
 try{
  process.env.TASK_AGENT_ENABLED='true';
  const client=(await h.db.query("INSERT INTO clients(phone) VALUES('972500066141') RETURNING *")).rows[0];
  const request='תיצור לי פרסומת להדפסת חולצות לאירועים ולעסקים החל מ30  שקל';
  const offer='החל מ30  שקל';
  let calls=0;
  const planner=async context=>{
   calls++;
   if(calls===1)return {
    plan:[{id:'facts',kind:'collect',label:'פרטים',dependsOn:[]},{id:'ad',kind:'draft',label:'מודעה',dependsOn:['facts']}],
    next:{op:'collect',stepId:'facts',facts:[{key:'price',value:'החל מ-30 שקל',evidence:'החל מ-30 שקל'}]}
   };
   if(calls===2){
    assert.equal(context.plannerFeedback.code,'UNGROUNDED_TASK_FACT');
    assert.deepEqual(context.facts,{});
    return{next:{op:'collect',stepId:'facts',facts:[{key:'price',value:offer,evidence:offer}]}};
   }
   assert.deepEqual(context.facts.price,{value:offer,evidence:offer});
   return{next:{op:'draft',stepId:'ad',title:'הדפסת חולצות',content:'הדפסת חולצות לאירועים ולעסקים החל מ־30 שקל. לפרטים ולהזמנות דברו איתנו.'}};
  };
  const result=await meta.context.run(String(client.id),()=>agent.send(client.id,{message:request,requestId:'shirt-price',channel:'WHATSAPP'},{planner}));
  assert.equal(result.task.status,'WAITING_REVIEW');
  assert.match(result.reply,/החל מ־30 שקל/);
  assert.equal(calls,3);
  assert.equal(result.externalActionsExecuted,false);
 }finally{
  await h.close();
  for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];
  Object.assign(process.env,env);
 }
});
