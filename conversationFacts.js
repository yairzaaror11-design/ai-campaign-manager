'use strict';
const qs=require('./marketingQuestions');
const FIELDS=Object.freeze({
 businessName:{id:'BUS-001',scope:'business',label:'שם העסק'},
 businessType:{id:'BUS-002',scope:'business',label:'תחום הפעילות'},
 businessGoal:{id:'GOAL-001',label:'המטרה העסקית'},
 product:{id:'GOAL-002',label:'השירות לקידום'},
 audience:{id:'AUD-001',scope:'business',label:'קהל היעד'},
 geography:{id:'AUD-003',label:'אזור הפרסום'},
 serviceArea:{id:'BUS-005',scope:'business',label:'אזור השירות'},
 advantage:{id:'DIF-001',scope:'business',label:'היתרון'},
 dailyBudget:{key:'campaign.daily_budget',label:'תקציב מדיה יומי'},
 leadDestination:{key:'campaign.lead_destination',label:'דרך קבלת הפניות'},
 offer:{key:'campaign.offer',label:'ההצעה'},
 offerMediaSeparate:{key:'campaign.offer_media_separate',label:'תקציב מדיה נפרד מההטבה'},
 offerScope:{key:'campaign.offer_scope',label:'מה כלול בהטבה'},
 offerCommitment:{key:'campaign.offer_commitment',label:'תנאי ההצעה והתחייבות'},
 materials:{id:'CRE-011',label:'חומרים קיימים'},
 website:{id:'BUS-008',scope:'business',label:'אתר'},
 genderPreference:{key:'business.address_preference',scope:'business',label:'לשון פנייה מועדפת'}
});
function descriptor(p,field){const d=FIELDS[field];if(!d)throw Error('UNKNOWN_BUSINESS_FIELD');const scope=d.scope||'plan:'+p.planId;const key=d.key||qs.question(d.id).storage_field;return{...d,scope,key,address:scope+':'+key};}
function read(p,field){const d=descriptor(p,field);let a=p.answers[d.address];if(!a&&d.id)a=qs.answerFor(p,d.id);return a||null;}
function value(p,field){const a=read(p,field);return a&&['known','estimated'].includes(a.status)?a.value:null;}
function validate(field,input){
 if(!FIELDS[field])throw Error('UNKNOWN_BUSINESS_FIELD');
 if(field==='dailyBudget'){
  if(!input||!Number.isFinite(input.amount)||input.amount<=0||input.period!=='day'||!['ILS','USD','EUR'].includes(input.currency))throw Error('INVALID_DAILY_BUDGET');
  return {amount:input.amount,currency:input.currency,period:'day'};
 }
 if(field==='offerMediaSeparate'){if(typeof input!=='boolean')throw Error('INVALID_OFFER_TERMS');return input;}
 if(typeof input!=='string'||!input.trim()||input.length>1000)throw Error('INVALID_BUSINESS_FACT');
 return input.trim();
}
function write(p,field,input,{status='known',source='user_explicit',evidence='',now=new Date().toISOString()}={}){
 const d=descriptor(p,field);const old=read(p,field);
 if(!['known','estimated','unknown','not_applicable'].includes(status))throw Error('INVALID_FACT_STATUS');
 const checked=['known','estimated'].includes(status)?validate(field,input):null;
 if(old&&JSON.stringify(old.value)===JSON.stringify(checked)&&old.status===status)return false;
 p.answers[d.address]={questionId:d.id||null,field:d.key,semanticField:field,scope:d.scope,value:checked,status,source,evidence:evidence.slice(0,1200),verified_at:now,period:field==='dailyBudget'?'day':null,confidence:status==='estimated'?'low':'user_reported',history:old?[...(old.history||[]),{value:old.value,status:old.status,verified_at:old.verified_at}].slice(-8):[]};
 return true;
}
function all(p){return Object.fromEntries(Object.keys(FIELDS).map(k=>[k,value(p,k)]).filter(([,v])=>v!==null));}
function display(v){if(v&&typeof v==='object'&&v.amount!==undefined)return `${v.amount} ${v.currency} ליום`;return typeof v==='boolean'?(v?'כן':'לא'):String(v??'לא ידוע');}
function summary(p){return Object.keys(FIELDS).filter(f=>read(p,f)).map(f=>{const a=read(p,f);return `${FIELDS[f].label}: ${a.status==='unknown'?'לא ידוע':a.status==='not_applicable'?'לא רלוונטי':display(a.value)+(a.status==='estimated'?' (הערכה)':'')}`;}).join('\n');}
function correctionsInvalidate(p,fields){
 if(!fields.length||!p.journey)return;
 p.journey.revision=(p.journey.revision||0)+1;
 if(p.journey.draft){p.journey.draft.stale=true;p.journey.draft.requiresApproval=true;}
 p.journey.strategyApproved=false;p.journey.creativeApproved=false;p.journey.planApproved=false;
}
module.exports={FIELDS,descriptor,read,value,write,all,summary,display,validate,correctionsInvalidate};
