'use strict';
const professional=require('./professionalContext'),meta=require('./metaConnection');
const TYPES={
 pricePerJob:'money',variableCostPerJob:'money',singlePurchaseSharePercent:'percent',repeatGroupAverageOrders:'quantity',
 adSpend:'money',attributedRevenue:'money',variableCostsExcludingMedia:'money',newCustomers:'count',cashReceived:'money',
 oldAdSpend:'money',newAdSpend:'money',oldNewCustomers:'count',newNewCustomers:'count',expectedIncomePerCustomer:'money',
 spendA:'money',leadsA:'count',customersA:'count',spendB:'money',leadsB:'count',customersB:'count',
 leads:'count',qualifiedAccounts:'count',opportunities:'count',capacity:'count',occupied:'count',
 cohortStart:'count',cohortRetained:'count',fulfilledRequests:'count',rejectedRequests:'count',appointments:'count',closedDeals:'count',observedDays:'count',historicCycleDays:'count',
 learningBudget:'money',days:'count',assumedCpcLow:'money',assumedCpcHigh:'money'
};
const OPS={
 unit_economics:{required:['pricePerJob','variableCostPerJob'],optional:['singlePurchaseSharePercent','repeatGroupAverageOrders'],skill:'MKT-15'},
 period_economics:{required:['adSpend','attributedRevenue','variableCostsExcludingMedia'],optional:['newCustomers','cashReceived'],skill:'MKT-15'},
 scaling:{required:['oldAdSpend','newAdSpend','oldNewCustomers','newNewCustomers'],optional:['expectedIncomePerCustomer'],skill:'MKT-06'},
 campaign_comparison:{required:['spendA','leadsA','customersA','spendB','leadsB','customersB'],optional:[],skill:'MKT-05'},
 b2b_pipeline:{required:['adSpend','opportunities'],optional:['leads','qualifiedAccounts','newCustomers'],skill:'MKT-12'},
 capacity:{required:['capacity','occupied'],optional:[],skill:'MKT-13'},
 retention:{required:['cohortStart','cohortRetained'],optional:[],skill:'MKT-10'},
 seasonality:{required:['fulfilledRequests','rejectedRequests'],optional:[],skill:'MKT-14'},
 long_cycle:{required:['appointments','closedDeals'],optional:['adSpend','observedDays','historicCycleDays'],skill:'MKT-11'},
 cold_start:{required:['learningBudget','days'],optional:['assumedCpcLow','assumedCpcHigh'],skill:'MKT-09'}
};
const LABELS={pricePerJob:'מה המחיר לעבודה?',variableCostPerJob:'מה העלות המשתנה לעבודה, בלי פרסום?',adSpend:'כמה הוצא על פרסום בתקופה הזו?',attributedRevenue:'מה ההכנסה המשויכת לאותה תקופה?',variableCostsExcludingMedia:'מה העלויות המשתנות, ללא פרסום?',oldAdSpend:'מה ההוצאה בתקופה הראשונה?',newAdSpend:'מה ההוצאה בתקופה השנייה?',oldNewCustomers:'כמה לקוחות חדשים משלמים היו בתקופה הראשונה?',newNewCustomers:'כמה לקוחות חדשים משלמים היו בתקופה השנייה?',opportunities:'כמה הזדמנויות מכירה נוצרו?',capacity:'מה הקיבולת הכוללת?',occupied:'כמה מקומות כבר תפוסים?',cohortStart:'כמה לקוחות היו בקבוצת ההתחלה?',cohortRetained:'כמה מהם נשארו באותה תקופת תצפית?',fulfilledRequests:'כמה בקשות שירות בוצעו?',rejectedRequests:'כמה בקשות שירות נדחו?',appointments:'כמה פגישות התקיימו?',closedDeals:'כמה עסקאות נסגרו?',learningBudget:'מה תקציב ניסוי הלמידה?',days:'לכמה ימים מיועד התקציב?'};
const CURRENCY={ILS:/₪|שקל|ש["״']?ח|\bILS\b/i,USD:/\bUSD\b|דולר אמריקאי/i,EUR:/€|אירו|\bEUR\b/i,GBP:/£|ליש["״']?ט|\bGBP\b/i};
const DETECT_CURRENCY={...CURRENCY,JPY:/¥|\bJPY\b|ין יפני/i,CAD:/\bCAD\b|דולר קנדי/i,AUD:/\bAUD\b|דולר אוסטרלי/i,KRW:/\bKRW\b|וון קוריאני/i,CHF:/\bCHF\b|פרנק שוויצרי/i};
function normalized(value){
 if(typeof value!=='string'||value.length>32||!/^\d+(?:\.\d+)?$|^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(value))throw Error('INVALID_BUSINESS_NUMBER');
 return value.replace(/,/g,'').replace(/^0+(?=\d)/,'');
}
function scaled(value,digits){
 const n=normalized(value),[whole,part='']=n.split('.');if(part.length>digits)throw Error('BUSINESS_NUMBER_PRECISION');
 const result=BigInt(whole)*10n**BigInt(digits)+BigInt(part.padEnd(digits,'0')||'0');
 if(result>100000000000000n)throw Error('BUSINESS_NUMBER_LIMIT');return result;
}
function decimal(n,d=1n,places=2){
 if(d===0n)return null;const negative=(n<0n)!==(d<0n),a=n<0n?-n:n,b=d<0n?-d:d,p=10n**BigInt(places);
 const v=(a*p+b/2n)/b,whole=v/p,part=(v%p).toString().padStart(places,'0');return(negative&&v!==0n?'-':'')+whole+(places?'.'+part:'');
}
function evidence(text,sources){if(typeof text!=='string'||!text.trim()||text.length>300||!sources.some(s=>s.includes(text)))throw Error('BUSINESS_EVIDENCE_REQUIRED');return text;}
function checked(input,scope){
 if(!scope||!scope.clientId||!meta.context.getStore()||String(scope.clientId)!==String(meta.context.getStore())||!Array.isArray(scope.sources))throw Error('BUSINESS_ANALYSIS_CONTEXT_REQUIRED');
 if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['operation','fields','currency','period'].includes(k))||!Object.prototype.hasOwnProperty.call(OPS,input.operation))throw Error('INVALID_BUSINESS_OPERATION');
 if(!Array.isArray(input.fields)||input.fields.length>16)throw Error('INVALID_BUSINESS_FIELDS');
 const allowed=[...OPS[input.operation].required,...OPS[input.operation].optional],values={},provenance=[];
 for(const f of input.fields){
  if(!f||Object.keys(f).some(k=>!['key','value','evidence'].includes(k))||!allowed.includes(f.key)||values[f.key]!==undefined)throw Error('INVALID_BUSINESS_FIELD');
  const quote=evidence(f.evidence,scope.sources),n=normalized(f.value);
  const numericQuote=quote.replace(/(^|\s)([ובלכמשה]{1,3})-(?=\d)/g,'$1$2 ');
  const tokens=(numericQuote.match(/[+-]?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/g)||[]).filter(t=>!t.startsWith('-')).map(t=>t.replace(/^\+/,''));
  if(!tokens.some(t=>scaled(t,Math.max((t.split('.')[1]||'').length,(n.split('.')[1]||'').length))===scaled(n,Math.max((t.split('.')[1]||'').length,(n.split('.')[1]||'').length))))throw Error('BUSINESS_VALUE_NOT_IN_EVIDENCE');
  const type=TYPES[f.key],digits=type==='money'||type==='percent'?2:type==='quantity'?4:0;
  values[f.key]=scaled(n,digits);
  if(type==='percent'&&values[f.key]>10000n||type==='count'&&values[f.key]>10000000n||type==='quantity'&&values[f.key]>10000000000n)throw Error('BUSINESS_NUMBER_LIMIT');
  provenance.push({key:f.key,value:n,evidence:quote,source:'OWNER_REPORTED_NOT_VERIFIED'});
 }
 const moneyFields=OPS[input.operation].required.some(k=>TYPES[k]==='money')||input.fields.some(f=>TYPES[f.key]==='money');let currency=null,period=null;
 if(moneyFields&&input.currency){
  if(Object.keys(input.currency).some(k=>!['value','evidence'].includes(k))||!Object.prototype.hasOwnProperty.call(CURRENCY,input.currency.value)||!CURRENCY[input.currency.value].test(evidence(input.currency.evidence,scope.sources)))throw Error('BUSINESS_CURRENCY_NOT_CONFIRMED');currency=input.currency.value;
 }
 if(currency){
  const sourceCurrencies=new Set(scope.sources.flatMap(text=>Object.entries(DETECT_CURRENCY).filter(([,regex])=>regex.test(text)).map(([code])=>code)));
  for(const field of provenance.filter(f=>TYPES[f.key]==='money')){
   const mentions=Object.entries(DETECT_CURRENCY).filter(([,regex])=>regex.test(field.evidence)).map(([code])=>code);
   if(mentions.length>1||!mentions.length&&sourceCurrencies.size>1)throw Error('BUSINESS_CURRENCY_AMBIGUOUS');
   if(mentions.length===1&&mentions[0]!==currency)throw Error('BUSINESS_CURRENCY_MISMATCH');
  }
 }
 if(input.period){if(typeof input.period.value!=='string'||input.period.value.length>100||!evidence(input.period.evidence,scope.sources).includes(input.period.value))throw Error('BUSINESS_PERIOD_NOT_CONFIRMED');period=input.period.value;}
 return{values,provenance,currency,period,moneyFields};
}
function analyze(input,scope=professional.context.getStore()){
 const {values:v,provenance,currency,period,moneyFields}=checked(input,scope),op=OPS[input.operation];
 const missing=op.required.filter(k=>v[k]===undefined);if(moneyFields&&!currency)missing.push('currency');
 const base={operation:input.operation,skill:op.skill,source:'OWNER_REPORTED_NOT_VERIFIED',period:period||'UNKNOWN',currency,externalActionsExecuted:false,requiresApprovalForChanges:true,causalConclusion:false,provenance};
 if(missing.length)return{...base,status:'NEEDS_INPUT',missing,nextQuestion:missing[0]==='currency'?'באיזה מטבע נמסרו הסכומים?':LABELS[missing[0]]||'מה הערך של '+missing[0]+'?'};
 const metrics={},limitations=['הנתונים נמסרו בשיחה ולא אומתו מול הנהלת חשבונות או CRM.','החישוב אינו אישור לשינוי תקציב ואינו הוכחה לסיבתיות.'];
 if(!period)limitations.push('טווח הזמן וההתאמה בין מקורות הנתונים טרם אומתו.');
 const money=(key,n,d=1n)=>{metrics[key]={value:n===null?null:decimal(n,d*100n),unit:currency};};
 const ratio=(key,n,d)=>{metrics[key]={value:decimal(n,d,4),unit:'ratio'};};
 const count=(key,n)=>{metrics[key]={value:n===null?null:n.toString(),unit:'count'};};
 if(input.operation==='unit_economics'){
  const margin=v.pricePerJob-v.variableCostPerJob;money('incomeAfterVariableCostsPerJob',margin);
  if(v.singlePurchaseSharePercent!==undefined&&v.repeatGroupAverageOrders!==undefined){
   if(v.repeatGroupAverageOrders<10000n)throw Error('INVALID_REPEAT_PURCHASE_ASSUMPTION');
   const numerator=v.singlePurchaseSharePercent*10000n+(10000n-v.singlePurchaseSharePercent)*v.repeatGroupAverageOrders,denominator=100000000n;
   ratio('assumedOrdersPerCustomer',numerator,denominator);money('estimatedLifetimeIncomeAfterVariableCosts',margin*numerator,denominator);
   limitations.push('הערכת חיי לקוח לפי חלוקת ההזמנות שנמסרה בלבד; לפני פרסום, הוצאות אחרות והיוון. אינה כסף שהתקבל.');
  }
 }else if(input.operation==='period_economics'){
  money('incomeAfterVariableCosts',v.attributedRevenue-v.variableCostsExcludingMedia);money('balanceAfterMediaBeforeOtherCosts',v.attributedRevenue-v.variableCostsExcludingMedia-v.adSpend);
  ratio('roas',v.attributedRevenue,v.adSpend);money('cac',v.newCustomers===undefined||v.newCustomers===0n?null:v.adSpend,v.newCustomers||1n);money('cashReceived',v.cashReceived??null);
  limitations.push('הכנסה משויכת אינה כסף שהתקבל. יתרה אחרי העלויות שנמסרו אינה רווח נקי; טיפול בהחזרים ומסים לא אומת.');
 }else if(input.operation==='scaling'){
  money('oldAverageCac',v.oldNewCustomers===0n?null:v.oldAdSpend,v.oldNewCustomers||1n);money('newAverageCac',v.newNewCustomers===0n?null:v.newAdSpend,v.newNewCustomers||1n);
  const ds=v.newAdSpend-v.oldAdSpend,dc=v.newNewCustomers-v.oldNewCustomers;money('additionalSpend',ds);count('additionalCustomers',dc);money('marginalCac',ds>0n&&dc>0n?ds:null,dc>0n?dc:1n);
  if(v.expectedIncomePerCustomer!==undefined){money('estimatedOldLifetimeBalanceBeforeOtherCosts',v.oldNewCustomers*v.expectedIncomePerCustomer-v.oldAdSpend);money('estimatedNewLifetimeBalanceBeforeOtherCosts',v.newNewCustomers*v.expectedIncomePerCustomer-v.newAdSpend);money('estimatedIncrementalLifetimeBalanceBeforeOtherCosts',dc*v.expectedIncomePerCustomer-ds);}
  limitations.push('השוואת תקופות אינה ניסוי סיבתי. תחזית חיי לקוח אינה תזרים נוכחי. הגדלה מחייבת גם בדיקת קיבולת ותזרים ואישור נפרד.');
 }else if(input.operation==='campaign_comparison'){
  for(const suffix of ['A','B']){money('cpl'+suffix,v['leads'+suffix]===0n?null:v['spend'+suffix],v['leads'+suffix]||1n);money('cac'+suffix,v['customers'+suffix]===0n?null:v['spend'+suffix],v['customers'+suffix]||1n);}
  limitations.push('לא חושבה מובהקות ולא נקבע מנצח. נדרשים תכנון ניסוי, מדגם, אקראיות והבשלה מתאימים; אין סף עסקאות אוניברסלי.');
 }else if(input.operation==='b2b_pipeline'){
  money('costPerOpportunity',v.opportunities===0n?null:v.adSpend,v.opportunities||1n);money('cac',v.newCustomers===undefined||v.newCustomers===0n?null:v.adSpend,v.newCustomers||1n);
  limitations.push('הזדמנות אינה לקוח משלם. אין שווי צבר או הסתברות סגירה בלי כיול והכנסה מאומתת; אין ספירת הכנסה לכל שלב.');
 }else if(input.operation==='capacity'){
  if(v.occupied>v.capacity)throw Error('OCCUPIED_EXCEEDS_CAPACITY');count('remainingCapacity',v.capacity-v.occupied);ratio('occupancy',v.occupied,v.capacity);
  limitations.push('מקום אחרון הוא עדיין קיבולת. תפוסה לבדה אינה הוראה לכיבוי או העברת תקציב.');
 }else if(input.operation==='retention'){
  if(v.cohortRetained>v.cohortStart)throw Error('RETAINED_EXCEEDS_COHORT');count('lostFromCohort',v.cohortStart-v.cohortRetained);ratio('retention',v.cohortRetained,v.cohortStart);ratio('churn',v.cohortStart-v.cohortRetained,v.cohortStart);
  limitations.push('יש לאמת תקופת תצפית והבשלה. לא חושב LTV; נתוני נטישה אינם מוכיחים סיבה או כשל מסר.');
 }else if(input.operation==='seasonality'){
  count('reportedServiceRequests',v.fulfilledRequests+v.rejectedRequests);count('reportedUnservedRequests',v.rejectedRequests);ratio('unservedRequestShare',v.rejectedRequests,v.fulfilledRequests+v.rejectedRequests);
  limitations.push('אלה בקשות מדווחות, לא בהכרח לקוחות ייחודיים. אין תחזית ביקוש מאומתת בלי היסטוריה ובדיקת חיזוי.');
 }else if(input.operation==='long_cycle'){
  count('appointments',v.appointments);count('closedDeals',v.closedDeals);if(v.adSpend!==undefined)money('costPerAppointment',v.appointments===0n?null:v.adSpend,v.appointments||1n);
  limitations.push('לפגישה אין שווי כספי אוטומטי. אפס סגירות אינו לבדו הוכחת כשל או הצלחה; יש לבדוק שלב, גיל ומחזור מכירה.');
 }else if(input.operation==='cold_start'){
  if(v.days===0n)throw Error('INVALID_LEARNING_PERIOD');money('dailyMathematicalAverage',v.learningBudget,v.days);
  if(v.assumedCpcLow!==undefined&&v.assumedCpcHigh!==undefined){if(v.assumedCpcLow===0n||v.assumedCpcHigh<v.assumedCpcLow)throw Error('INVALID_CPC_ASSUMPTION');ratio('illustrativeClicksLow',v.learningBudget,v.assumedCpcHigh);ratio('illustrativeClicksHigh',v.learningBudget,v.assumedCpcLow);}
  limitations.push('ממוצע מתמטי אינו הגדרת קמפיין או הוצאה מאושרת. CPC שהוזן הוא הנחה ולא תחזית ספק; אין הבטחת לקוחות.');
 }
 return{...base,status:'CALCULATED_FROM_REPORTED_INPUTS',metrics,limitations};
}
function format(result){
 if(result.status==='NEEDS_INPUT')return result.nextQuestion;
 const get=key=>result.metrics[key]?.value,unit=result.currency==='ILS'?'₪':result.currency||'',money=key=>get(key)===null||get(key)===undefined?'לא ידוע':get(key)+' '+unit;
 const percent=key=>get(key)===null?'לא ידוע':decimal(scaled(get(key),4)*100n,10000n,2)+'%';
 switch(result.operation){
  case 'unit_economics':return 'לפי הנתונים שמסרת, ההכנסה אחרי העלויות המשתנות היא '+money('incomeAfterVariableCostsPerJob')+' לעבודה. '+(get('estimatedLifetimeIncomeAfterVariableCosts')?'לפי הנחת הרכישות החוזרות, ההכנסה הצפויה לחיי לקוח היא '+money('estimatedLifetimeIncomeAfterVariableCosts')+' לפני פרסום, הוצאות אחרות והיוון. ':'')+'זו אינה הכנסה שהתקבלה בפועל או רווח נקי.';
  case 'period_economics':return 'לפי הנתונים שמסרת, היתרה אחרי עלויות משתנות ופרסום היא '+money('balanceAfterMediaBeforeOtherCosts')+', לפני הוצאות נוספות. ROAS הוא '+(get('roas')??'לא ידוע')+'; כסף שהתקבל בפועל: '+money('cashReceived')+'. הנתונים לא אומתו מול הנהלת חשבונות, והיתרה אינה רווח נקי.';
  case 'scaling':return 'לפי הנתונים שמסרת, העלות השולית ללקוח חדש היא '+money('marginalCac')+', לעומת עלות ממוצעת חדשה של '+money('newAverageCac')+'. '+(get('estimatedIncrementalLifetimeBalanceBeforeOtherCosts')?'לפי הנחת חיי הלקוח, התוספת הצפויה ליתרה היא '+money('estimatedIncrementalLifetimeBalanceBeforeOtherCosts')+' לפני עלויות נוספות. ':'יש לבדוק גם הכנסה אחרי עלויות משתנות, קיבולת ותזרים. ')+'זו השוואת דיווחים ואינה הוכחה סיבתית; לא שיניתי תקציב.';
  case 'campaign_comparison':return 'לפי הנתונים שמסרת, העלות ללקוח משלם היא '+money('cacA')+' ב-A ו-'+money('cacB')+' ב-B. אלה אומדנים נקודתיים ולא הוכחה למנצח. לא חושבה מובהקות סטטיסטית ולא בוצע שינוי.';
  case 'b2b_pipeline':return 'לפי הנתונים שמסרת, העלות להזדמנות מכירה היא '+money('costPerOpportunity')+'; עלות ללקוח משלם: '+money('cac')+'. הזדמנות אינה לקוח משלם. לא חושבו הכנסה או הסתברות סגירה שלא מסרת.';
  case 'capacity':return 'לפי הנתונים שמסרת, נותרו '+get('remainingCapacity')+' מקומות; התפוסה היא '+percent('occupancy')+'. גם מקום אחרון הוא עדיין קיבולת זמינה. לא שיניתי פרסום או תקציב.';
  case 'retention':return 'לפי הנתונים שמסרת, שיעור הנטישה בקבוצה הוא '+percent('churn')+'. יש לוודא שמדובר באותה קבוצת התחלה ותקופת תצפית שהבשילה. הנתון לבדו אינו מוכיח כשל קריאייטיב או מאפשר חישוב LTV.';
  case 'seasonality':return 'דיווחת על '+get('reportedServiceRequests')+' בקשות שירות, מהן '+get('reportedUnservedRequests')+' שלא נענו. אין כאן אימות למספר לקוחות ייחודיים או תחזית ביקוש. כדאי להבחין בין ביקוש לבין היכולת לבצע את השירות.';
  case 'long_cycle':return 'דיווחת על '+get('appointments')+' פגישות ו-'+get('closedDeals')+' עסקאות סגורות. אלה אינם מוכיחים לבדם הצלחה או כישלון, ולפגישות לא הוקצה שווי כספי מומצא. צריך לבדוק שלבי עסקאות, גיל ומחזור מכירה.';
  case 'cold_start':return 'הממוצע המתמטי לתקציב ולתקופה שמסרת הוא '+money('dailyMathematicalAverage')+' ליום. '+(get('illustrativeClicksLow')?'טווח ההקלקות לפי הנחת ה-CPC בלבד הוא '+get('illustrativeClicksLow')+'–'+get('illustrativeClicksHigh')+'. ':'')+'אין כאן תחזית ספק, הבטחת לקוחות או אישור להוצאה.';
  default:throw Error('INVALID_BUSINESS_OPERATION');
 }
}
function inputQuestion(code){
 if(code==='BUSINESS_PERIOD_NOT_CONFIRMED')return 'לאיזו תקופה מתייחסים הנתונים שתרצה להשוות?';
 if(['BUSINESS_CURRENCY_NOT_CONFIRMED','BUSINESS_CURRENCY_AMBIGUOUS','BUSINESS_CURRENCY_MISMATCH'].includes(code))return 'באיזה מטבע נמסר כל סכום שתרצה להשוות?';
 if(['BUSINESS_EVIDENCE_REQUIRED','BUSINESS_VALUE_NOT_IN_EVIDENCE'].includes(code))return 'לא הצלחתי להתאים בביטחון את הנתונים לחישוב. אפשר למסור את הסכומים והתקופה שתרצה להשוות?';
 if(['BUSINESS_NUMBER_PRECISION','INVALID_BUSINESS_NUMBER','BUSINESS_NUMBER_LIMIT'].includes(code))return 'אפשר למסור את המספר המדויק, ולסכום כספי גם מטבע ועד שתי ספרות אחרי הנקודה?';
 if(code==='OCCUPIED_EXCEEDS_CAPACITY')return 'מה הקיבולת הכוללת וכמה מקומות כבר תפוסים?';
 if(code==='RETAINED_EXCEEDS_COHORT')return 'כמה לקוחות היו בקבוצת ההתחלה וכמה מהם נשארו באותה תקופה?';
 return null;
}
module.exports={OPS,TYPES,analyze,decimal,format,inputQuestion};
