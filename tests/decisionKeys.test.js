'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const journey=require('../campaignJourney'),facts=require('../conversationFacts');
function moduleWith(name,overrides){
 const filename=path.join(__dirname,'..',name+'.js'),module={exports:{}};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,require:id=>Object.hasOwn(overrides,id)?overrides[id]:require(id.startsWith('.')?path.resolve(path.dirname(filename),id):id),Date,Buffer},{filename});
 return module.exports;
}
function harness(){
 const profiles=new Map();
 const store={update:async(id,_event,work)=>work(profiles.get(id))};
 return{profiles,ui:moduleWith('conversationUi',{'./marketingStore':store})};
}
const click=id=>({interactive:{type:'button_reply',button_reply:{id,title:'אשר 123456'}}});
test('complete journey uses explicit decisions, keeps facts and never approves Meta',async()=>{
 const {profiles,ui}=harness(),p={planId:'test',answers:{}};profiles.set('a',p);
 let r=journey.transition(p,'היי');assert.equal(r.decisionKey,'welcome');
 let menu=await ui.prepare('a','נוסח פתיחה חדש לגמרי',r.decisionKey);
 const id=menu.interactivePayload.interactive.action.buttons[0].reply.id;
 const selected=await ui.consume('a',click(id));assert.equal(selected,'אני רוצה קמפיין');
 r=journey.transition(p,selected);assert.equal(p.journey.pendingField,'businessType');assert.equal(r.decisionKey,null);
 const answers=['סטודיו לעיצוב','מכירות','עיצוב בתים','בעלי דירות','נתניה','שירות אישי','100 שקל ביום','פניות בוואטסאפ'];
 for(const answer of answers)r=journey.transition(p,answer);
 assert.equal(p.journey.stage,'STRATEGY_REVIEW');assert.equal(r.decisionKey,'strategy_review');
 assert.equal(facts.value(p,'dailyBudget').amount,100);
 r=journey.transition(p,'כן');assert.equal(r.decisionKey,'creative_review');
 r=journey.transition(p,'כן');assert.equal(p.journey.stage,'PLAN_REVIEW');assert.equal(r.decisionKey,null);
 assert.equal(p.journey.draft.status,'LOCAL_DRAFT');
 r=journey.transition(p,'כן');assert.match(r.reply,/אישור נפרד/);
 journey.transition(p,'בעצם 200 שקל ביום');assert.equal(facts.value(p,'dailyBudget').amount,200);
 assert.equal(facts.value(p,'businessType'),'סטודיו לעיצוב');
 assert.equal(p.journey.planApproved,false);
});
test('long and voice-prefixed replies retain menus and reject invalid decision keys',async()=>{
 const {profiles,ui}=harness(),p={planId:'p',journey:{stage:'DISCOVERY',pendingField:'dailyBudget',revision:1}};profiles.set('a',p);
 const body='שמעתי: הודעה קולית\n'+'א'.repeat(1200);
 const result=await ui.prepare('a',body,'dailyBudget');
 assert.equal(result.leadingText,body);assert.equal(result.interactivePayload.interactive.type,'list');
 assert.ok(result.interactivePayload.interactive.body.text.length<1024);
 await assert.rejects(ui.prepare('a','בחר','execute_meta'),/INVALID_DECISION_KEY/);
 assert.equal((await ui.prepare('a','מה תקציב המדיה היומי ובאיזה מטבע?')).interactivePayload,undefined);
});
test('forged, cross-client, expired, changed and replayed menus cannot be consumed',async()=>{
 const {profiles,ui}=harness();
 profiles.set('a',{planId:'a',journey:{stage:'IDLE'}});profiles.set('b',{planId:'b',journey:{stage:'IDLE'}});
 const menu=await ui.prepare('a','פתיחה','welcome'),id=menu.interactivePayload.interactive.action.buttons[0].reply.id;
 assert.equal(await ui.consume('b',click(id)),null);
 assert.equal(await ui.consume('a',click(id.replace(/:0$/,':9'))),null);
 profiles.get('a').ui.expiresAt=0;assert.equal(await ui.consume('a',click(id)),null);
 profiles.get('a').ui.expiresAt=Date.now()+10000;profiles.get('a').planId='new';assert.equal(await ui.consume('a',click(id)),null);
 profiles.get('a').planId='a';assert.equal(await ui.consume('a',click(id)),'אני רוצה קמפיין');
 assert.equal(await ui.consume('a',click(id)),null);
});
test('long content enqueues before menu and a failed first enqueue stops the menu',async()=>{
 const sent=[];
 const delivery={textPayload:text=>({type:'text',text:{body:text}}),enqueue:async(to,payload)=>sent.push({to,payload})};
 const whatsapp=moduleWith('whatsapp',{'axios':{},'./whatsappDelivery':delivery});
 const interactivePayload={type:'interactive'};
 await whatsapp.safeSend('a','long',{leadingText:'long',interactivePayload});
 assert.deepEqual(sent.map(x=>x.payload.type),['text','interactive']);
 delivery.enqueue=async()=>{throw Error('QUEUE_FAILED');};
 await assert.rejects(whatsapp.safeSend('a','long',{leadingText:'long',interactivePayload}),/QUEUE_FAILED/);
});
