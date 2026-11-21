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
  for(const id of [plan.target.campaignId,plan.target.adsetId,plan.target.adId,plan.parameters.campaignId,plan.parameters.adsetId,plan.parameters.creativeId].filter(Boolean)) await assertOwned(id,permit);
  if(['CREATE_CREATIVE','CREATE_BUNDLE'].includes(plan.intent)) {
    const pages=await meta.graph('/me/accounts',permit.token,{fields:'id',limit:100});
    if(!pages.data?.some(p=>p.id===plan.parameters.pageId)) throw Error('PAGE_NOT_GRANTED');
  }
  let token=permit.token;
  if(plan.intent==='CREATE_LEAD_FORM')token=(await require('./metaLeadForms').pageAccess(permit.clientId,plan.parameters.pageId)).token;
  if(plan.parameters.formId)await require('./metaLeadForms').inspect(permit.clientId,plan.parameters.pageId,plan.parameters.formId);
  const send=body=>axios.post('https://graph.facebook.com/'+meta.config().version+path,
      new URLSearchParams(Object.entries(body).filter(([,v])=>v!==undefined).map(([k,v])=>[k,typeof v==='object'?JSON.stringify(v):String(v)])),
      {headers:{Authorization:'Bearer '+token},params:{appsecret_proof:require('crypto').createHmac('sha256',process.env.META_APP_SECRET).update(token).digest('hex')},maxRedirects:0,timeout:15000});
  try {
    return (await send(data)).data;
  } catch(error) {
    // Custom Audience terms not accepted (code 200, subcode 1870090): a definite refusal, nothing written.
    if(Number(error?.response?.data?.error?.error_subcode)===1870090) throw Error('CUSTOM_AUDIENCE_TOS_REQUIRED');
    // A 400 is a definite rejection (nothing was created). If Meta rejects the
    // enhancement opt-out itself, create the creative without it rather than
    // leaving the campaign stuck, and log it so the opt-out keys can be fixed.
    if(error?.response?.status===400&&data.degrees_of_freedom_spec&&error.response.data?.error){
      require('./logger').logger.warn('Meta rejected enhancement opt-out; creating creative without it',{code:Number(error.response.data.error.code)||null});
      try{const {degrees_of_freedom_spec,...rest}=data;return (await send(rest)).data;}catch{throw Error('META_WRITE_UNCERTAIN');}
    }
    throw Error('META_WRITE_UNCERTAIN');
  }
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
async function createLeadForm(plan){
 const body=require('./metaLeadForms').formBody(plan.parameters);
 return post(plan,'/'+plan.parameters.pageId+'/leadgen_forms',body);
}
// Graph API bodies (Marketing API, verified against developers.facebook.com, 2026-11):
// * campaigns: special_ad_categories is required; when any category is declared,
//   special_ad_category_country is required too. SCORPIO budgets live on the ad set, and
//   since v24 is_adset_budget_sharing_enabled must then be sent explicitly.
// * ad sets: lead-form delivery needs destination_type ON_AD + promoted_object.page_id;
//   since v23 targeting_automation.advantage_audience must be explicit (0 keeps the exact
//   audience the owner approved).
// * every object is created PAUSED; only ACTIVATE_BUNDLE / RESUME_CAMPAIGN turn spend on.
function categoryCountries(plan){
 const p=plan.parameters,sets=p.adSets||(p.targeting?[p]:[]);
 const countries=[...new Set(sets.flatMap(s=>s.targeting?.geo_locations?.countries||[]))].filter(c=>/^[A-Z]{2}$/.test(c));
 return countries.length?countries:['IL'];
}
function campaignBody(plan){
 const p=plan.parameters,categories=(p.specialAdCategories||[]).filter(c=>c&&c!=='NONE');
 return {name:p.name,objective:p.objective,status:'PAUSED',special_ad_categories:categories,
  ...(categories.length?{special_ad_category_country:categoryCountries(plan)}:{}),
  is_adset_budget_sharing_enabled:false};
}
function adsetBody(set,campaignId){
 const targeting=require('./geoTargeting').forMeta(set.targeting)||{};
 return {name:set.name,campaign_id:campaignId,daily_budget:set.dailyBudgetMinor,billing_event:set.billingEvent,optimization_goal:set.optimizationGoal,bid_strategy:set.bidStrategy,
  targeting:{...targeting,targeting_automation:{advantage_audience:Number(targeting.targeting_automation?.advantage_audience)===1?1:0}},
  promoted_object:set.promotedObject,...(set.optimizationGoal==='LEAD_GENERATION'?{destination_type:'ON_AD'}:{}),
  start_time:set.startTime,end_time:set.endTime,status:'PAUSED'};
}
// Lead-form ads: Meta's lead-ads guide says link_data.link "can only be https://fb.me/".
function creativeBody(p,{name=p.name,message=p.message,headline=p.headline,imageHash=p.imageHash}={}){
 return {name,degrees_of_freedom_spec:NO_ENHANCEMENTS,object_story_spec:{page_id:p.pageId,...(p.instagramUserId?{instagram_user_id:p.instagramUserId}:{}),
  link_data:{link:p.formId?'https://fb.me/':p.link,message,name:headline,image_hash:imageHash,...(p.formId?{call_to_action:{type:'SIGN_UP',value:{lead_gen_form_id:p.formId}}}:{})}}};
}
async function createCampaign(plan) {
 return post(plan,'/'+plan.target.accountId+'/campaigns',campaignBody(plan));
}
async function createAdSet(plan) {
 const p=plan.parameters;
 return post(plan,'/'+plan.target.accountId+'/adsets',adsetBody(p,p.campaignId));
}
// Spend safety: Meta's Advantage+ creative "enhancements" (auto crops, touch-ups,
// rewritten text, music, overlays, catalog products, comments...) are opted out on
// every creative SCORPIO creates, so the owner's ad runs exactly as approved.
// Keys per Marketing API AdCreativeFeaturesSpec (each {enroll_status:'OPT_OUT'}).
const ENHANCEMENT_FEATURES=['standard_enhancements','image_touchups','adapt_to_placement','image_templates','image_animation','add_text_overlay','text_optimizations','description_automation','inline_comment','music_generation','site_extensions','product_extensions'];
const NO_ENHANCEMENTS={creative_features_spec:Object.fromEntries(ENHANCEMENT_FEATURES.map(k=>[k,{enroll_status:'OPT_OUT'}]))};
async function createCreative(plan) {
 return post(plan,'/'+plan.target.accountId+'/adcreatives',creativeBody(plan.parameters));
}
async function createAd(plan) {
 const p=plan.parameters;
 return post(plan,'/'+plan.target.accountId+'/ads',{name:p.name,adset_id:p.adsetId,creative:{creative_id:p.creativeId},status:'PAUSED'});
}
// The budget is written where it lives: on the campaign, or on its single ad set.
const changeBudget=plan=>post(plan,'/'+(plan.target.adsetId||plan.target.campaignId),{daily_budget:plan.parameters.dailyBudgetMinor});
// Duplicate a winning campaign: Meta deep copy (campaign, ad sets, ads), PAUSED,
// then the approved daily budget on the copy. Activation is a separate approval.
async function duplicateCampaign(plan) {
 const permit=require('./metaExecution').assertPermit(plan);
 const copy=await post(plan,'/'+plan.target.campaignId+'/copies',{deep_copy:true,status_option:'PAUSED',rename_options:{rename_strategy:'ONLY_TOP_LEVEL_RENAME',rename_suffix:' — עותק'}});
 const id=String(copy?.copied_campaign_id||'');
 if(!/^\d+$/.test(id)) throw Error('COPY_RESULT_UNCERTAIN');
 const sets=(await meta.graph('/'+id+'/adsets',permit.token,{fields:'id,campaign_id',limit:50})).data||[];
 const ads=(await meta.graph('/'+id+'/ads',permit.token,{fields:'id,adset_id',limit:50})).data||[];
 const adsetIds=sets.filter(s=>String(s.campaign_id)===id).map(s=>String(s.id)),adIds=ads.filter(a=>adsetIds.includes(String(a.adset_id))).map(a=>String(a.id));
 if(!adsetIds.length||!adIds.length||[...adsetIds,...adIds].some(x=>!/^\d+$/.test(x))) throw Error('COPY_RESULT_UNCERTAIN');
 if(plan.target.adsetId){if(adsetIds.length!==1) throw Error('COPY_RESULT_UNCERTAIN');await post(plan,'/'+adsetIds[0],{daily_budget:plan.parameters.dailyBudgetMinor});}
 else await post(plan,'/'+id,{daily_budget:plan.parameters.dailyBudgetMinor});
 return {id,objects:{campaignId:id,adsetIds,adIds}};
}
const pauseCampaign=plan=>post(plan,'/'+plan.target.campaignId,{status:'PAUSED'});
// One losing ad only (campaign guard). The ad's campaign was checked when the plan was prepared.
const pauseAd=plan=>post(plan,'/'+plan.target.adId,{status:'PAUSED'});
const resumeCampaign=plan=>post(plan,'/'+plan.target.campaignId,{status:'ACTIVE'});
const editCampaign=plan=>post(plan,'/'+plan.target.campaignId,{name:plan.parameters.name});
// One campaign, its ad sets, and 1..5 ads per ad set (`ads`: different image + copy each; or the
// legacy single ad plus copy-only `variants`). Every object is created PAUSED.
async function createBundle(plan) {
 const p=plan.parameters;
 const campaign=await createCampaign(plan);
 if(!/^\d+$/.test(campaign.id || '')) throw Error('CAMPAIGN_RESULT_UNCERTAIN');
 const ads=require('./mediaBuying').bundleAds(p),creatives=[];
 for(const [i,a] of ads.entries()){
  const name=i===0?p.name:p.name+(p.ads?' — מודעה ':' — גרסה ')+(i+1);
  const made=i===0&&!p.ads?await createCreative(plan):await post(plan,'/'+plan.target.accountId+'/adcreatives',creativeBody(p,{name,message:a.message,headline:a.headline,imageHash:a.imageHash}));
  if(!/^\d+$/.test(made.id || '')) throw Error('CREATIVE_RESULT_UNCERTAIN');
  creatives.push({id:made.id,headline:a.headline});
 }
 const adsetIds=[],adIds=[];
 for(const set of p.adSets) {
   const adset=await post(plan,'/'+plan.target.accountId+'/adsets',adsetBody(set,campaign.id));
   if(!/^\d+$/.test(adset.id || '')) throw Error('ADSET_RESULT_UNCERTAIN');
   adsetIds.push(adset.id);
   for(const c of creatives){
    const ad=await post(plan,'/'+plan.target.accountId+'/ads',{name:set.name+' — '+c.headline,adset_id:adset.id,creative:{creative_id:c.id},status:'PAUSED'});
    if(!/^\d+$/.test(ad.id || '')) throw Error('AD_RESULT_UNCERTAIN');
    adIds.push(ad.id);
   }
 }
 return {id:campaign.id,objects:{campaignId:campaign.id,creativeId:creatives[0].id,creativeIds:creatives.map(c=>c.id),adsetIds,adIds}};
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
// Buyer audiences. Meta Marketing API: POST /act_{id}/customaudiences (subtype CUSTOM,
// customer_file_source USER_PROVIDED_ONLY), then /{audience_id}/users (new) or
// /usersreplace (refresh, keeps the learning phase) in sessions of up to 10,000 rows.
// Only the SHA-256 hashes of the exact list the owner approved are sent.
const AUDIENCE_SCHEMA='PHONE_SHA256';
async function ownedAudience(id,permit,subtype){
 if(!/^\d+$/.test(String(id)))throw Error('INVALID_META_OBJECT');
 const a=await meta.graph('/'+id,permit.token,{fields:'id,account_id,subtype'});
 if('act_'+a.account_id!==permit.plan.target.accountId||a.subtype!==subtype)throw Error('TENANT_ACCOUNT_MISMATCH');
}
async function syncBuyerAudience(plan){
 if(process.env.META_WRITES_ENABLED!=='true'||process.env.READ_ONLY!=='false') throw Error('TENANT_WRITES_DISABLED');
 const permit=require('./metaExecution').assertPermit(plan),p=plan.parameters;
 const hashes=await require('./buyerAudiences').approvedHashes(permit.clientId,plan);
 let id=p.audienceId;
 if(id)await ownedAudience(id,permit,'CUSTOM');
 else{
  const created=await post(plan,'/'+plan.target.accountId+'/customaudiences',{name:p.name,subtype:'CUSTOM',customer_file_source:'USER_PROVIDED_ONLY',description:'לקוחות שסגרו עסקה ב־CRM של SCORPIO AI'});
  if(!/^\d+$/.test(created?.id||''))throw Error('AUDIENCE_RESULT_UNCERTAIN');
  id=created.id;
 }
 const size=require('./buyerAudiences').RULES.batch,batches=Math.ceil(hashes.length/size),sessionId=require('crypto').randomInt(1,2**47);
 let received=0,invalid=0;
 for(let i=0;i<batches;i++){
  const r=await post(plan,'/'+id+(p.audienceId?'/usersreplace':'/users'),{payload:{schema:AUDIENCE_SCHEMA,data:hashes.slice(i*size,(i+1)*size).map(h=>[h])},session:{session_id:sessionId,batch_seq:i+1,last_batch_flag:i===batches-1,estimated_num_total:hashes.length}});
  received=Math.max(received,Number(r?.num_received)||0);invalid+=Number(r?.num_invalid_entries)||0;
 }
 if(received<hashes.length)throw Error('AUDIENCE_UPLOAD_UNCERTAIN');
 return{id,objects:{audienceId:id,received,invalid}};
}
// From Graph v27 the lookalike country moved out of lookalike_spec (location comes from the ad set).
function lookalikeSpec(version=meta.config().version){return Number(/^v(\d+)/.exec(String(version))?.[1])>=27?{ratio:0.01}:{ratio:0.01,country:'IL'};}
async function createLookalike(plan){
 if(process.env.META_WRITES_ENABLED!=='true'||process.env.READ_ONLY!=='false') throw Error('TENANT_WRITES_DISABLED');
 const permit=require('./metaExecution').assertPermit(plan),p=plan.parameters;
 await ownedAudience(p.originAudienceId,permit,'CUSTOM');
 const r=await post(plan,'/'+plan.target.accountId+'/customaudiences',{name:p.name,subtype:'LOOKALIKE',origin_audience_id:p.originAudienceId,lookalike_spec:lookalikeSpec()});
 if(!/^\d+$/.test(r?.id||''))throw Error('AUDIENCE_RESULT_UNCERTAIN');
 return{id:r.id,objects:{audienceId:r.id}};
}
module.exports={campaignBody,adsetBody,creativeBody,AUDIENCE_SCHEMA,lookalikeSpec,syncBuyerAudience,createLookalike,NO_ENHANCEMENTS,ENHANCEMENT_FEATURES,createLeadForm,createBundle,activateBundle,uploadImage,createCampaign,createAdSet,createCreative,createAd,changeBudget,duplicateCampaign,pauseCampaign,pauseAd,resumeCampaign,editCampaign};
