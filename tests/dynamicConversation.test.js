'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
test('semantic router uses the dedicated no-tool Gemini transport and rejects malformed routing output',async()=>{
 let config,response={kind:'ANSWER',reply:'מיקומים הם המקומות שבהם המודעה מוצגת.'};
 const ai={chats:{create:c=>{config=c;return{sendMessage:async()=>({text:JSON.stringify(response),functionCalls:[]})};}}};
 require('../aiService').registerProvider('router_transport_fixture',(text,history,options)=>require('../gemini').processWithGemini(text,history,{...options,ai}));
 const router=require('../conversationRouter');const r=await router.route({message:'מה הכוונה במיקומים?'},{provider:'router_transport_fixture'});
 assert.equal(r.kind,'ANSWER');assert.equal(config.config.systemInstruction,router.SYSTEM);assert.equal(config.config.tools,undefined);assert.equal(config.config.responseJsonSchema.properties.usePending,undefined);assert.equal(config.config.maxOutputTokens,2048);
 response={kind:'EXECUTE',reply:'private'};await assert.rejects(router.route({message:'שאלה'},{provider:'router_transport_fixture'}),/ROUTING_RESPONSE_INVALID/);
 for(const m of ['אשר 123456','מאשר את התוכן','עצור','המשך במשימה'])assert.equal(router.exactControl(m),true);
});
test('routing repairs malformed model output once and ignores an unavailable pending request',async()=>{
 const router=require('../conversationRouter');
 let calls=0;
 require('../aiService').registerProvider('router_repair_fixture',async input=>{
  calls++;
  if(calls===1)return {text:'{"kind":"ANSWER"}',actionPlans:[]};
  assert.ok(JSON.parse(input).routerFeedback);
  return {text:'{"kind":"DISCOVERY","usePending":true}',actionPlans:[]};
 });
 const result=await router.route({message:'בוא תעזור לי להגדיל הכנסות לעסק'},{provider:'router_repair_fixture'});
 assert.deepEqual(result,{kind:'DISCOVERY'});
 assert.equal(calls,2);
});
test('semantic understanding answers, discovers, continues, revises and starts work without stale review or keyword matching',async()=>{
 const env={...process.env},h=await require('./helpers/database').openDatabase();process.env.TASK_AGENT_ENABLED='true';
 const agent=require('../taskAgent'),meta=require('../metaConnection');let routeCalls=0,planCalls=0;
 Object.assign(process.env,{UNIFIED_CONVERSATION_ENABLED:'true',DYNAMIC_CONVERSATION_ENABLED:'true',TASK_AGENT_REQUIRE_EVAL:'false',TASK_AGENT_PILOT_ONLY:'true',AUTHORIZED_PHONE_NUMBERS:'972500066130'});
 try{
  const client=await require('../clientStore').getOrCreateClient('972500066130');
  await require('../marketingStore').update(client.id,null,p=>{require('../conversationFacts').write(p,'product','ניהול פרסום לעסקים',{evidence:'ניהול פרסום לעסקים'});return{changed:true};});
  const id=crypto.randomUUID(),old={steps:[{id:'copy',kind:'draft',label:'מודעה ישנה',dependsOn:[],status:'PREPARED',artifact:{title:'ישן',content:'OLD_AD_SHOULD_NOT_BE_ANSWER',reviewed:false,hash:'old'}}],facts:{},messages:[]};
  await h.db.query("INSERT INTO agent_tasks(id,client_id,request,status,state) VALUES($1,$2,'תכין מודעה לעסק','WAITING_REVIEW',$3::jsonb)",[id,client.id,JSON.stringify(old)]);
  const discovery='יש לי תחושה שאנחנו רצים מהר מדי. עוד לא סגרתי מי הלקוחות המתאימים ומה ההצעה, אפשר לחשוב על זה יחד?';assert.equal(require('../planningIntent').directionOnly(discovery),false);
  const turnRouter=async c=>{routeCalls++;return c.message==='איפה רואים את המודעה הזאת?'?{kind:'ANSWER',reply:'הטיוטה נמצאת כאן בשיחה. עדיין אין פרסום פעיל שלה.'}:c.message===discovery?{kind:'DISCOVERY'}:c.message==='נשאיר את זה למחר.'?{kind:'PAUSE'}:c.message==='יאללה, נחזור לזה.'?{kind:'RESUME'}:c.message==='מסעדות'?{kind:'CONTINUE'}:c.message==='הנוסח מתאים, אבל אני מעדיף אותו הרבה יותר קצר.'?{kind:'REVISE'}:{kind:'START'};};
  const planner=async c=>{
   planCalls++;
   if(c.planningMode==='DISCOVERY_BEFORE_CREATIVE'){
    assert.equal(c.request,discovery);assert.equal(c.knownBusiness.facts.product.value,'ניהול פרסום לעסקים');
    if(!c.plan.length)return{plan:[{id:'choose',kind:'collect',label:'בחירת קהל',dependsOn:[]},{id:'direction',kind:'draft',label:'כיוון',dependsOn:['choose']}],next:{op:'ask',stepId:'choose',question:'באיזה סוג עסקים יש לך הכי הרבה ניסיון?'}};
    if(c.plan[0].status!=='DONE')return{next:{op:'collect',stepId:'choose',facts:[{key:'industry',value:'מסעדות',evidence:'מסעדות'}]}};
    return{next:{op:'draft',stepId:'direction',title:'כיוון מוצע',content:'נתמקד במסעדות ונברר מה ההצעה המתאימה.'}};
   }
   assert.equal(c.facts.industry.value,'מסעדות');
   if(!c.plan.length)return{plan:[{id:'copy',kind:'draft',label:'מודעה',dependsOn:[]}],next:{op:'draft',stepId:'copy',title:'מודעה',content:'ניהול פרסום למסעדות. לפרטים כתבו לנו ונקבע שיחה.'}};
   if(c.messages.at(-1).content==='הנוסח מתאים, אבל אני מעדיף אותו הרבה יותר קצר.')return{next:{op:'draft',stepId:'copy',title:'מודעה',content:'ניהול פרסום למסעדות. דברו איתנו.'}};
   if(c.plan[0].status==='PREPARED')return{next:{op:'review'}};
   return{next:{op:'finish'}};
  };
  const send=(message,requestId,extra={})=>meta.context.run(String(client.id),()=>require('../conversationController').handle(client.id,{message,requestId,channel:'WHATSAPP'},{turnRouter,planner,...extra}));
  const answer=await send('איפה רואים את המודעה הזאת?','question');assert.equal(answer.task.id,id);assert.equal(answer.task.status,'WAITING_REVIEW');assert.equal(planCalls,0);assert.doesNotMatch(answer.reply,/OLD_AD_SHOULD_NOT_BE_ANSWER|מאשר את התוכן/);
  assert.deepEqual(await send('איפה רואים את המודעה הזאת?','question'),answer);assert.equal(routeCalls,1);
  const advice=await send(discovery,'discovery');assert.notEqual(advice.task.id,id);assert.equal(advice.task.status,'WAITING_INPUT');assert.match(advice.reply,/באיזה סוג עסקים/);assert.equal((await agent.current(client.id)).state.planningMode,'DISCOVERY_BEFORE_CREATIVE');
  assert.deepEqual(await send(discovery,'discovery'),advice);assert.equal(routeCalls,2);
  const direction=await send('מסעדות','industry');assert.equal(direction.task.id,advice.task.id);assert.equal(direction.task.status,'WAITING_REVIEW');
  const created=await send('יאללה, אפשר להתקדם למה שסיכמנו ולהכין את המודעה.','create');assert.notEqual(created.task.id,advice.task.id);assert.match(created.reply,/ניהול פרסום למסעדות/);
  const revised=await send('הנוסח מתאים, אבל אני מעדיף אותו הרבה יותר קצר.','revise');assert.equal(revised.task.id,created.task.id);assert.match(revised.reply,/דברו איתנו/);
  assert.equal((await send('נשאיר את זה למחר.','pause')).task.status,'PAUSED');assert.equal((await send('יאללה, נחזור לזה.','resume')).task.id,created.task.id);
  const routed=routeCalls;const approved=await send('מאשר את התוכן','approve');assert.equal(routeCalls,routed);assert.equal(approved.task.status,'COMPLETE');
  for(const table of ['action_plans','meta_execution_attempts','graphic_jobs'])assert.equal((await h.db.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n,0);
 }finally{await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
test('a deferred semantic request is interpreted on real resume instead of replaying the old ready ad',async()=>{
 const env={...process.env},h=await require('./helpers/database').openDatabase();process.env.TASK_AGENT_ENABLED='true';
 const agent=require('../taskAgent'),meta=require('../metaConnection');
 try{
  const client=(await h.db.query("INSERT INTO clients(phone) VALUES('972500066131') RETURNING *")).rows[0],id=crypto.randomUUID();
  await h.db.query("INSERT INTO agent_tasks(id,client_id,request,status,state) VALUES($1,$2,'תכין מודעה','WAITING_REVIEW',$3::jsonb)",[id,client.id,JSON.stringify({steps:[{id:'copy',kind:'draft',label:'מודעה',dependsOn:[],status:'PREPARED',artifact:{title:'ישן',content:'OLD',hash:'old',reviewed:false}}],facts:{},messages:[]})]);
  const message='לא בטוח שההצעה הזאת מתאימה ללקוחות שלי, אפשר לחשוב יחד לפני שמתקדמים?';let routes=0;
  const options={dynamicRouting:true,turnRouter:async c=>{routes++;assert.equal(c.message,'כן, קדימה');assert.equal(c.pendingRequest,message);return{kind:'DISCOVERY',usePending:true};},planner:async()=>({plan:[{id:'discuss',kind:'collect',label:'בחירת כיוון',dependsOn:[]}],next:{op:'ask',stepId:'discuss',question:'למי היית רוצה לפנות?'}})};
  const send=(body,key,extra={})=>meta.context.run(String(client.id),()=>agent.send(client.id,{message:body,requestId:key,channel:'WHATSAPP'},{...options,...extra}));
  const held=await send(message,'held',{deferPlanning:true});assert.equal(routes,0);assert.equal(held.task.status,'WAITING_MODEL');assert.equal(agent.canPresentReview(await agent.active(client.id),'המשך במשימה'),false);
  const resumed=await send('כן, קדימה','resume');assert.equal(routes,1);assert.notEqual(resumed.task.id,id);assert.equal(resumed.task.status,'WAITING_INPUT');assert.match(resumed.reply,/למי היית רוצה/);assert.doesNotMatch(resumed.reply,/OLD/);
 }finally{await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
