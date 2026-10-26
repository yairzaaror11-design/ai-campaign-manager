'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {emptyProfile}=require('../marketingStore');
const {transition}=require('../marketingConversation');
const brain=require('../marketingBrain');
function run(p,text){return transition(p,text);}
test('discovery continues without forced three-answer pauses',()=>{
 const p=emptyProfile();assert.equal(run(p,'נתחיל').handled,true);
 for(const v of ['מכירות','יאיר דיגיטל','ניהול קמפיינים לעסקים']){
  const r=run(p,v);assert.equal(r.handled,true);assert.doesNotMatch(r.reply,/להמשיך\?/);
 }
 assert.equal(p.session.awaitingContinue,false);
});
test('clarification does not overwrite pending question',()=>{
 const p=emptyProfile();run(p,'נתחיל');const before=p.session.pendingId;
 const result=run(p,'מה הכוונה?');
 assert.equal(result.handled,true);assert.equal(p.session.pendingId,before);
 assert.match(result.reply,/המטרה:/);
});
test('strategy draft uses only current tenant answers and does not claim execution',()=>{
 const p=emptyProfile();run(p,'נתחיל');run(p,'מכירות');run(p,'יאיר דיגיטל');run(p,'ניהול קמפיינים לעסקים');
 const result=run(p,'טיוטת קמפיין');assert.equal(result.handled,true);
 assert.match(result.reply,/יאיר דיגיטל/);assert.match(result.reply,/PAUSED/);
 assert.doesNotMatch(result.reply,/קמפיין פורסם/);
});
test('business scope remains separate from plan scope',()=>{
 const p=emptyProfile();run(p,'נתחיל');run(p,'מכירות');run(p,'יאיר דיגיטל');
 assert.equal(brain.fact(p,'BUS-001'),'יאיר דיגיטל');
 run(p,'קמפיין חדש');assert.equal(brain.fact(p,'BUS-001'),'יאיר דיגיטל');
 assert.equal(brain.fact(p,'GOAL-001'),null);
});
