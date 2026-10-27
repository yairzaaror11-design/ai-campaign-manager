'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const store=require('../marketingStore'),facts=require('../conversationFacts');
const journey=require('../campaignJourney'),analysis=require('../conversationAnalysis');
const {transition}=require('../marketingConversation');
function complete(){const p=store.emptyProfile();const values={businessName:'יאיר דיגיטל',businessType:'שירותי פרסום לעסקים',businessGoal:'מכירות',product:'ניהול קמפיינים ב-Meta',audience:'בעלי עסקים מכל התחומים',geography:'כל הארץ',advantage:'שירות אישי ומחיר נגיש',dailyBudget:{amount:100,currency:'ILS',period:'day'},leadDestination:'שיחה או הודעה'};for(const [f,v]of Object.entries(values))facts.write(p,f,v);return p;}
test('greeting and a capabilities question never start an unwanted questionnaire',()=>{
 const p=store.emptyProfile();assert.match(transition(p,'היי').reply,/מה נרצה לעשות היום/);
 assert.equal(p.journey.stage,'IDLE');assert.equal(p.journey.pendingField,null);
 assert.match(transition(p,'מה אתה יודע לעשות?').reply,/תמונות ומודעות/);assert.equal(p.journey.stage,'IDLE');
});
test('one free-form message fills business, product, region, goal and daily budget',()=>{
 const p=store.emptyProfile();transition(p,'אני מתקין פרגולות באזור נתניה ורוצה עוד לקוחות בתקציב של 100 שקל ביום');
 assert.equal(facts.value(p,'businessType'),'פרגולות');assert.equal(facts.value(p,'geography'),'נתניה');
 assert.equal(facts.value(p,'businessGoal'),'לקוחות חדשים');assert.deepEqual(facts.value(p,'dailyBudget'),{amount:100,currency:'ILS',period:'day'});
 const r=transition(p,'תכין לי קמפיין');assert.equal(p.journey.pendingField,'audience');assert.doesNotMatch(r.reply,/מה העסק|באיזה אזור|מה תקציב/);
});
test('five consecutive answers advance with no forced summary or continue checkpoint',()=>{
 const p=store.emptyProfile();transition(p,'אני רוצה לפרסם את העסק');
 for(const message of ['שירותי פרסום','מכירות','ניהול במטא','בעלי עסקים מכל התחומים','כל הארץ']){
  const r=transition(p,message);assert.doesNotMatch(r.reply,/שמרתי עד עכשיו|להמשיך\?/);assert.equal((r.reply.match(/\?/g)||[]).length,1);
 }
 assert.equal(p.journey.pendingField,'advantage');
});
test('clarification preserves pending field and the following answer resolves exactly it',()=>{
 const p=store.emptyProfile();transition(p,'נתחיל');transition(p,'פרסום');transition(p,'מכירות');
 assert.equal(p.journey.pendingField,'product');const before=JSON.stringify(p.answers);
 assert.match(transition(p,'מה הכוונה?').reply,/שירות אחד/);assert.equal(JSON.stringify(p.answers),before);
 transition(p,'ניהול במטא');assert.equal(facts.value(p,'product'),'ניהול קמפיינים ב-Meta');assert.equal(p.journey.pendingField,'audience');
});
test('an explicit summary includes budget and offer without overwriting the pending audience answer',()=>{
 const p=complete();facts.write(p,'offer','14 יום של ניהול קמפיין במתנה');journey.init(p);p.journey.stage='DISCOVERY';p.journey.pendingField='audience';
 const before=JSON.stringify(p.answers);const r=transition(p,'מה הבנת?');
 assert.match(r.reply,/100 ILS ליום/);assert.match(r.reply,/14 יום/);assert.equal(JSON.stringify(p.answers),before);assert.equal(p.journey.pendingField,'audience');
 transition(p,'לכל בעל עסק שרוצה להגדיל את ההכנסות');assert.equal(facts.value(p,'audience'),'בעלי עסקים שרוצים להגדיל הכנסות');
});
test('sales remains the business goal when a conversation acquisition path is recommended',()=>{
 const p=complete();const r=transition(p,'תכין אסטרטגיה');assert.match(r.reply,/המטרה נשארת מכירות/);assert.match(r.reply,/פנייה היא שלב/);assert.equal(facts.value(p,'businessGoal'),'מכירות');
});
test('contextual yes and continue lead from strategy to ads and then a local plan',()=>{
 const p=complete();transition(p,'תכין אסטרטגיה');assert.equal(p.journey.stage,'STRATEGY_REVIEW');
 const ads=transition(p,'כן');assert.equal(p.journey.stage,'CREATIVE_REVIEW');assert.match(ads.reply,/מודעה 1/);
 const plan=transition(p,'להמשיך');assert.equal(p.journey.stage,'PLAN_REVIEW');assert.match(plan.reply,/טיוטת תוכנית/);
 assert.equal(p.journey.draft.status,'LOCAL_DRAFT');assert.equal(p.journey.draft.requiresApproval,true);
 const confirmation=transition(p,'כן');assert.match(confirmation.reply,/אינו אישור להוצאה/);assert.notEqual(p.journey.stage,'ACTIVE');
});
test('an early request for an ad asks one essential missing question instead of losing the request',()=>{
 const p=store.emptyProfile();const r=transition(p,'תכין לי מודעה');assert.equal(p.journey.requestedOutput,'ad');assert.equal(p.journey.pendingField,'businessType');assert.equal((r.reply.match(/\?/g)||[]).length,1);
});
test('a plan can be prepared without a Meta connection and never claims publication',()=>{
 const p=complete();const r=transition(p,'תכין תוכנית קמפיין');assert.equal(p.journey.stage,'PLAN_REVIEW');assert.match(r.reply,/לא נוצר ולא הופעל/);assert.equal(p.connection,undefined);
});
test('the 14-day offer requires media, scope and commitment terms before being copied',()=>{
 const p=complete();transition(p,'תכין מודעה');let r=transition(p,'14 יום של ניהול קמפיין במתנה');assert.equal(p.journey.pendingField,'offerMediaSeparate');
 r=transition(p,'כן');assert.equal(p.journey.pendingField,'offerScope');
 r=transition(p,'ניהול קמפיין במטא במשך 14 יום');assert.equal(p.journey.pendingField,'offerCommitment');
 r=transition(p,'ללא התחייבות');assert.equal(p.journey.stage,'CREATIVE_REVIEW');assert.match(r.reply,/תקציב המדיה משולם בנפרד/);assert.match(r.reply,/ללא התחייבות/);assert.match(r.reply,/14 יום/);
});
test('unknown offer terms are kept unknown and the gift is excluded from publishable draft copy',()=>{
 const p=complete();facts.write(p,'offer','14 יום של ניהול קמפיין במתנה');
 transition(p,'תכין מודעה');transition(p,'לא יודע');transition(p,'לא יודע');transition(p,'לא יודע');
 assert.equal(p.journey.stage,'CREATIVE_REVIEW');assert.ok(p.journey.draft.missing.includes('תקציב מדיה נפרד מההטבה'));
 assert.ok(p.journey.draft.creatives.every(a=>!a.body.includes('במתנה')));
});
test('a correction updates only its field, preserves history and invalidates preceding review',()=>{
 const p=complete();transition(p,'תכין אסטרטגיה');transition(p,'כן');const before=facts.value(p,'audience');
 transition(p,'עדכן את התקציב ל-200 שקל ביום');assert.equal(facts.value(p,'dailyBudget').amount,200);assert.equal(facts.value(p,'audience'),before);
 assert.equal(facts.read(p,'dailyBudget').history.at(-1).value.amount,100);assert.equal(p.journey.strategyApproved,false);
});
test('a monthly or negative amount is never silently accepted as a daily budget',()=>{
 const p=complete();delete p.answers[facts.descriptor(p,'dailyBudget').address];transition(p,'תכין קמפיין');
 const before=facts.value(p,'dailyBudget');assert.match(transition(p,'3000 שקל בחודש').reply,/חודשי לא יהפוך/);assert.equal(facts.value(p,'dailyBudget'),before);
 assert.match(transition(p,'-100 שקל ביום').reply,/מה הסכום היומי/);assert.equal(facts.value(p,'dailyBudget'),null);
});
test('pause/resume and a reconstructed profile preserve facts across interruption',()=>{
 let p=store.emptyProfile();transition(p,'נתחיל');transition(p,'שירותי פרסום');transition(p,'עצור');const count=Object.keys(p.answers).length;
 p=JSON.parse(JSON.stringify(p));transition(p,'תמשיך מאיפה שעצרנו');assert.equal(Object.keys(p.answers).length,count);assert.equal(p.journey.pendingField,'businessGoal');
});
test('an unrelated question does not become the pending field answer',()=>{
 const p=store.emptyProfile();transition(p,'נתחיל');const before=JSON.stringify(p.answers);
 assert.equal(transition(p,'איך מכינים קפה?').handled,false);assert.equal(JSON.stringify(p.answers),before);assert.equal(p.journey.pendingField,'businessType');
});
test('creative feedback makes a targeted revision while leaving business facts intact',()=>{
 const p=complete();transition(p,'תכין מודעה');const original=p.journey.draft.creatives[0].body;
 transition(p,'לא אהבתי את המודעה');assert.equal(p.journey.pendingField,'creativeFeedback');
 const r=transition(p,'קצר יותר');assert.equal(p.journey.stage,'CREATIVE_REVIEW');assert.notEqual(p.journey.draft.creatives[0].body,original);assert.match(r.reply,/להכין תוכנית/);assert.equal(facts.value(p,'businessGoal'),'מכירות');
});
test('evidence validation rejects cross-tenant instructions, invented evidence and inferred monthly budget',()=>{
 assert.throws(()=>analysis.validateAnalysis({intent:'build',updates:[{field:'clientId',value:'other',evidence:'עסק'}]},'עסק'),/UNGROUNDED/);
 assert.throws(()=>analysis.validateAnalysis({intent:'build',updates:[{field:'product',value:'שירות',evidence:'לא נאמר'}]},'עסק'),/UNGROUNDED/);
 assert.throws(()=>analysis.validateAnalysis({intent:'build',updates:[{field:'dailyBudget',value:{amount:100,currency:'ILS',period:'month'},evidence:'3000'}]},'3000'),/INVALID_DAILY/);
});
test('provider failure preserves a pending question rather than storing an error or inventing facts',()=>{
 const p=store.emptyProfile();transition(p,'נתחיל');const r=transition(p,'פרטים ארוכים שלא פורשו',{analysis:{intent:'other',updates:[],analysisUnavailable:true}});
 assert.match(r.reply,/לא הצלחתי לפרש/);assert.equal(Object.keys(p.answers).length,0);assert.equal(p.journey.pendingField,'businessType');
});
test('feminine forms and explicit language preference are recognized without guessing gender',()=>{
 const p=store.emptyProfile();transition(p,'אני מתקינה פרגולות באזור נתניה ורוצה עוד לקוחות בתקציב של 100 שקל ביום');
 assert.equal(facts.value(p,'businessType'),'פרגולות');assert.equal(facts.value(p,'genderPreference'),null);
 transition(p,'דבר אליי בלשון נקבה');assert.equal(facts.value(p,'genderPreference'),'נקבה');
 assert.match(transition(p,'תכיני לי מודעה').reply,/מי הלקוחות/);
});
test('one owner is selected for legacy brief commands, active journey and lifecycle approvals',()=>{
 const choose=require('../conversationOwner').owner;
 assert.equal(choose({text:'/brief TRAFFIC',hasOpenBrief:true,profile:{journey:{stage:'PLAN_REVIEW'}}}),'brief');
 assert.equal(choose({text:'כן',hasOpenBrief:true,profile:{journey:{stage:'CREATIVE_REVIEW'}}}),'marketing');
 assert.equal(choose({text:'תשובה',hasOpenBrief:true,profile:null}),'brief');
 assert.equal(choose({text:'/campaign-activate hash',hasOpenBrief:true,profile:null}),'lifecycle');
});

test('a return greeting preserves the completed review stage and all context survives serialization',()=>{
 const p=complete();transition(p,'תכין תוכנית קמפיין');const budget=facts.value(p,'dailyBudget');
 const restored=JSON.parse(JSON.stringify(p));transition(restored,'היי');
 assert.equal(restored.journey.stage,'PLAN_REVIEW');assert.deepEqual(facts.value(restored,'dailyBudget'),budget);
 assert.match(facts.summary(restored),/יאיר דיגיטל/);assert.match(facts.summary(restored),/100 ILS/);
});
test('a provider cannot claim a daily budget using only monthly evidence or paraphrase a fact',()=>{
 assert.throws(()=>analysis.validateAnalysis({intent:'build',updates:[{field:'dailyBudget',value:{amount:100,currency:'ILS',period:'day'},evidence:'3000 שקל בחודש'}]},'3000 שקל בחודש'),/UNGROUNDED/);
 assert.throws(()=>analysis.validateAnalysis({intent:'build',updates:[{field:'advantage',value:'הכי טוב בישראל',evidence:'שירות אישי'}]},'שירות אישי'),/UNGROUNDED/);
});
