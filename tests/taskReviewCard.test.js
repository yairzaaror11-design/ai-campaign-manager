'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const card=require('../taskReviewCard'),ui=require('../conversationUi');
const draft={objective:'פניות',audience:'משפחות צעירות',geography:'מרכז',placements:'פייסבוק ואינסטגרם',budgetNote:'לא נקבע',scheduleNote:'לא נקבע',headline:'דירה בלי עמלה',cta:'לפרטים',designBrief:'x'};
const view=(budgetNote)=>({status:'WAITING_REVIEW',artifacts:[{stepId:'d',title:'מודעה',content:'מחפשים דירה?\n\nטיוטת הגדרות',adContent:'מחפשים דירה? דברו איתנו',campaignDraft:{...draft,budgetNote},reviewed:false},{stepId:'i',title:'גרפיקה',content:'התמונה',mediaId:'m1',imageText:{headline:'דירה בלי עמלה',cta:'לפרטים'},reviewed:false}]});
test('campaign review: image carries ad copy, card is short, budget asked first',()=>{
 const r=card.build(view('לא נקבע'));
 assert.equal(r.mediaId,'m1');assert.equal(r.caption,'מחפשים דירה? דברו איתנו');
 assert.match(r.card,/תקציב: עוד לא נקבע/);assert.ok(r.missingBudget);assert.match(r.choices[0].text,/תקציב 30/);
 assert.doesNotMatch(r.card,/התמונה|תזמון/);assert.ok(r.card.length<1024);
 ui.payload(r.card,r.choices,'a'.repeat(24));
});
test('campaign review with budget offers approve, copy change and new image',()=>{
 const r=card.build(view('30 ₪ ליום'));
 assert.equal(r.missingBudget,false);assert.match(r.card,/30 ₪ ליום/);
 assert.deepEqual(r.choices.map(c=>c.text),['מאשר את התוכן','אני רוצה לשנות את נוסח המודעה','אני רוצה תמונה אחרת למודעה']);
 ui.payload(r.card,r.choices,'a'.repeat(24));
});
test('non campaign or non review tasks keep old delivery',()=>{
 assert.equal(card.build({status:'WAITING_APPROVAL',artifacts:view('x').artifacts}),null);
 assert.equal(card.build({status:'WAITING_REVIEW',artifacts:[{title:'t',content:'c'}]}),null);
});
test('approval summary is plain Hebrew without raw ids or JSON',()=>{
 const {createActionPlan,formatActionPlan}=require('../actionPlan');
 const text=formatActionPlan(createActionPlan({intent:'CREATE_BUNDLE',target:{accountId:'act_1',accountName:'Yair Digital'},parameters:{name:'n',objective:'OUTCOME_LEADS',dailyBudget:30,currency:'ILS',adSets:[{dailyBudget:30,targeting:{geo_locations:{countries:['IL']},age_min:25,age_max:55}}]}}));
 assert.match(text,/נדרש אישור מפורש/);assert.match(text,/פניות \(לידים\)/);assert.match(text,/ישראל · גילאי 25–55/);assert.match(text,/מושהה/);
 assert.doesNotMatch(text,/[{}\[\]]|act_1|CREATE_BUNDLE/);
});
