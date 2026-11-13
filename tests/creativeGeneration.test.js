'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const service=require('../creativeGeneration'),store=require('../marketingStore'),facts=require('../conversationFacts'),journey=require('../campaignJourney');
const copy=()=>({creatives:[{headline:'זר עם מחשבה',body:'זרי פרחים למי שרוצים לשמח.',cta:'ספרו לנו למי מיועד הזר.'},{headline:'פרחים לרגע שלכם',body:'בוחרים זרי פרחים לפי האירוע.',cta:'נדבר על הזר שמתאים לכם.'}]});
function draft(){const p=store.emptyProfile();journey.init(p);facts.write(p,'product','זרי פרחים');return{p,result:journey.transition(p,'טיוטה עם מה שיש')};}
test('AI drafts use actual business facts and preserve missing data and review requirements',async()=>{
 const {p,result}=draft();const r=await service.enrich(p,result,{writer:async input=>{assert.equal(input.facts.product,'זרי פרחים');return copy();}});
 assert.match(r.reply,/זר עם מחשבה/);assert.match(r.reply,/טיוטה ראשונית/);assert.equal(p.journey.draft.copySource,'ai_draft');assert.equal(p.journey.draft.requiresApproval,true);assert.equal(p.journey.draft.dailyBudget,null);
});
test('invalid copy, invented numbers, missing terms and duplicate variants are rejected',()=>{
 const c=copy();c.creatives[0].body+=' רק 99 שקל';assert.throws(()=>service.validate(c,'זרי פרחים'),/UNSUPPORTED_CREATIVE_NUMBER/);
 assert.throws(()=>service.validate(copy(),'פרחים',['ללא התחייבות']),/MISSING_CREATIVE_TERMS/);
 const same=copy();same.creatives[1]=same.creatives[0];assert.throws(()=>service.validate(same,'פרחים'),/DUPLICATE_CREATIVE_DRAFT/);
 assert.throws(()=>service.validate({creatives:[]},''),/INVALID_CREATIVE_DRAFT/);
});
test('provider failure keeps the existing draft without a false revision claim',async()=>{
 const {p,result}=draft(),before=JSON.stringify(p.journey.draft);
 assert.deepEqual(await service.enrich(p,result,{writer:async()=>{throw Error('unavailable');}}),result);assert.equal(JSON.stringify(p.journey.draft),before);
});
test('free-form feedback revises actual copy and invalidates old approvals only on success',async()=>{
 const {p,result}=draft();await service.enrich(p,result,{writer:async()=>copy()});
 p.journey.creativeApproved=true;p.journey.planApproved=true;
 const feedback='תשנה את הטון של המודעה שיהיה עדין ופחות מכירתי';
 const pending=journey.transition(p,feedback,{analysis:{intent:'ad',messageKind:'request',updates:[]}});
 const revision=p.journey.revision;
 const updated=await service.enrich(p,pending,{writer:async input=>{assert.equal(input.feedback,feedback);const c=copy();c.creatives[0].headline='מחשבה קטנה שמרגשת';return c;}});
 assert.match(updated.reply,/מחשבה קטנה/);assert.equal(p.journey.pendingField,null);assert.ok(p.journey.revision>revision);assert.equal(p.journey.creativeApproved,false);assert.equal(p.journey.planApproved,false);assert.equal(p.journey.draft.stale,false);
});
test('a greeting reuses approved-for-review AI text rather than silently generating new variants',async()=>{
 const {p,result}=draft();await service.enrich(p,result,{writer:async()=>copy()});let calls=0;
 const greeting=journey.transition(p,'היי');await service.enrich(p,greeting,{writer:async()=>{calls++;return copy();}});assert.equal(calls,0);
});
