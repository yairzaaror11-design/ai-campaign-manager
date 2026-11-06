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
 const continuation=configs[1].config.responseJsonSchema;assert.deepEqual(continuation.required,['next']);assert.equal(continuation.properties.plan,undefined);assert.deepEqual(continuation.properties.next.anyOf.find(s=>s.properties.op.enum[0]==='ask').properties.stepId.enum,['details']);assert.equal(inputs[1].planningPhase,'CONTINUE_EXISTING_PLAN');const read=continuation.properties.next.anyOf.find(s=>s.properties.op.enum[0]==='read');const numeric=read.anyOf[0].properties.args;assert.deepEqual(numeric.required,['operation','fields']);assert.equal(numeric.properties.fields.items.properties.value.type,'string');assert.deepEqual(numeric.properties.fields.items.required,['key','value','evidence']);assert.equal(read.properties.args.properties.fields.items.anyOf[0].type,'string');
});

test('complete operation alternatives require their own payload and package repair cannot skip to review',()=>{
 const schema=require('../taskPlanningSchema').responseSchema({request:'תכין קמפיין דרושים',plan:[{id:'copy',kind:'draft',status:'PREPARED'}],plannerFeedback:{code:'INVALID_CAMPAIGN_DRAFT'}});
 const branches=schema.properties.next.anyOf;assert.equal(branches.length,1);const draft=branches[0];assert.deepEqual(draft.properties.op.enum,['draft']);assert.ok(draft.required.includes('campaignDraft'));assert.ok(draft.required.includes('content'));assert.equal(draft.additionalProperties,false);
 const general=require('../taskPlanningSchema').responseSchema({request:'בדוק כדאיות',plan:[]}).properties.next.anyOf;assert.ok(general.find(s=>s.properties.op.enum[0]==='read').required.includes('args'));assert.ok(general.find(s=>s.properties.op.enum[0]==='ask').required.includes('question'));
});
