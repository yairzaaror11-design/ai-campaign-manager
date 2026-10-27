'use strict';
const meta=require('./metaConnection');
async function verifyAction(plan,written) {
 const id=written.id || plan.target.campaignId;
 if(['CREATE_BUNDLE','ACTIVATE_BUNDLE'].includes(plan.intent)) {
   const objects=written.objects;
   if(!objects) return {verified:false};
   const c=await meta.credentials(meta.context.getStore());
   for(const objectId of [objects.campaignId,...objects.adsetIds,...objects.adIds]) {
     const object=await meta.graph('/'+objectId,c.token,{fields:'id,account_id,status'});
     if('act_'+object.account_id!==plan.target.accountId||object.status!==(plan.intent==='CREATE_BUNDLE'?'PAUSED':'ACTIVE')) return {verified:false};
   }
   if(plan.intent==='CREATE_BUNDLE') {
     const campaign=await meta.graph('/'+objects.campaignId,c.token,{fields:'id,name,objective'});
     if(campaign.name!==plan.parameters.name||campaign.objective!==plan.parameters.objective) return {verified:false};
     const creative=await meta.graph('/'+objects.creativeId,c.token,{fields:'id,account_id'});
     if('act_'+creative.account_id!==plan.target.accountId) return {verified:false};
     for(let i=0;i<objects.adsetIds.length;i++) {
       const set=await meta.graph('/'+objects.adsetIds[i],c.token,{fields:'campaign_id,daily_budget'});
       if(set.campaign_id!==objects.campaignId||String(set.daily_budget)!==String(plan.parameters.adSets[i].dailyBudgetMinor)) return {verified:false};
       const ad=await meta.graph('/'+objects.adIds[i],c.token,{fields:'adset_id,creative'});
       if(ad.adset_id!==objects.adsetIds[i]||ad.creative?.id!==objects.creativeId) return {verified:false};
     }
   }
   return {verified:true};
 }
 if(plan.intent==='UPLOAD_IMAGE') {
   const c=await meta.credentials(meta.context.getStore());
   const images=await meta.graph('/'+plan.target.accountId+'/adimages',c.token,{fields:'hash',hashes:JSON.stringify([id])});
   return {verified:!!images.data?.some(image=>image.hash===id)};
 }
 if(!/^\d+$/.test(String(id))) return {verified:false};
 const c=await meta.credentials(meta.context.getStore());
 const fields=plan.intent==='CREATE_CREATIVE'?'id,account_id,name':plan.intent==='CREATE_AD'?'id,account_id,status,name,adset_id,creative':plan.intent==='CREATE_ADSET'?'id,account_id,status,name,campaign_id,daily_budget':'id,account_id,status,name,daily_budget,objective';
 const object=await meta.graph('/'+id,c.token,{fields});
 let valid=String(object.id)===String(id)&&'act_'+object.account_id===plan.target.accountId;
 if(['CREATE_CAMPAIGN','CREATE_ADSET','CREATE_AD','PAUSE_CAMPAIGN'].includes(plan.intent)) valid=valid&&object.status==='PAUSED';
 if(plan.intent==='RESUME_CAMPAIGN') valid=valid&&object.status==='ACTIVE';
 if(plan.intent==='CREATE_CAMPAIGN') valid=valid&&object.objective===plan.parameters.objective;
 if(plan.intent==='CREATE_ADSET') valid=valid&&String(object.campaign_id)===plan.parameters.campaignId;
 if(plan.intent==='CREATE_AD') valid=valid&&String(object.adset_id)===plan.parameters.adsetId&&String(object.creative?.id)===plan.parameters.creativeId;
 if(['CHANGE_BUDGET','CREATE_ADSET'].includes(plan.intent)) valid=valid&&String(object.daily_budget)===String(plan.parameters.dailyBudgetMinor);
 if(plan.parameters.name) valid=valid&&object.name===plan.parameters.name;
 return {verified:!!valid,object};
}
module.exports={verifyAction};
