'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const store=require('../marketingStore'),facts=require('../conversationFacts'),journey=require('../campaignJourney');
const analyze=require('../conversationAnalysis'),marketing=require('../marketingConversation');
function started(){const p=store.emptyProfile();journey.transition(p,'נתחיל');return p;}
for(const text of ['יקר לי','זה יקר מדי','אין לי כסף','אני לא בטוח שזה יעבוד','אתה לא מבין אותי','כבר עניתי על זה','רגע, יש לי שאלה','תעזור לי לבחור','מה אם ננסה 100 שקל ביום?']){
 test(`a detour is not stored as a business answer: ${text}`,()=>{
  const p=started(),before=JSON.stringify(p.answers);const r=journey.transition(p,text);
  assert.equal(r.handled,false);assert.equal(r.changed,true);assert.equal(JSON.stringify(p.answers),before);
  assert.equal(p.journey.pendingField,'businessType');assert.equal(p.journey.detour,true);
 });
}
test('a hypothetical budget is not an assertion and projections are not performance reports',()=>{
 assert.equal(analyze.localAnalysis('מה אם ננסה 100 שקל ביום?').updates.length,0);
 assert.notEqual(analyze.localAnalysis('כמה לידים יכול להביא לי 100 שקל ביום?').intent,'report');
 assert.equal(analyze.localAnalysis('כמה לידים הגיעו השבוע?').intent,'report');
});
test('yes after a detour cannot approve an earlier strategy even if the interpreter labels it as an answer',()=>{
 const p=started();p.journey.stage='STRATEGY_REVIEW';p.journey.pendingField=null;
 journey.transition(p,'למה בחרת בקהל הזה?');
 const r=journey.transition(p,'כן',{analysis:{intent:'other',messageKind:'answer',updates:[]}});
 assert.equal(r.handled,false);assert.equal(p.journey.strategyApproved,false);assert.equal(p.journey.stage,'STRATEGY_REVIEW');
});
test('resume after a detour returns to the same review without approving it',()=>{
 const p=started();for(const f of journey.CORE)facts.write(p,f,f==='dailyBudget'?{amount:100,currency:'ILS',period:'day'}:'פרט '+f);
 journey.transition(p,'תכין אסטרטגיה');journey.transition(p,'למה זה מתאים לי?');
 const resumed=journey.transition(p,'נמשיך');assert.match(resumed.reply,/הכיוון המוצע/);
 assert.equal(p.journey.stage,'STRATEGY_REVIEW');assert.equal(p.journey.strategyApproved,false);
 journey.transition(p,'כן');assert.equal(p.journey.stage,'CREATIVE_REVIEW');
});
test('a request understood by the model never becomes a pending field answer',()=>{
 const p=started();const r=journey.transition(p,'תבדוק לי את המתחרים',{analysis:{intent:'other',messageKind:'request',updates:[]}});
 assert.equal(r.handled,false);assert.equal(facts.value(p,'businessType'),null);
});
test('a correction during a question updates only the corrected fact, then resumes missing information',()=>{
 const p=started();facts.write(p,'geography','חיפה');
 const text='בעצם האזור הוא נתניה, למה זה משנה?';
 const a=analyze.validateAnalysis({intent:'correct',messageKind:'side_question',correction:true,updates:[{field:'geography',value:'נתניה',evidence:'האזור הוא נתניה'}]},text);
 const r=journey.transition(p,text,{analysis:a});assert.equal(r.handled,false);
 assert.equal(facts.value(p,'geography'),'נתניה');assert.equal(facts.value(p,'businessType'),null);
 journey.transition(p,'נמשיך');assert.equal(p.journey.pendingField,'businessType');
});
test('a provisional draft can use existing facts without forcing the entire questionnaire',()=>{
 const p=started();facts.write(p,'businessType','חנות פרחים');facts.write(p,'product','זרי פרחים');
 const r=journey.transition(p,'תן טיוטה עם מה שיש בלי עוד שאלות');
 assert.match(r.reply,/טיוטה ראשונית/);assert.match(r.reply,/זרי פרחים/);assert.equal(p.journey.stage,'CREATIVE_REVIEW');
 assert.ok(p.journey.draft.missing.includes('קהל היעד'));assert.equal(p.journey.draft.dailyBudget,null);
 assert.equal(p.journey.draft.requiresApproval,true);
});
test('switching from diagnostics to drafting releases the diagnostic controller',()=>{
 const p=store.emptyProfile();marketing.transition(p,'קהל יעד');assert.equal(p.session.controller,'diagnostic');
 facts.write(p,'product','זרי פרחים');marketing.transition(p,'טיוטה עם מה שיש');
 assert.equal(p.session,null);assert.equal(p.journey.stage,'CREATIVE_REVIEW');
});
test('offline unexpected prose stays safe without pretending that the model understood it',async()=>{
 const p=started();const ai=require('../aiService'),original=ai.analyzeConversation;
 ai.analyzeConversation=async()=>{throw Error('UNAVAILABLE');};
 try{const a=await analyze.analyze('אני לא בטוח שזה מתאים לעסק שלי בכלל',p);const r=journey.transition(p,'אני לא בטוח שזה מתאים לעסק שלי בכלל',{analysis:a});assert.equal(r.handled,false);assert.equal(facts.value(p,'businessType'),null);}
 finally{ai.analyzeConversation=original;}
});
