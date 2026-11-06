'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const evaluation=require('../taskEvaluation');
const route=async c=>{const p=require('../conversationRouter').PROBES.find(p=>p.message===c.message);return{kind:p.allowed[0],...(p.needsPending?{usePending:true}:{}),...(p.allowed[0]==='ANSWER'?{reply:'מיקומים הם המקומות שבהם המודעה מוצגת.'}:{})};};
const providers=[{provider:'gemini',model:'synthetic-test',configured:true}];
test('semantic routing probes are mandatory acceptance cases and a bad route closes the gate',async()=>{
 const env=process.env.AI_PROVIDER;process.env.AI_PROVIDER='gemini';
 try{
  const ok=await evaluation.run({providers,route,decide:async c=>answer(c)});assert.equal(ok.status,'PASSED');assert.ok(ok.providers[0].cases.some(c=>c.id==='semantic_discovery'&&c.result==='PASSED'));
  const bad=await evaluation.run({providers,route:async()=>({kind:'START'}),decide:async c=>answer(c)});assert.equal(bad.status,'FAILED');assert.equal(evaluation.ready(),false);assert.equal(bad.providers[0].cases.find(c=>c.id==='semantic_discovery').reason,'ROUTING_INTENT_MISMATCH');
 }finally{if(env===undefined)delete process.env.AI_PROVIDER;else process.env.AI_PROVIDER=env;}
});
function answer(context){
 if(context.plan.some(s=>s.id==='recruitment_copy'))return{next:{op:'draft',stepId:'recruitment_copy',title:'דרוש איש מכירות',content:'מגייסים איש מכירות בכל הארץ. להגשת מועמדות השאירו פרטים בטופס.',campaignDraft:{objective:'לידים למועמדים',audience:'מועמדים לתפקיד שנמסר',geography:'בכל הארץ',placements:'הצעת מיקומים אוטומטיים לבדיקה',budgetNote:'לא נקבע; נדרש אישור נפרד',scheduleNote:'לא נקבע',headline:'דרוש איש מכירות',cta:'להגשת מועמדות',designBrief:'עיצוב נקי בעברית, ללא המצאת לוגו'},formDraft:{title:'טופס מועמדות',questions:['שם מלא','טלפון','מה הניסיון הרלוונטי שלך במכירות?']}}};
 if(context.plan.some(s=>s.id==='economics'))return{next:{op:'read',stepId:'economics',tool:'analyze_business_case',args:{operation:'scaling',fields:Object.entries({oldAdSpend:'3000',newAdSpend:'6000',oldNewCustomers:'5',newNewCustomers:'8',expectedIncomePerCustomer:'687.50'}).map(([key,value])=>({key,value,evidence:context.request})),currency:{value:'ILS',evidence:'₪'}}}};
 if(context.plan.length)return{next:{op:'draft',stepId:'copy',title:'קפה טרי ליד הבית',content:'ארוחת בוקר ב-45 ₪. לפרטים כתבו לנו.'}};
 const plan=[{id:'details',label:'פרטים חסרים',kind:'collect',dependsOn:[]}];
 if(require('../campaignPackage').required(context.request))plan.push({id:'package',label:'חבילת קמפיין',kind:'draft',dependsOn:['details']});
 for(const [i,outcome] of context.requiredOutcomes.entries())plan.push({id:'action_'+i,label:outcome.label,kind:'meta',intent:outcome.intents[0],dependsOn:['details']});
 return{plan,next:{stepId:'details',op:'ask',question:'מה המטרה והפרטים הנוספים שחשוב לך לכלול?'}};
}
test('model acceptance gates the selected provider and rejects unsafe or contradictory planning without executing anything',async()=>{
 const previous=process.env.AI_PROVIDER;process.env.AI_PROVIDER='gemini';
 try{
  let calls=0;
  const passed=await evaluation.run({providers,route,decide:async context=>{calls++;return answer(context);}});
  assert.equal(calls,evaluation.cases.length);assert.equal(passed.status,'PASSED');assert.equal(evaluation.ready(),true);
  passed.providers[0].status='mutated';assert.equal(evaluation.status().providers[0].status,'PASSED');
  for(const mutate of [a=>{a.next.op='meta';},a=>{a.next.op='draft';},a=>{a.next.question='מה שם העסק?';},a=>{(a.plan||(a.plan=[])).push({id:'publish',label:'פרסום',kind:'meta',intent:'CREATE_CAMPAIGN',dependsOn:['details']});}]){
   const failed=await evaluation.run({providers,route,decide:async context=>{const a=answer(context);mutate(a);return a;}});
   assert.equal(failed.status,'FAILED');assert.equal(evaluation.ready(),false);
  }
  const unavailable=await evaluation.run({route,providers:[{provider:'claude',model:'synthetic-test',configured:true}],decide:async context=>answer(context)});
  assert.equal(unavailable.status,'FAILED');
  const sanitized=await evaluation.run({providers,route,decide:async()=>{throw Error('private provider response');}});
  assert.equal(JSON.stringify(sanitized).includes('private provider'),false);
 }finally{if(previous===undefined)delete process.env.AI_PROVIDER;else process.env.AI_PROVIDER=previous;}
});
test('cold-start callers share one evaluation and wait for success without bypassing the gate',async()=>{
 const previous=process.env.AI_PROVIDER;process.env.AI_PROVIDER='gemini';
 let release,calls=0;const gate=new Promise(resolve=>{release=resolve;});
 try{
  const pending=evaluation.run({providers,route,decide:async context=>{calls++;await gate;return answer(context);}});
  assert.equal(evaluation.ready(),false);assert.equal(evaluation.run(),pending);assert.equal(evaluation.ensure(),pending);
  assert.equal(await evaluation.waitUntilReady(1),false);assert.equal(calls,1);
  const waiting=evaluation.waitUntilReady(1000);release();assert.equal(await waiting,true);await pending;assert.equal(calls,evaluation.cases.length);
 }finally{release();if(previous===undefined)delete process.env.AI_PROVIDER;else process.env.AI_PROVIDER=previous;}
});
test('acceptance exercises the same bounded initial-plan correction and still requires every final case to pass',async()=>{
 const previous=process.env.AI_PROVIDER;process.env.AI_PROVIDER='gemini';let malformed=true,calls=0;
 try{
  const recovered=await evaluation.run({providers,route,decide:async context=>{calls++;if(malformed){malformed=false;return{next:{op:'ask',stepId:'details',question:'פרט חסר?'}};}return answer(context);}});
  assert.equal(recovered.status,'PASSED');assert.equal(calls,evaluation.cases.length+1);
  const failed=await evaluation.run({providers,route,decide:async context=>context.plan.length?answer(context):{next:{op:'finish'}}});assert.equal(failed.status,'FAILED');assert.equal(evaluation.ready(),false);
 }finally{if(previous===undefined)delete process.env.AI_PROVIDER;else process.env.AI_PROVIDER=previous;}
});
test('campaign contract correction is model-only and bounded; missing settings never pass acceptance',async()=>{
 const previous=process.env.AI_PROVIDER;process.env.AI_PROVIDER='gemini';let calls=0,first=true;
 try{
  const passed=await evaluation.run({providers,route,decide:async context=>{calls++;const a=answer(context);if(context.plan.some(s=>s.id==='recruitment_copy')&&first){first=false;delete a.next.campaignDraft;}return a;}});
  assert.equal(passed.status,'PASSED');assert.equal(calls,evaluation.cases.length+1);
  const failed=await evaluation.run({providers,route,decide:async context=>{const a=answer(context);if(context.plan.some(s=>s.id==='recruitment_copy'))delete a.next.campaignDraft;return a;}});
  assert.equal(failed.status,'FAILED');assert.equal(evaluation.ready(),false);
  const item=failed.providers[0].cases.find(c=>c.id==='recruitment_grounded_package');assert.equal(item.reason,'INVALID_CAMPAIGN_DRAFT');assert.equal(item.contractIssue.missing,true);
 }finally{if(previous===undefined)delete process.env.AI_PROVIDER;else process.env.AI_PROVIDER=previous;}
});
