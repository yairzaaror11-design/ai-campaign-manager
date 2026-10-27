'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const analysis=require('../conversationAnalysis'),journey=require('../campaignJourney');
const store=require('../marketingStore'),facts=require('../conversationFacts'),ai=require('../aiService');
test('short replies are interpreted with the pending question, facts and recent exchange',async()=>{
 const previous=process.env.AI_PROVIDER;process.env.AI_PROVIDER='context_test';
 try{
  const p=store.emptyProfile();journey.transition(p,'נתחיל');
  ai.registerProvider('context_test',async(text,history,options)=>{
   assert.equal(options.context.pendingField,'businessType');assert.match(options.context.pendingQuestion,/מה העסק/);
   assert.equal(options.context.recentMessages[0].content,'מה העסק עושה?');
   return{analysis:{intent:'other',messageKind:'side_question',updates:[]}};
  });
  const a=await analysis.analyze('למה זה משנה',p,{history:[{role:'assistant',content:'מה העסק עושה?'}]});
  assert.equal(a.messageKind,'side_question');assert.equal(journey.transition(p,'למה זה משנה',{analysis:a}).handled,false);
  assert.equal(p.journey.pendingField,'businessType');assert.equal(facts.value(p,'businessType'),null);
 }finally{if(previous===undefined)delete process.env.AI_PROVIDER;else process.env.AI_PROVIDER=previous;}
});
test('mixed answer and question saves explicit facts and leaves room for a conversational answer',()=>{
 const p=store.emptyProfile();journey.transition(p,'נתחיל');
 const text='אני מוכר פרחים, למה צריך לדעת את זה?';
 const a=analysis.validateAnalysis({intent:'other',messageKind:'side_question',updates:[{field:'businessType',value:'פרחים',evidence:'מוכר פרחים'}]},text);
 const r=journey.transition(p,text,{analysis:a});assert.equal(r.handled,false);assert.equal(r.changed,true);
 assert.equal(facts.value(p,'businessType'),'פרחים');assert.equal(p.journey.pendingField,'businessType');
 const next=journey.transition(p,'נמשיך');assert.match(next.reply,/המטרה העסקית/);
});
test('context cannot ground facts that are absent from the current message',()=>{
 assert.throws(()=>analysis.validateAnalysis({intent:'other',messageKind:'answer',updates:[{field:'product',value:'פרחים',evidence:'פרחים'}]},'כמו שאמרתי קודם'),/UNGROUNDED/);
});
