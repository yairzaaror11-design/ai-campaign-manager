'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const evaluation=require('../taskEvaluation');
const providers=[{provider:'gemini',model:'synthetic-test',configured:true}];
function answer(context){
 if(context.plan.some(s=>s.id==='economics'))return{next:{op:'read',stepId:'economics',tool:'analyze_business_case',args:{operation:'scaling',fields:Object.entries({oldAdSpend:'3000',newAdSpend:'6000',oldNewCustomers:'5',newNewCustomers:'8',expectedIncomePerCustomer:'687.50'}).map(([key,value])=>({key,value,evidence:context.request})),currency:{value:'ILS',evidence:'₪'}}}};
 if(context.plan.length)return{next:{op:'draft',stepId:'copy',title:'קפה טרי ליד הבית',content:'ארוחת בוקר ב-45 ₪. לפרטים כתבו לנו.'}};
 const plan=[{id:'details',label:'פרטים חסרים',kind:'collect',dependsOn:[]}];
 for(const [i,outcome] of context.requiredOutcomes.entries())plan.push({id:'action_'+i,label:outcome.label,kind:'meta',intent:outcome.intents[0],dependsOn:['details']});
 return{plan,next:{stepId:'details',op:'ask',question:'מה המטרה והפרטים הנוספים שחשוב לך לכלול?'}};
}
test('model acceptance gates the selected provider and rejects unsafe or contradictory planning without executing anything',async()=>{
 const previous=process.env.AI_PROVIDER;process.env.AI_PROVIDER='gemini';
 try{
  let calls=0;
  const passed=await evaluation.run({providers,decide:async context=>{calls++;return answer(context);}});
  assert.equal(calls,5);assert.equal(passed.status,'PASSED');assert.equal(evaluation.ready(),true);
  passed.providers[0].status='mutated';assert.equal(evaluation.status().providers[0].status,'PASSED');
  for(const mutate of [a=>{a.next.op='meta';},a=>{a.next.op='draft';},a=>{a.next.question='מה שם העסק?';},a=>{(a.plan||(a.plan=[])).push({id:'publish',label:'פרסום',kind:'meta',intent:'CREATE_CAMPAIGN',dependsOn:['details']});}]){
   const failed=await evaluation.run({providers,decide:async context=>{const a=answer(context);mutate(a);return a;}});
   assert.equal(failed.status,'FAILED');assert.equal(evaluation.ready(),false);
  }
  const unavailable=await evaluation.run({providers:[{provider:'claude',model:'synthetic-test',configured:true}],decide:async context=>answer(context)});
  assert.equal(unavailable.status,'FAILED');
  const sanitized=await evaluation.run({providers,decide:async()=>{throw Error('private provider response');}});
  assert.equal(JSON.stringify(sanitized).includes('private provider'),false);
 }finally{if(previous===undefined)delete process.env.AI_PROVIDER;else process.env.AI_PROVIDER=previous;}
});
test('cold-start callers share one evaluation and wait for success without bypassing the gate',async()=>{
 const previous=process.env.AI_PROVIDER;process.env.AI_PROVIDER='gemini';
 let release,calls=0;const gate=new Promise(resolve=>{release=resolve;});
 try{
  const pending=evaluation.run({providers,decide:async context=>{calls++;await gate;return answer(context);}});
  assert.equal(evaluation.ready(),false);assert.equal(evaluation.run(),pending);assert.equal(evaluation.ensure(),pending);
  assert.equal(await evaluation.waitUntilReady(1),false);assert.equal(calls,1);
  const waiting=evaluation.waitUntilReady(1000);release();assert.equal(await waiting,true);await pending;assert.equal(calls,5);
 }finally{release();if(previous===undefined)delete process.env.AI_PROVIDER;else process.env.AI_PROVIDER=previous;}
});
