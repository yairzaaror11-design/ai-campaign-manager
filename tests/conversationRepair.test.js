'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const j=require('../campaignJourney'),facts=require('../conversationFacts'),control=require('../conversationControl');
function complete(){
 const p={planId:'repair',answers:{}};j.init(p);
 for(const [field,value]of Object.entries({businessName:'יאיר דיגיטל',businessType:'פרסום',businessGoal:'מכירות',product:'ניהול קמפיינים ב-Meta',audience:'בעלי עסקים',geography:'כל הארץ',advantage:'שירות אישי',dailyBudget:{amount:100,currency:'ILS',period:'day'},leadDestination:'WhatsApp',offer:'14 יום ניהול במתנה',offerMediaSeparate:true,offerScope:'ניהול קמפיינים',offerCommitment:'ללא התחייבות'}))facts.write(p,field,value);
 return p;
}
test('reset requests never become pending answers or extracted business facts',()=>{
 for(const text of ['תמחק את השיחה אני רוצה להתחיל מחדש','מחק את השיחה','נתחיל מחדש','אני רוצה להתחיל מחדש','/reset']){
  const p=complete();p.journey.stage='DISCOVERY';p.journey.pendingField='advantage';const before=JSON.stringify(p.answers);
  assert.equal(control.isReset(text),true,text);
  assert.equal(j.transition(p,text).resetRequested,true);
  assert.equal(JSON.stringify(p.answers),before);
  assert.deepEqual(require('../conversationAnalysis').localAnalysis(text).updates,[]);
 }
 assert.equal(control.isReset('הלקוח כתב ״תמחק את השיחה״'),false);
 assert.equal(control.isReset('העסק עוזר להתחיל מחדש'),false);
 assert.throws(()=>facts.write(complete(),'advantage','תמחק את השיחה אני רוצה להתחיל מחדש'),/INVALID_BUSINESS_FACT/);
});
test('screenshot feedback changes actual copy, preserves offer terms and survives the plan step',()=>{
 for(const feedback of ['הכל','הכול','המסר','הסגנון','קצר יותר','סגנון אישי']){
  const p=complete();j.advance(p,{target:'ad'});const before=JSON.stringify(p.journey.draft.creatives),answers=JSON.stringify(p.answers);
  j.transition(p,'לא אהבתי את המודעה');const reply=j.transition(p,feedback);
  assert.notEqual(JSON.stringify(p.journey.draft.creatives),before,feedback);
  assert.match(reply.reply,/עדכנתי את הנוסח/);assert.equal(reply.decisionKey,'creative_review');
  assert.match(reply.reply,/המדיה משולם בנפרד/);assert.match(reply.reply,/ללא התחייבות/);
  assert.equal(JSON.stringify(p.answers),answers);
  const edited=JSON.stringify(p.journey.draft.creatives);
  j.transition(p,'כן');assert.equal(p.journey.stage,'PLAN_REVIEW');assert.equal(JSON.stringify(p.journey.draft.creatives),edited);
  assert.equal(p.journey.draft.requiresApproval,true);assert.equal(p.journey.planApproved,false);
 }
});
test('unknown feedback asks one question and never claims an unchanged draft was rewritten',()=>{
 const p=complete();j.advance(p,{target:'ad'});const before=JSON.stringify(p.journey.draft.creatives);
 j.transition(p,'לא אהבתי את המודעה');const r=j.transition(p,'משהו אחר לגמרי');
 assert.equal(p.journey.pendingField,'creativeFeedback');assert.equal(JSON.stringify(p.journey.draft.creatives),before);
 assert.doesNotMatch(r.reply,/נוסח חלופי|עדכנתי את הנוסח/);assert.equal((r.reply.match(/\?/g)||[]).length,1);
});
test('successive message revisions do not recycle the previous version',()=>{
 const p=complete();j.advance(p,{target:'ad'});
 for(let i=0;i<3;i++){
  const before=JSON.stringify(p.journey.draft.creatives);j.transition(p,'לא אהבתי את המודעה');j.transition(p,'המסר');
  assert.notEqual(JSON.stringify(p.journey.draft.creatives),before);
 }
});
