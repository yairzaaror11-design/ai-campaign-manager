'use strict';
const meta=require('./metaConnection');
async function verifyAction(plan,written) {
 const id=written.id || plan.target.campaignId;
 if(['SYNC_BUYER_AUDIENCE','CREATE_LOOKALIKE'].includes(plan.intent)){
  if(!/^\d+$/.test(String(id)))return{verified:false};
  const c=await meta.credentials(meta.context.getStore());
  const a=await meta.graph('/'+id,c.token,{fields:'id,account_id,name,subtype'});
  return{verified:String(a.id)===String(id)&&'act_'+a.account_id===plan.target.accountId&&a.subtype===(plan.intent==='CREATE_LOOKALIKE'?'LOOKALIKE':'CUSTOM')&&(!!plan.parameters.audienceId||a.name===plan.parameters.name)};
 }
 if(plan.intent==='CREATE_LEAD_FORM'){
  if(!/^\d+$/.test(String(id)))return{verified:false};
  const {form}=await require('./metaLeadForms').inspect(meta.context.getStore(),plan.parameters.pageId,String(id));
  const p=plan.parameters,questions=form.questions?.data||form.questions;
  // Multiple-choice options are compared when Meta returns them (same values, same order).
  const options=(q,got)=>!q.options||!Array.isArray(got.options)||JSON.stringify(got.options.map(o=>o.value))===JSON.stringify(q.options);
  const matching=Array.isArray(questions)&&questions.length===p.questions.length&&p.questions.every((q,i)=>q.type===questions[i].type&&(q.type!=='CUSTOM'||q.key===questions[i].key&&q.label===questions[i].label&&options(q,questions[i])));
  return{verified:!!(['ACTIVE','DRAFT'].includes(form.status)&&form.name===p.name&&form.locale===p.locale&&form.privacy_policy_url===p.privacyPolicyUrl&&matching)};
 }
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
     const creativeIds=objects.creativeIds||[objects.creativeId],ads=require('./mediaBuying').bundleAds(plan.parameters);
     if(creativeIds[0]!==objects.creativeId||creativeIds.length!==ads.length||objects.adsetIds.length!==plan.parameters.adSets.length||objects.adIds.length!==objects.adsetIds.length*creativeIds.length) return {verified:false};
     for(const [i,creativeId] of creativeIds.entries()){
       const creative=await meta.graph('/'+creativeId,c.token,{fields:'id,account_id,object_story_spec'});
       const link=creative.object_story_spec?.link_data;
       if(plan.parameters.formId&&link?.call_to_action?.value?.lead_gen_form_id!==plan.parameters.formId)return{verified:false};
       if('act_'+creative.account_id!==plan.target.accountId) return {verified:false};
       // Several different ads: each creative must carry its own approved image and headline.
       if(plan.parameters.ads&&(link?.image_hash!==ads[i].imageHash||link?.name!==ads[i].headline)) return {verified:false};
     }
     for(let i=0;i<objects.adsetIds.length;i++) {
       const wanted=plan.parameters.adSets[i],advantage=require('./mediaBuying').advantageOn(wanted.targeting);
       const set=await meta.graph('/'+objects.adsetIds[i],c.token,{fields:advantage?'campaign_id,daily_budget,targeting':'campaign_id,daily_budget'});
       if(set.campaign_id!==objects.campaignId||String(set.daily_budget)!==String(wanted.dailyBudgetMinor)) return {verified:false};
       if(advantage){let t=set.targeting;if(typeof t==='string')try{t=JSON.parse(t);}catch{t=null;}if(!require('./mediaBuying').advantageOn(t)) return {verified:false};}
       for(let j=0;j<creativeIds.length;j++){
         const ad=await meta.graph('/'+objects.adIds[i*creativeIds.length+j],c.token,{fields:'adset_id,creative'});
         if(ad.adset_id!==objects.adsetIds[i]||ad.creative?.id!==creativeIds[j]) return {verified:false};
       }
     }
   }
   return {verified:true};
 }
 if(plan.intent==='PAUSE_AD') {
   const c=await meta.credentials(meta.context.getStore());
   const ad=await meta.graph('/'+plan.target.adId,c.token,{fields:'id,account_id,campaign_id,status'});
   return {verified:String(ad.id)===plan.target.adId&&'act_'+ad.account_id===plan.target.accountId&&String(ad.campaign_id)===plan.target.campaignId&&ad.status==='PAUSED'};
 }
 if(plan.intent==='DUPLICATE_CAMPAIGN') {
   const o=written.objects;if(!o||!/^\d+$/.test(String(o.campaignId))||o.campaignId===plan.target.campaignId) return {verified:false};
   const c=await meta.credentials(meta.context.getStore());
   const copy=await meta.graph('/'+o.campaignId,c.token,{fields:'id,account_id,status,daily_budget'});
   if('act_'+copy.account_id!==plan.target.accountId||copy.status!=='PAUSED') return {verified:false};
   const holder=plan.target.adsetId?await meta.graph('/'+o.adsetIds[0],c.token,{fields:'id,account_id,campaign_id,daily_budget'}):copy;
   if(plan.target.adsetId&&('act_'+holder.account_id!==plan.target.accountId||String(holder.campaign_id)!==String(o.campaignId))) return {verified:false};
   return {verified:String(holder.daily_budget)===String(plan.parameters.dailyBudgetMinor)};
 }
 if(plan.intent==='CHANGE_BUDGET'&&plan.target.adsetId) {
   const c=await meta.credentials(meta.context.getStore());
   const set=await meta.graph('/'+plan.target.adsetId,c.token,{fields:'id,account_id,campaign_id,daily_budget'});
   return {verified:String(set.id)===plan.target.adsetId&&'act_'+set.account_id===plan.target.accountId&&String(set.campaign_id)===plan.target.campaignId&&String(set.daily_budget)===String(plan.parameters.dailyBudgetMinor)};
 }
 if(plan.intent==='UPLOAD_IMAGE') {
   const c=await meta.credentials(meta.context.getStore());
   const images=await meta.graph('/'+plan.target.accountId+'/adimages',c.token,{fields:'hash',hashes:JSON.stringify([id])});
   return {verified:!!images.data?.some(image=>image.hash===id)};
 }
 if(!/^\d+$/.test(String(id))) return {verified:false};
 const c=await meta.credentials(meta.context.getStore());
 const fields=plan.intent==='CREATE_CREATIVE'?'id,account_id,name,object_story_spec':plan.intent==='CREATE_AD'?'id,account_id,status,name,adset_id,creative':plan.intent==='CREATE_ADSET'?'id,account_id,status,name,campaign_id,daily_budget':'id,account_id,status,name,daily_budget,objective';
 const object=await meta.graph('/'+id,c.token,{fields});
 let valid=String(object.id)===String(id)&&'act_'+object.account_id===plan.target.accountId;
 if(['CREATE_CAMPAIGN','CREATE_ADSET','CREATE_AD','PAUSE_CAMPAIGN'].includes(plan.intent)) valid=valid&&object.status==='PAUSED';
 if(plan.intent==='RESUME_CAMPAIGN') valid=valid&&object.status==='ACTIVE';
 if(plan.intent==='CREATE_CAMPAIGN') valid=valid&&object.objective===plan.parameters.objective;
 if(plan.intent==='CREATE_ADSET') valid=valid&&String(object.campaign_id)===plan.parameters.campaignId;
 if(plan.intent==='CREATE_AD') valid=valid&&String(object.adset_id)===plan.parameters.adsetId&&String(object.creative?.id)===plan.parameters.creativeId;
 if(['CHANGE_BUDGET','CREATE_ADSET'].includes(plan.intent)) valid=valid&&String(object.daily_budget)===String(plan.parameters.dailyBudgetMinor);
 if(plan.intent==='CREATE_CREATIVE'&&plan.parameters.formId)valid=valid&&object.object_story_spec?.link_data?.call_to_action?.value?.lead_gen_form_id===plan.parameters.formId;
 if(plan.parameters.name) valid=valid&&object.name===plan.parameters.name;
 return {verified:!!valid,object};
}
module.exports={verifyAction};
