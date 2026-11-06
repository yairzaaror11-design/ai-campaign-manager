'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('real planner-to-Gemini transport requires an initial plan after clarification and limits continuation to existing step ids',async()=>{
 const configs=[],inputs=[];
 const plan=[{id:'details',label:'פרטי נכס',kind:'collect',dependsOn:[]}];
 const ai={chats:{create:config=>{configs.push(config);return{sendMessage:async({message})=>{
  const c=JSON.parse(message);inputs.push(c);
  return{text:JSON.stringify({...(!c.plan.length?{plan}:{}),next:{op:'ask',stepId:'details',question:'יש תמונות של הדירה?'}}),functionCalls:[]};
 }}}}};
 require('../aiService').registerProvider('structured_planner_fixture',(text,history,options)=>require('../gemini').processWithGemini(text,history,{...options,ai}));
 const context={request:'דירת 2 חדרים למכירה באילת במיליון שקל',plan:[],messages:[{role:'user',content:'אני רוצה לשווק משהו אחר'},{role:'user',content:'דירת 2 חדרים למכירה באילת במיליון שקל'}]};
 const first=await require('../taskPlanner').decide(context,{provider:'structured_planner_fixture'});assert.deepEqual(first.plan,plan);
 const initial=configs[0].config;assert.equal(initial.tools,undefined);assert.equal(initial.responseMimeType,'application/json');assert.deepEqual(initial.responseJsonSchema.required,['plan','next']);assert.deepEqual(initial.responseJsonSchema.properties.plan.items.required,['id','label','kind','dependsOn']);assert.equal(inputs[0].planningPhase,'INITIAL_PLAN_REQUIRED');
 await require('../taskPlanner').decide({...context,plan},{provider:'structured_planner_fixture'});
 const continuation=configs[1].config.responseJsonSchema;assert.deepEqual(continuation.required,['next']);assert.equal(continuation.properties.plan,undefined);assert.deepEqual(continuation.properties.next.properties.stepId.enum,['details']);assert.equal(inputs[1].planningPhase,'CONTINUE_EXISTING_PLAN');const fields=continuation.properties.next.properties.args.properties.fields.items.anyOf;assert.equal(fields[0].type,'string');assert.equal(fields[1].properties.value.type,'string');assert.deepEqual(fields[1].required,['key','value','evidence']);
});
test('provider-compatible package and numeric correction use direct required objects',()=>{
 const build=require('../taskPlanningSchema').responseSchema;
 const n=build({request:'תכין קמפיין דרושים עם מודעה וטופס',plan:[{id:'copy',kind:'draft',status:'PREPARED'}],plannerFeedback:{code:'INVALID_CAMPAIGN_DRAFT'}}).properties.next;
 assert.equal(n.anyOf,undefined);assert.deepEqual(n.properties.op.enum,['draft']);assert.ok(n.required.includes('campaignDraft'));assert.ok(n.required.includes('formDraft'));
 const r=build({request:'בדוק כדאיות',plan:[{id:'economics',kind:'read'}],plannerFeedback:{code:'INVALID_BUSINESS_FIELDS'}}).properties.next;
 assert.deepEqual(r.properties.tool.enum,['analyze_business_case']);assert.deepEqual(r.properties.args.required,['operation','fields']);assert.equal(r.properties.args.properties.fields.items.type,'object');
});
test('numeric formatting repair is bounded and never dispatches analysis',async()=>{
 let calls=0;let repeated=false;
 const request='3000 ₪ ו-5 לקוחות';
 require('../aiService').registerProvider('numeric_contract_fixture',async(text,history,options)=>{
  calls++;const input=JSON.parse(text);assert.equal(options.planningOnly,true);
  if(calls%2===1||repeated)return{text:JSON.stringify({next:{op:'read',stepId:'economics',tool:'analyze_business_case',args:{operation:'scaling',fields:{oldAdSpend:'3000'}}}}),actionPlans:[]};
  assert.equal(input.plannerFeedback.code,'INVALID_BUSINESS_FIELDS');
  return{text:JSON.stringify({next:{op:'read',stepId:'economics',tool:'analyze_business_case',args:{operation:'scaling',fields:[{key:'oldAdSpend',value:'3000',evidence:request}]}}}),actionPlans:[]};
 });
 const context={request,plan:[{id:'economics',kind:'read',status:'PENDING'}]};
 const result=await require('../taskPlanner').decide(context,{provider:'numeric_contract_fixture'});assert.equal(calls,2);assert.equal(result.next.args.fields[0].value,'3000');
 repeated=true;await assert.rejects(require('../taskPlanner').decide(context,{provider:'numeric_contract_fixture'}),/INVALID_BUSINESS_FIELDS/);assert.equal(calls,4);
});
test('numeric correction grammar excludes every unrelated optional campaign or write contract',()=>{
 const schema=require('../taskPlanningSchema').responseSchema({request:'בדוק כדאיות',plan:[{id:'economics',kind:'read',status:'PENDING'}],plannerFeedback:{code:'INVALID_BUSINESS_FIELDS'}});
 assert.deepEqual(Object.keys(schema.properties.next.properties),['op','stepId','tool','args']);
 assert.deepEqual(schema.properties.next.required,['op','stepId','tool','args']);assert.equal(schema.properties.next.properties.args.properties.fields.maxItems,16);
 assert.ok(require('../taskEvaluation').cases.some(c=>c.id==='professional_contract_correction'&&c.professional&&c.contractCorrection));
});
