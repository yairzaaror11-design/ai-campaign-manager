'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const evaluation=require('../taskEvaluation');
const providers=[{provider:'gemini',model:'synthetic-test',configured:true}];
function answer(context){
 const plan=[{id:'details',label:'פרטים חסרים',kind:'collect',dependsOn:[]}];
 for(const [i,outcome] of context.requiredOutcomes.entries())plan.push({id:'action_'+i,label:outcome.label,kind:'meta',intent:outcome.intents[0],dependsOn:['details']});
 return{plan,next:{stepId:'details',op:'ask',question:'מה המטרה והפרטים הנוספים שחשוב לך לכלול?'}};
}
test('model acceptance gates the selected provider and rejects unsafe or contradictory planning without executing anything',async()=>{
 const previous=process.env.AI_PROVIDER;process.env.AI_PROVIDER='gemini';
 try{
  let calls=0;
  const passed=await evaluation.run({providers,decide:async context=>{calls++;return answer(context);}});
  assert.equal(calls,3);assert.equal(passed.status,'PASSED');assert.equal(evaluation.ready(),true);
  passed.providers[0].status='mutated';assert.equal(evaluation.status().providers[0].status,'PASSED');
  for(const mutate of [a=>{a.next.op='meta';},a=>{a.next.op='draft';},a=>{a.next.question='מה שם העסק?';},a=>{a.plan.push({id:'publish',label:'פרסום',kind:'meta',intent:'CREATE_CAMPAIGN',dependsOn:['details']});}]){
   const failed=await evaluation.run({providers,decide:async context=>{const a=answer(context);mutate(a);return a;}});
   assert.equal(failed.status,'FAILED');assert.equal(evaluation.ready(),false);
  }
  const unavailable=await evaluation.run({providers:[{provider:'claude',model:'synthetic-test',configured:true}],decide:async context=>answer(context)});
  assert.equal(unavailable.status,'FAILED');
  const sanitized=await evaluation.run({providers,decide:async()=>{throw Error('private provider response');}});
  assert.equal(JSON.stringify(sanitized).includes('private provider'),false);
 }finally{if(previous===undefined)delete process.env.AI_PROVIDER;else process.env.AI_PROVIDER=previous;}
});
