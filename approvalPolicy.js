'use strict';
const crypto = require('node:crypto');
const {validateActionPlan}=require('./actionValidator');
function canonical(value) {
  if(value===null || typeof value==='string' || typeof value==='boolean') return JSON.stringify(value);
  if(typeof value==='number' && Number.isFinite(value)) return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if(value && typeof value==='object' && Object.getPrototypeOf(value)===Object.prototype) {
    const keys=Object.keys(value).sort();
    if(keys.some(k=>['__proto__','prototype','constructor'].includes(k))) throw Error('INVALID_PLAN_KEY');
    return '{'+keys.filter(k=>value[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  }
  throw Error('INVALID_PLAN_VALUE');
}
const planHash=plan=>crypto.createHash('sha256').update(canonical(plan)).digest('hex');
const parameterKeys={
 UPLOAD_IMAGE:['mediaId'],
 CREATE_BUNDLE:['name','objective','specialAdCategories','dailyBudget','dailyBudgetMinor','currency','pageId','link','message','headline','imageHash','adSets'],
 ACTIVATE_BUNDLE:['adsetIds','adIds'],
 CREATE_CAMPAIGN:['name','objective','specialAdCategories'],
 CREATE_ADSET:['name','campaignId','dailyBudget','dailyBudgetMinor','currency','billingEvent','optimizationGoal','bidStrategy','targeting','promotedObject','startTime','endTime'],
 CREATE_CREATIVE:['name','pageId','link','message','headline','imageHash'],
 CREATE_AD:['name','adsetId','creativeId'],
 CHANGE_BUDGET:['dailyBudget','dailyBudgetMinor','currency'],
 PAUSE_CAMPAIGN:[],RESUME_CAMPAIGN:[],EDIT_CAMPAIGN:['name']
};
function strictPlan(plan) {
  const validation=validateActionPlan(plan);
  if(!validation.ok) throw Error('INVALID_ACTION_PLAN: '+validation.errors.join(', '));
  if(!/^act_\d+$/.test(plan.target?.accountId || '')) throw Error('ACCOUNT_REQUIRED');
  if(!parameterKeys[plan.intent] || Object.keys(plan.parameters || {}).some(k=>!parameterKeys[plan.intent].includes(k))) throw Error('UNSUPPORTED_ACTION_PARAMETERS');
  for(const k of ['accountId','campaignId']) if(plan.target[k]!==undefined&&typeof plan.target[k]!=='string') throw Error('INVALID_TARGET_TYPE');
  if(Object.keys(plan.target).some(k=>!['accountId','accountName','campaignId','campaignName'].includes(k))) throw Error('UNSUPPORTED_TARGET');
  for(const k of ['campaignId','adsetId','creativeId','pageId']) if(plan.parameters[k]!==undefined && !/^\d+$/.test(plan.parameters[k])) throw Error('INVALID_OBJECT_ID');
  if(JSON.stringify(plan).length>16000) throw Error('PLAN_TOO_LARGE');
  if(plan.parameters.name && (typeof plan.parameters.name!=='string'||plan.parameters.name.length>200)) throw Error('INVALID_NAME');
  if(plan.intent==='ACTIVATE_BUNDLE') {
    if(!/^\d+$/.test(plan.target.campaignId || '')) throw Error('CAMPAIGN_REQUIRED');
    for(const field of ['adsetIds','adIds']) if(!Array.isArray(plan.parameters[field])||!plan.parameters[field].length||plan.parameters[field].length>10||plan.parameters[field].some(id=>typeof id!=='string'||!/^\d+$/.test(id))) throw Error('BUNDLE_IDS_REQUIRED');
  }
  if(plan.intent==='CREATE_BUNDLE') {
    const p=plan.parameters;
    strictPlan({...plan,intent:'CREATE_CAMPAIGN',parameters:{name:p.name,objective:p.objective,specialAdCategories:p.specialAdCategories}});
    strictPlan({...plan,intent:'CREATE_CREATIVE',parameters:{name:p.name,pageId:p.pageId,link:p.link,message:p.message,headline:p.headline,imageHash:p.imageHash}});
    if(!Array.isArray(p.adSets)||p.adSets.length<1||p.adSets.length>5) throw Error('ADSETS_REQUIRED');
    let total=0;
    for(const set of p.adSets) {
      strictPlan({...plan,intent:'CREATE_ADSET',parameters:{...set,campaignId:'1'}});
      total+=set.dailyBudgetMinor;
    }
    if(total!==p.dailyBudgetMinor) throw Error('TOTAL_BUDGET_MISMATCH');
  }
  if(plan.intent==='UPLOAD_IMAGE'&&!/^[a-f0-9-]{36}$/i.test(plan.parameters.mediaId || '')) throw Error('MEDIA_REFERENCE_REQUIRED');
  if(plan.intent==='CREATE_ADSET') {
    const p=plan.parameters;
    if(!p.targeting || !Array.isArray(p.targeting.geo_locations?.countries) || !p.targeting.geo_locations.countries.length || p.targeting.geo_locations.countries.some(c=>!/^[A-Z]{2}$/.test(c))) throw Error('TARGETING_REQUIRED');
    if(!['IMPRESSIONS','LINK_CLICKS'].includes(p.billingEvent) || !['LINK_CLICKS','LANDING_PAGE_VIEWS','LEAD_GENERATION','OFFSITE_CONVERSIONS','REACH','IMPRESSIONS'].includes(p.optimizationGoal)) throw Error('DELIVERY_SETTINGS_REQUIRED');
    if(!p.startTime || !Number.isFinite(Date.parse(p.startTime))) throw Error('START_TIME_REQUIRED');
    if(p.endTime && (!Number.isFinite(Date.parse(p.endTime)) || Date.parse(p.endTime)<=Date.parse(p.startTime))) throw Error('INVALID_END_TIME');
    if(p.targeting.age_min!==undefined && (!Number.isInteger(p.targeting.age_min)||p.targeting.age_min<18)) throw Error('ADULT_TARGETING_REQUIRED');
  }
  if(plan.intent==='CREATE_CREATIVE') {
    const p=plan.parameters;
    if(!p.name||!p.pageId||!p.message||!p.headline||!p.imageHash||!/^https:\/\//.test(p.link || '')) throw Error('CREATIVE_FIELDS_REQUIRED');
    const link=new URL(p.link);
    if(link.username||link.password||link.hostname==='localhost'||/^\d+\.\d+\.\d+\.\d+$/.test(link.hostname)) throw Error('INVALID_CREATIVE_LINK');
  }
  return plan;
}
const exponents={ILS:2,USD:2,EUR:2,GBP:2,CAD:2,AUD:2,JPY:0,KRW:0};
function minorUnits(value,currency) {
  if(exponents[currency]===undefined) throw Error('CURRENCY_REQUIRES_CONFIGURATION');
  const text=String(value);
  if(!/^\d+(?:\.\d+)?$/.test(text)) throw Error('INVALID_BUDGET');
  const [whole,fraction='']=text.split('.');
  if(fraction.length>exponents[currency]) throw Error('BUDGET_PRECISION');
  const units=Number(whole)*10**exponents[currency]+Number(fraction.padEnd(exponents[currency],'0'));
  if(!Number.isSafeInteger(units)||units<=0) throw Error('INVALID_BUDGET');
  return units;
}
function codeDigest(clientId,code) {
  const key=process.env.APPROVAL_HMAC_KEY || process.env.META_TOKEN_ENCRYPTION_KEY;
  if(!key) throw Error('APPROVAL_KEY_REQUIRED');
  return crypto.createHmac('sha256',key).update(String(clientId)+':'+code).digest('hex');
}
async function preparePlan(clientId,input) {
  const meta=require('./metaConnection');
  const connection=await meta.credentials(clientId);
  if(!connection.meta_ad_account_id || (input.target?.accountId && input.target.accountId!==connection.meta_ad_account_id)) throw Error('TENANT_ACCOUNT_MISMATCH');
  const plan=JSON.parse(JSON.stringify(input));
  plan.target={...plan.target,accountId:connection.meta_ad_account_id};
  plan.tenantId=String(clientId);
  plan.connectionGeneration=String(connection.meta_generation);
  const accountInfo=await meta.graph('/'+connection.meta_ad_account_id,connection.token,{fields:'id,name,currency,timezone_name'});
  plan.target.accountName=accountInfo.name;
  plan.review={currency:accountInfo.currency,timezone:accountInfo.timezone_name};
  if(plan.target.campaignId) {
    const current=await meta.graph('/'+plan.target.campaignId,connection.token,{fields:'id,account_id,name,objective,daily_budget,lifetime_budget,start_time,stop_time'});
    if('act_'+current.account_id!==connection.meta_ad_account_id) throw Error('TENANT_ACCOUNT_MISMATCH');
    plan.target.campaignName=current.name;
    plan.review={...plan.review,objective:current.objective,currentDailyBudgetMinor:current.daily_budget};
  }
  if(plan.intent==='ACTIVATE_BUNDLE') {
    plan.review.adSets=[];
    for(const id of plan.parameters.adsetIds || []) {
      const set=await meta.graph('/'+id,connection.token,{fields:'id,account_id,campaign_id,name,daily_budget,targeting,start_time,end_time'});
      if('act_'+set.account_id!==connection.meta_ad_account_id||set.campaign_id!==plan.target.campaignId) throw Error('BUNDLE_RELATIONSHIP_MISMATCH');
      plan.review.adSets.push(set);
    }
    for(const id of plan.parameters.adIds || []) {
      const ad=await meta.graph('/'+id,connection.token,{fields:'id,account_id,adset_id'});
      if('act_'+ad.account_id!==connection.meta_ad_account_id||!plan.parameters.adsetIds.includes(ad.adset_id)) throw Error('BUNDLE_RELATIONSHIP_MISMATCH');
    }
  }
  if(['CREATE_BUNDLE','CREATE_ADSET','CHANGE_BUDGET'].includes(plan.intent)) {
    const account=await meta.graph('/'+connection.meta_ad_account_id,connection.token,{fields:'id,name,currency,timezone_name'});
    plan.parameters.currency=account.currency;
    plan.parameters.dailyBudgetMinor=minorUnits(plan.parameters.dailyBudget,account.currency);
    plan.target.accountName=account.name;
    if(plan.intent==='CREATE_BUNDLE') for(const set of plan.parameters.adSets || []) {set.currency=account.currency;set.dailyBudgetMinor=minorUnits(set.dailyBudget,account.currency);}
  }
  strictPlan(plan);
  return plan;
}
module.exports={canonical,planHash,strictPlan,minorUnits,codeDigest,preparePlan};
