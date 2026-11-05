'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),meta=require('../metaConnection'),engine=require('../businessCase');
function run(operation,values,source,extra={}){
 const fields=Object.entries(values).map(([key,value])=>({key,value:String(value),evidence:source}));
 return meta.context.run('11',()=>engine.analyze({operation,fields,...(Object.keys(values).some(k=>engine.TYPES[k]==='money')?{currency:{value:'ILS',evidence:source}}:{}),...extra},{clientId:'11',taskId:'synthetic',sources:[source]}));
}
const value=(r,key)=>r.metrics[key].value;
test('documented unit economics: hypothetical weighted repeat income stays separate from realized cash',()=>{
 const r=run('unit_economics',{pricePerJob:600,variableCostPerJob:350,singlePurchaseSharePercent:50,repeatGroupAverageOrders:'4.5'},'מחיר 600 ₪, עלות משתנה 350 ₪. בהנחה ש-50% קונים פעם אחת והיתר 4.5 עבודות בממוצע.');
 assert.equal(value(r,'incomeAfterVariableCostsPerJob'),'250.00');assert.equal(value(r,'assumedOrdersPerCustomer'),'2.7500');assert.equal(value(r,'estimatedLifetimeIncomeAfterVariableCosts'),'687.50');assert.equal(r.externalActionsExecuted,false);assert.match(r.limitations.join(' '),/אינה כסף שהתקבל/);
});
test('period accounting separates ROAS, after-cost balance, paying-customer CAC and unknown cash',()=>{
 const r=run('period_economics',{adSpend:3000,attributedRevenue:12000,variableCostsExcludingMedia:7800,newCustomers:8},'בחודש נובמבר: פרסום 3,000 ₪, הכנסה משויכת 12,000 ₪, עלויות ללא פרסום 7,800 ₪, 8 לקוחות חדשים משלמים.',{period:{value:'נובמבר',evidence:'בחודש נובמבר'}});
 assert.equal(value(r,'roas'),'4.0000');assert.equal(value(r,'incomeAfterVariableCosts'),'4200.00');assert.equal(value(r,'balanceAfterMediaBeforeOtherCosts'),'1200.00');assert.equal(value(r,'cac'),'375.00');assert.equal(value(r,'cashReceived'),null);assert.equal(r.period,'נובמבר');assert.equal(r.source,'OWNER_REPORTED_NOT_VERIFIED');
});
test('scaling uses marginal CAC and the stated lifetime assumption without promising a causal response',()=>{
 const r=run('scaling',{oldAdSpend:3000,newAdSpend:6000,oldNewCustomers:5,newNewCustomers:8,expectedIncomePerCustomer:'687.50'},'הוצאה קודמת 3000 ₪ עם 5 לקוחות; הוצאה חדשה 6000 ₪ עם 8 לקוחות. הנחת הכנסה לחיי לקוח אחרי עלויות: 687.50 ₪.');
 assert.equal(value(r,'oldAverageCac'),'600.00');assert.equal(value(r,'newAverageCac'),'750.00');assert.equal(value(r,'marginalCac'),'1000.00');assert.equal(value(r,'estimatedOldLifetimeBalanceBeforeOtherCosts'),'437.50');assert.equal(value(r,'estimatedNewLifetimeBalanceBeforeOtherCosts'),'-500.00');assert.equal(value(r,'estimatedIncrementalLifetimeBalanceBeforeOtherCosts'),'-937.50');assert.equal(r.causalConclusion,false);assert.equal(r.requiresApprovalForChanges,true);
});
test('period labels require exact owner wording; unknown stays explicit and invalid metadata has a recoverable question',()=>{
 const source='הוצאה קודמת 3000 ₪ עם 5 לקוחות, הוצאה חדשה 6000 ₪ עם 8 לקוחות. כל תקופה של 30 יום.';
 const values={oldAdSpend:3000,newAdSpend:6000,oldNewCustomers:5,newNewCustomers:8};
 assert.throws(()=>run('scaling',values,source,{period:{value:'שתי תקופות של חודש',evidence:source}}),/BUSINESS_PERIOD_NOT_CONFIRMED/);
 assert.match(engine.inputQuestion('BUSINESS_PERIOD_NOT_CONFIRMED'),/לאיזו תקופה/);
 const exact=run('scaling',values,source,{period:{value:'30 יום',evidence:'כל תקופה של 30 יום'}});assert.equal(exact.period,'30 יום');assert.equal(value(exact,'marginalCac'),'1000.00');
 const unknown=run('scaling',values,source);assert.equal(unknown.period,'UNKNOWN');assert.equal(value(unknown,'marginalCac'),'1000.00');assert.match(unknown.limitations.join(' '),/טווח הזמן/);
});
test('campaign comparison reports point estimates but cannot manufacture statistical or causal winners',()=>{
 const r=run('campaign_comparison',{spendA:800,leadsA:20,customersA:4,spendB:800,leadsB:25,customersB:2},'A: הוצאה 800 ₪, 20 פניות, 4 לקוחות. B: הוצאה 800 ₪, 25 פניות, 2 לקוחות.');
 assert.equal(value(r,'cplA'),'40.00');assert.equal(value(r,'cplB'),'32.00');assert.equal(value(r,'cacA'),'200.00');assert.equal(value(r,'cacB'),'400.00');assert.equal(r.causalConclusion,false);assert.match(r.limitations.join(' '),/לא נקבע מנצח/);
});
test('B2B opportunities are not customers and a zero denominator stays unknown',()=>{
 const r=run('b2b_pipeline',{adSpend:8000,leads:40,qualifiedAccounts:12,opportunities:3,newCustomers:0},'פרסום 8000 ₪, 40 פניות, 12 חברות מתאימות, 3 הזדמנויות, 0 לקוחות משלמים.');assert.equal(value(r,'costPerOpportunity'),'2666.67');assert.equal(value(r,'cac'),null);
});
test('capacity preserves the last seat; churn and unmet demand do not prove causes or forecasts',()=>{
 const r=run('capacity',{capacity:100,occupied:99},'קיבולת 100, תפוסה 99.');assert.equal(value(r,'remainingCapacity'),'1');assert.equal(value(r,'occupancy'),'0.9900');
 assert.equal(value(run('capacity',{capacity:100,occupied:100},'קיבולת 100, תפוסה 100.'),'remainingCapacity'),'0');
 const cohort=run('retention',{cohortStart:100,cohortRetained:60},'התחילו 100, נשארו 60.');assert.equal(value(cohort,'churn'),'0.4000');assert.match(cohort.limitations.join(' '),/לא חושב LTV/);
 const season=run('seasonality',{fulfilledRequests:20,rejectedRequests:30},'בוצעו 20 בקשות, נדחו 30 בקשות.');assert.equal(value(season,'reportedServiceRequests'),'50');assert.equal(value(season,'reportedUnservedRequests'),'30');assert.match(season.limitations.join(' '),/לא בהכרח לקוחות ייחודיים/);
});
test('long sales cycles do not assign arbitrary money to meetings; cold-start CPC stays an explicit assumption',()=>{
 const long=run('long_cycle',{appointments:14,closedDeals:0,observedDays:60,historicCycleDays:75},'14 פגישות, 0 עסקאות, 60 ימי תצפית, 75 ימים במחזור ההיסטורי.');assert.equal(value(long,'appointments'),'14');assert.match(long.limitations.join(' '),/אין שווי כספי אוטומטי/);
 const cold=run('cold_start',{learningBudget:2500,days:30,assumedCpcLow:8,assumedCpcHigh:18},'תקציב למידה 2500 ₪ ל-30 ימים, הנחת CPC בין 8 ל-18 ₪.');assert.equal(value(cold,'dailyMathematicalAverage'),'83.33');assert.equal(value(cold,'illustrativeClicksLow'),'138.8889');assert.equal(value(cold,'illustrativeClicksHigh'),'312.5000');
});
test('missing data asks one question; invented figures, other tenants, ambiguous currencies and negative evidence are rejected',()=>{
 const r=run('capacity',{},'אין לי כרגע נתונים.');assert.equal(r.status,'NEEDS_INPUT');assert.deepEqual(r.missing,['capacity','occupied']);assert.match(r.nextQuestion,/קיבולת/);assert.equal(r.metrics,undefined);
 assert.throws(()=>run('capacity',{capacity:100,occupied:99},'קיבולת 50, תפוסה 40.'),/VALUE_NOT_IN_EVIDENCE/);
 assert.throws(()=>run('capacity',{capacity:100,occupied:99},'קיבולת -100, תפוסה -99.'),/VALUE_NOT_IN_EVIDENCE/);
 assert.throws(()=>run('capacity',{capacity:100,occupied:101},'קיבולת 100 תפוסה 101.'),/EXCEEDS/);
 assert.throws(()=>run('unit_economics',{pricePerJob:'0.001',variableCostPerJob:0},'מחיר 0.001 ₪ ועלות 0 ₪.'),/PRECISION/);
 assert.throws(()=>run('unit_economics',{pricePerJob:100,variableCostPerJob:50},'מחיר 100 ועלות 50 $',{currency:{value:'USD',evidence:'מחיר 100 ועלות 50 $'}}),/CURRENCY_NOT_CONFIRMED/);
 assert.throws(()=>run('period_economics',{adSpend:100,attributedRevenue:600,variableCostsExcludingMedia:200},'הוצאה 100 USD, הכנסה 600 ₪, עלויות 200 ₪.'),/CURRENCY_AMBIGUOUS/);
 assert.throws(()=>run('period_economics',{adSpend:100,attributedRevenue:600,variableCostsExcludingMedia:200},'הוצאה 100 JPY, הכנסה 600 ₪, עלויות 200 ₪.'),/CURRENCY_AMBIGUOUS/);
 assert.throws(()=>run('constructor',{},'בדיקה'),/INVALID_BUSINESS_OPERATION/);
 assert.throws(()=>run('unit_economics',{pricePerJob:100,variableCostPerJob:50},'מחיר 100 ועלות 50 ₪',{currency:{value:'constructor',evidence:'₪'}}),/CURRENCY_NOT_CONFIRMED/);
 assert.throws(()=>meta.context.run('22',()=>engine.analyze({operation:'capacity',fields:[]},{clientId:'11',sources:['קיבולת 100']})),/CONTEXT_REQUIRED/);
 assert.throws(()=>engine.analyze({operation:'capacity',fields:[]},{sources:[]}),/CONTEXT_REQUIRED/);
 assert.throws(()=>run('capacity',{capacity:100,occupied:99},'קיבולת 100 תפוסה 99.',{clientId:'22'}),/INVALID_BUSINESS_OPERATION/);
});
