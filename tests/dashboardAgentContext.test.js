'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {openDatabase}=require('./helpers/database');
test('dashboard context is current, bounded and isolated; free conversation preserves the journey',async()=>{
 const h=await openDatabase(),prior=process.env.AI_PROVIDER;
 try{
  const clients=require('../clientStore'),workspace=require('../workspaceService'),context=require('../workspaceContext');
  const store=require('../marketingStore'),agent=require('../portalAgent'),ai=require('../aiService');
  const a=await clients.getOrCreateClient('972501110001'),b=await clients.getOrCreateClient('972501110002');
  const product=await workspace.save(a.id,'products',{name:'פרחים',priceMinor:12345,currency:'ILS'},{requestId:crypto.randomUUID()});
  await workspace.save(b.id,'products',{name:'מידע של עסק אחר'},{requestId:crypto.randomUUID()});
  assert.equal((await context.read(a.id)).records.products.items[0].name,'פרחים');
  assert.equal((await context.read(a.id)).records.products.items[0].priceMinor,12345);
  await assert.rejects(context.read(a.id,{limit:100}),/INVALID_WORKSPACE_LIMIT/);
  await assert.rejects(context.read(a.id,{kind:'clients'}),/INVALID_WORKSPACE_INPUT/);
  const tool=require('../gemini').runTool;
  await assert.rejects(tool('get_workspace_records'),/TENANT_CONTEXT_REQUIRED/);
  const own=await require('../metaConnection').context.run(a.id,()=>tool('get_workspace_records',{kind:'products'}));
  assert.equal(own.records.products.items.length,1);assert.equal(own.records.products.items[0].name,'פרחים');
  await workspace.save(a.id,'products',{...product.payload,name:'זרי פרחים'},{id:product.id,version:product.version,requestId:crypto.randomUUID()});
  await store.update(a.id,null,p=>{require('../campaignJourney').transition(p,'נתחיל');return{handled:true};});
  process.env.AI_PROVIDER='dashboard_context_test';let replies=0;
  ai.registerProvider('dashboard_context_test',async(message,history,options)=>{
   if(options.task==='conversation_analysis')return{analysis:{intent:'other',messageKind:'side_question',updates:[]}};
   replies++;assert.equal(options.planningOnly,true);assert.equal(options.marketingContext.screen,'products');
   assert.equal(options.marketingContext.workspace.records.products.items[0].name,'זרי פרחים');
   assert.ok(!JSON.stringify(options.marketingContext).includes('מידע של עסק אחר'));
   return{text:'אפשר להתחיל בקידום זרי הפרחים שמופיעים בקטלוג.',actionPlans:[]};
  });
  const request={message:'מה כדאי לקדם?',screen:'products',requestId:crypto.randomUUID()};
  const first=await agent.send(a.id,request);assert.match(first.reply,/זרי הפרחים/);assert.equal(first.externalActionsExecuted,false);
  assert.equal((await store.load(a.id)).journey.pendingField,'businessType');
  assert.equal((await agent.history(a.id)).messages.length,2);assert.equal((await agent.history(b.id)).messages.length,0);
  assert.equal((await agent.send(a.id,request)).reply,first.reply);assert.equal(replies,1);
  await assert.rejects(agent.send(a.id,{...request,message:'שינוי'}),/WORKSPACE_REQUEST_CONFLICT/);
  const blocked=await agent.send(a.id,{message:'פרסם עכשיו',screen:'products',requestId:crypto.randomUUID()});assert.match(blocked.reply,/אישור/);assert.equal(replies,1);
  ai.registerProvider('dashboard_context_test',async(message,history,options)=>{
   if(options.task==='conversation_analysis')return{analysis:{intent:'other',messageKind:'side_question',updates:[]}};
   await store.update(a.id,null,p=>{p.concurrentUpdate=true;return{handled:false,changed:true};});
   return{text:'תשובה ישנה',actionPlans:[]};
  });
  await assert.rejects(agent.send(a.id,{...request,requestId:crypto.randomUUID()}),/WORKSPACE_STALE/);
  assert.equal((await store.load(a.id)).concurrentUpdate,true);
 }finally{if(prior===undefined)delete process.env.AI_PROVIDER;else process.env.AI_PROVIDER=prior;await h.close();}
});
test('planning mode removes tools and rejects unexpected tool requests in both providers',async()=>{
 const gemini=require('../gemini'),claude=require('../claude');let geminiConfig;
 const fake={chats:{create:options=>{geminiConfig=options;return{sendMessage:async()=>({functionCalls:[{name:'get_ad_accounts'}]})};}}};
 await assert.rejects(gemini.processWithGemini('שאלה',[],{ai:fake,planningOnly:true}),/PLANNING_TOOL_CALL_REJECTED/);
 assert.equal(geminiConfig.config.tools,undefined);
 const previous=process.env.CLAUDE_MODEL;process.env.CLAUDE_MODEL='test-model';
 try{
  const client={create:async body=>{assert.equal(body.tools,undefined);return{content:[{type:'tool_use',id:'1',name:'get_ad_accounts'}]};}};
  await assert.rejects(claude.processWithClaude('שאלה',[],{client,planningOnly:true}),/PLANNING_TOOL_CALL_REJECTED/);
 }finally{if(previous===undefined)delete process.env.CLAUDE_MODEL;else process.env.CLAUDE_MODEL=previous;}
});
