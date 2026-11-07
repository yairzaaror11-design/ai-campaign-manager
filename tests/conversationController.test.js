'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {openDatabase}=require('./helpers/database');
test('one WhatsApp conversation owner preserves recruitment through a cold start and cannot fall into old sales drafts',async()=>{
 const env={...process.env},h=await openDatabase(),wa=require('../whatsapp'),evaluation=require('../taskEvaluation'),marketing=require('../marketingConversation'),reads=require('../readConversation');
 const before={send:wa.safeSend,ready:evaluation.ready,wait:evaluation.waitUntilReady,marketing:marketing.handleMarketingMessage,read:reads.handle};
 let ready=false,planned=0;const sent=[],contexts=[],waits=[];
 Object.assign(process.env,{UNIFIED_CONVERSATION_ENABLED:'true',TASK_AGENT_ENABLED:'true',TASK_AGENT_REQUIRE_EVAL:'true',TASK_AGENT_PILOT_ONLY:'true',AUTHORIZED_PHONE_NUMBERS:'972500066112',AI_PROVIDER:'unified_controller_fixture',WHATSAPP_SEND_ENABLED:'false',PUBLIC_ONBOARDING_ENABLED:'false'});
 evaluation.ready=()=>ready;evaluation.waitUntilReady=async timeout=>{waits.push(timeout);return ready;};wa.safeSend=async(_to,text)=>sent.push(text);
 marketing.handleMarketingMessage=async()=>{throw Error('OLD_MARKETING_MUST_NOT_OWN_CONVERSATION');};
 reads.handle=async()=>{throw Error('OLD_READ_ROUTER_MUST_NOT_INTERCEPT_TASK');};
 require('../aiService').registerProvider('unified_controller_fixture',async raw=>{
  planned++;const c=JSON.parse(raw);contexts.push(c);
  const plan=[{id:'details',label:'פרטי המשרה',kind:'collect',dependsOn:[]},{id:'copy',label:'מודעת דרושים',kind:'draft',dependsOn:['details']},{id:'form',label:'טופס מועמדות',kind:'meta',intent:'CREATE_LEAD_FORM',dependsOn:['copy']},{id:'campaign',label:'קמפיין דרושים',kind:'meta',intent:'CREATE_BUNDLE',dependsOn:['form']}];
  return{text:JSON.stringify({...(!c.plan.length?{plan}:{}),next:{op:'ask',stepId:'details',question:'לאיזו משרה ובאיזה אזור מגייסים?'}}),actionPlans:[]};
 });
 delete require.cache[require.resolve('../messageHandler')];
 const client=await require('../clientStore').getOrCreateClient('972500066112');
 await require('../marketingStore').update(client.id,null,p=>{const facts=require('../conversationFacts');facts.write(p,'businessType','שירותי דיגיטל',{evidence:'שירותי דיגיטל'});facts.write(p,'product','תוכן לסושיאל',{evidence:'תוכן לסושיאל'});facts.write(p,'businessGoal','הגדלת הכנסות',{evidence:'הגדלת הכנסות'});p.journey={schemaVersion:2,stage:'CREATIVE_REVIEW',requestedOutput:'ad',revision:1,draft:{creatives:[{headline:'להגדיל את ההכנסות',body:'תוכן לסושיאל לעסקים בתל אביב'}]}};return{handled:false,changed:true};});
 const handler=require('../messageHandler').handleIncomingMessage;
 const send=(id,body)=>handler({id,from:'972500066112',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body}});
 const request='תיצור לי קמפיין דרושים עם מודעה וטופס מועמדות';
 try{
  await send('unified-1',request);
  assert.equal(planned,0);assert.deepEqual(waits,[120000]);assert.match(sent.at(-1),/הבקשה נשמרה/);assert.doesNotMatch(sent.at(-1),/תוכן לסושיאל|להגדיל את ההכנסות|נכין תוכנית/);
  const saved=await require('../taskAgent').current(client.id);assert.equal(saved.request,request);assert.equal(saved.status,'WAITING_MODEL');
  ready=true;await send('unified-2','המשך במשימה');assert.equal(planned,1);assert.match(sent.at(-1),/לאיזו משרה ובאיזה אזור/);assert.equal(contexts[0].request,request);assert.equal(contexts[0].knownBusiness.localDraft,undefined);assert.equal(contexts[0].knownBusiness.pendingQuestion,undefined);assert.equal(contexts[0].knownBusiness.facts.businessGoal,undefined);assert.equal(contexts[0].knownBusiness.facts.product.value,'תוכן לסושיאל');
  await send('unified-3','למה צריך אזור?');assert.equal(planned,2);assert.equal(contexts[1].request,request);assert.equal((await require('../taskAgent').current(client.id)).id,saved.id);
  assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM action_plans')).rows[0].n,0);
  assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM meta_execution_attempts')).rows[0].n,0);
  ready=false;await send('unified-4','המשך במשימה');assert.equal(planned,2);assert.match(sent.at(-1),/הבקשה נשמרה/);assert.doesNotMatch(sent.at(-1),/נכין תוכנית|תוכן לסושיאל/);
  evaluation.waitUntilReady=async timeout=>{assert.equal(timeout,120000);ready=true;return true;};await send('unified-5','המשך במשימה');assert.equal(planned,3);assert.match(sent.at(-1),/לאיזו משרה/);
 }finally{wa.safeSend=before.send;evaluation.ready=before.ready;evaluation.waitUntilReady=before.wait;marketing.handleMarketingMessage=before.marketing;reads.handle=before.read;delete require.cache[require.resolve('../messageHandler')];await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
test('unified controller does not authorize legacy approvals or turn a greeting into a new task',async()=>{
 const env={...process.env},h=await openDatabase();
 Object.assign(process.env,{UNIFIED_CONVERSATION_ENABLED:'true',TASK_AGENT_PILOT_ONLY:'true',AUTHORIZED_PHONE_NUMBERS:'972500066113'});
 try{
  const client=(await h.db.query("INSERT INTO clients(phone) VALUES('972500066113') RETURNING *")).rows[0],controller=require('../conversationController');
  assert.equal(controller.acceptsInteractive({ui:{decisionKey:'creative_review'}}),false);assert.equal(controller.acceptsInteractive({ui:{decisionKey:'plan_review'}}),false);assert.equal(controller.acceptsInteractive({ui:{decisionKey:'action_approval'}}),true);assert.equal(controller.acceptsInteractive({ui:{decisionKey:'account_selection'}}),true);
  const greeting=await controller.handle(client.id,{message:'היי',requestId:'hello',channel:'WHATSAPP'});assert.match(greeting.reply,/מה תרצה/);
  const stale=await controller.handle(client.id,{message:'אשר 123456',requestId:'stale',channel:'WHATSAPP'});assert.equal(stale.delegateApproval,undefined);assert.match(stale.reply,/אין פעולה ממתינה/);
  const media=await controller.media(client.id,{message:'תמונה',requestId:'photo',channel:'WHATSAPP'});assert.match(media.reply,/מה תרצה להכין/);
  assert.equal(await require('../taskAgent').current(client.id),null);
 }finally{await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
