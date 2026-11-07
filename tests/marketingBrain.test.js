'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),brain=require('../marketingBrain');
const snapshot=campaigns=>({account:{id:'act_1',currency:'ILS'},preset:'last_7d',campaigns});
test('business analysis preserves missing outcomes and does not invent profitability or an action',()=>{
 const result=brain.analyze(snapshot([{campaign_id:'1',spend:'100',clicks:'10',impressions:'1000'}]));
 assert.equal(result.totals.leads,null);assert.equal(result.totals.purchases,null);assert.equal(result.externalActionsExecuted,false);
 assert.ok(result.observations.some(x=>x.includes('רווחיות')));assert.ok(result.observations.some(x=>x.includes('לא הוגדר יעד')));
});
test('overlapping Meta action types are selected in precedence order and never summed twice',()=>{
 const result=brain.analyze(snapshot([{spend:'200',clicks:'10',impressions:'1000',actions:[{action_type:'lead',value:'4'},{action_type:'offsite_conversion.fb_pixel_lead',value:'4'},{action_type:'purchase',value:'1'}]}]),{targetCpl:40});
 assert.equal(result.totals.leads,4);assert.equal(result.campaigns[0].cpl,50);assert.equal(result.recommendations[0].kind,'REVIEW_CPL');assert.equal(result.recommendations[0].requiresApproval,true);
});
test('spend review uses an explicit configured limit and zero outcomes do not trigger an automatic stop',()=>{
 const result=brain.analyze(snapshot([{spend:'220',actions:[]}]),{reviewSpendLimit:200});
 assert.equal(result.totals.leads,0);assert.equal(result.recommendations[0].kind,'DIAGNOSE');assert.ok(result.recommendations.some(x=>x.kind==='REVIEW_SPEND'));
 assert.equal(brain.analyze(snapshot([{spend:'220',actions:[]}])).recommendations.some(x=>x.kind==='REVIEW_SPEND'),false);
});
test('invalid numeric data fails closed and totals never hide partial metric coverage',()=>{
 assert.throws(()=>brain.analyze(snapshot([{spend:'NaN'}])),/INVALID/);assert.throws(()=>brain.analyze(snapshot([{spend:'-1'}])),/INVALID/);
 assert.equal(brain.analyze(snapshot([{spend:'100',actions:[]},{spend:'10'}])).totals.leads,null);
});
