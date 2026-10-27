'use strict';
const axios=require('axios');
const meta=require('./metaConnection');
async function assertOwned(id,permit) {
  if(!/^\d+$/.test(String(id))) throw Error('INVALID_META_OBJECT');
  const object=await meta.graph('/'+id,permit.token,{fields:'id,account_id'});
  if('act_'+object.account_id!==permit.plan.target.accountId) throw Error('TENANT_ACCOUNT_MISMATCH');
}
async function post(plan,path,data) {
  if(process.env.META_WRITES_ENABLED!=='true') throw Error('TENANT_WRITES_DISABLED');
  if(process.env.READ_ONLY!=='false') throw Error('READ_ONLY_BLOCK');
  const permit=require('./metaExecution').assertPermit(plan);
  for(const id of [plan.target.campaignId,plan.parameters.campaignId,plan.parameters.adsetId,plan.parameters.creativeId].filter(Boolean)) await assertOwned(id,permit);
  if(['CREATE_CREATIVE','CREATE_BUNDLE'].includes(plan.intent)) {
    const pages=await meta.graph('/me/accounts',permit.token,{fields:'id',limit:100});
    if(!pages.data?.some(p=>p.id===plan.parameters.pageId)) throw Error('PAGE_NOT_GRANTED');
  }
  try {
    return (await axios.post('https://graph.facebook.com/'+meta.config().version+path,
      new URLSearchParams(Object.entries(data).filter(([,v])=>v!==undefined).map(([k,v])=>[k,typeof v==='object'?JSON.stringify(v):String(v)])),
      {headers:{Authorization:'Bearer '+permit.token},params:{appsecret_proof:require('crypto').createHmac('sha256',process.env.META_APP_SECRET).update(permit.token).digest('hex')},maxRedirects:0,timeout:15000})).data;
  } catch {throw Error('META_WRITE_UNCERTAIN');}
}
async function uploadImage(plan) {
 if(process.env.META_WRITES_ENABLED!=='true'||process.env.READ_ONLY!=='false') throw Error('TENANT_WRITES_DISABLED');
 const permit=require('./metaExecution').assertPermit(plan);
 const media=await require('./mediaStore').loadMedia(permit.clientId,plan.parameters.mediaId);
 if(media.media_type!=='image') throw Error('IMAGE_REQUIRED');
 const downloaded=await require('./mediaHandler').receiveWhatsAppMedia({type:'image',image:{id:media.whatsapp_media_id}});
 const response=await post(plan,'/'+plan.target.accountId+'/adimages',{bytes:downloaded.buffer.toString('base64')});
 const image=Object.values(response.images || {})[0];
 if(!image?.hash) throw Error('META_IMAGE_RESPONSE_UNCERTAIN');
 return {id:image.hash,kind:'image'};
}
async function createCampaign(plan) {
 const p=plan.parameters;
 return post(plan,'/'+plan.target.accountId+'/campaigns',{name:p.name,objective:p.objective,status:'PAUSED',special_ad_categories:p.specialAdCategories || []});
}
async function createAdSet(plan) {
 const p=plan.parameters;
 return post(plan,'/'+plan.target.accountId+'/adsets',{name:p.name,campaign_id:p.campaignId,daily_budget:p.dailyBudgetMinor,billing_event:p.billingEvent,optimization_goal:p.optimizationGoal,bid_strategy:p.bidStrategy,targeting:p.targeting,promoted_object:p.promotedObject,start_time:p.startTime,end_time:p.endTime,status:'PAUSED'});
}
async function createCreative(plan) {
 const p=plan.parameters;
 return post(plan,'/'+plan.target.accountId+'/adcreatives',{name:p.name,object_story_spec:{page_id:p.pageId,link_data:{link:p.link,message:p.message,name:p.headline,image_hash:p.imageHash}}});
}
async function createAd(plan) {
 const p=plan.parameters;
 return post(plan,'/'+plan.target.accountId+'/ads',{name:p.name,adset_id:p.adsetId,creative:{creative_id:p.creativeId},status:'PAUSED'});
}
const changeBudget=plan=>post(plan,'/'+plan.target.campaignId,{daily_budget:plan.parameters.dailyBudgetMinor});
const pauseCampaign=plan=>post(plan,'/'+plan.target.campaignId,{status:'PAUSED'});
const resumeCampaign=plan=>post(plan,'/'+plan.target.campaignId,{status:'ACTIVE'});
const editCampaign=plan=>post(plan,'/'+plan.target.campaignId,{name:plan.parameters.name});
async function createBundle(plan) {
 const p=plan.parameters;
 const campaign=await createCampaign(plan);
 if(!/^\d+$/.test(campaign.id || '')) throw Error('CAMPAIGN_RESULT_UNCERTAIN');
 const creative=await createCreative(plan);
 if(!/^\d+$/.test(creative.id || '')) throw Error('CREATIVE_RESULT_UNCERTAIN');
 const adsetIds=[],adIds=[];
 for(const set of p.adSets) {
   const adset=await post(plan,'/'+plan.target.accountId+'/adsets',{name:set.name,campaign_id:campaign.id,daily_budget:set.dailyBudgetMinor,billing_event:set.billingEvent,optimization_goal:set.optimizationGoal,bid_strategy:set.bidStrategy,targeting:set.targeting,promoted_object:set.promotedObject,start_time:set.startTime,end_time:set.endTime,status:'PAUSED'});
   if(!/^\d+$/.test(adset.id || '')) throw Error('ADSET_RESULT_UNCERTAIN');
   adsetIds.push(adset.id);
   const ad=await post(plan,'/'+plan.target.accountId+'/ads',{name:set.name+' — '+p.headline,adset_id:adset.id,creative:{creative_id:creative.id},status:'PAUSED'});
   if(!/^\d+$/.test(ad.id || '')) throw Error('AD_RESULT_UNCERTAIN');
   adIds.push(ad.id);
 }
 return {id:campaign.id,objects:{campaignId:campaign.id,creativeId:creative.id,adsetIds,adIds}};
}
async function activateBundle(plan) {
 if(process.env.META_WRITES_ENABLED!=='true'||process.env.READ_ONLY!=='false') throw Error('TENANT_WRITES_DISABLED');
 const permit=require('./metaExecution').assertPermit(plan);
 const {adsetIds,adIds}=plan.parameters;
 const campaignId=plan.target.campaignId;
 // Validate all relationships before the first activation request.
 await assertOwned(campaignId,permit);
 for(const id of adsetIds) {
  const set=await meta.graph('/'+id,permit.token,{fields:'account_id,campaign_id'});
  if('act_'+set.account_id!==plan.target.accountId||set.campaign_id!==campaignId) throw Error('BUNDLE_RELATIONSHIP_MISMATCH');
 }
 for(const id of adIds) {
  const ad=await meta.graph('/'+id,permit.token,{fields:'account_id,adset_id'});
  if('act_'+ad.account_id!==plan.target.accountId||!adsetIds.includes(ad.adset_id)) throw Error('BUNDLE_RELATIONSHIP_MISMATCH');
 }
 for(const id of [...adIds,...adsetIds,campaignId]) await post(plan,'/'+id,{status:'ACTIVE'});
 return {id:campaignId,objects:{campaignId,adsetIds,adIds}};
}
module.exports={createBundle,activateBundle,uploadImage,createCampaign,createAdSet,createCreative,createAd,changeBudget,pauseCampaign,resumeCampaign,editCampaign};
