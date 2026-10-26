'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {WELCOME,isGreeting}=require('../conversationGreeting');
test('standalone greetings produce the exact owner-provided opening',()=>{
 const transition=require('../marketingConversation').transition;
 for(const text of ['היי','הי','הייי!','שלום','שלום לך','אהלן','בוקר טוב','ערב טוב','מה נשמע?','היי 👋','Hi','HELLO!','היי, מה נשמע?','/start']){
  assert.equal(isGreeting(text),true,text);const p=require('../marketingStore').emptyProfile();
  assert.equal(transition(p,text).reply,WELCOME);assert.equal(p.journey.stage,'IDLE');assert.equal(p.journey.pendingField,null);
 }
});
test('greeting prefixes never swallow an actual campaign or business request',()=>{
 for(const text of ['היי תכין לי קמפיין','שלום, העסק שלי מוכר פרחים','שלום אני רוצה להתחיל לפרסם','ההצעה שלי היא ערב טוב','מה קורה עם הקמפיין שלי?'])assert.equal(isGreeting(text),false,text);
});
test('a greeting preserves pending questions, business facts, draft and paused state',()=>{
 const store=require('../marketingStore'),transition=require('../marketingConversation').transition;
 const p=store.emptyProfile();require('../campaignJourney').init(p);p.journey.stage='DISCOVERY';p.journey.pendingField='product';p.journey.paused=true;p.answers={known:{value:'פרחים'}};p.session={controller:'diagnostic',pendingId:'Q-001'};
 const before=JSON.stringify(p);assert.equal(transition(p,'אהלן').reply,WELCOME);assert.equal(JSON.stringify(p),before);
});
