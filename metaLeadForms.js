'use strict';
// Page credentials never leave this module's backend callers.
const meta=require('./metaConnection');
const CONTACT_TYPES=['FULL_NAME','EMAIL','PHONE'];
// Lead form fields per Marketing API (POST /{page_id}/leadgen_forms, checked 2026-11):
// https://developers.facebook.com/docs/marketing-api/reference/page/leadgen_forms/
// https://developers.facebook.com/docs/marketing-api/guides/lead-ads/create
// * "Higher intent" = is_optimized_for_quality:true: the person reviews and confirms the answers
//   before submitting. "More volume" = false.
// * Multiple-choice qualifying question = type CUSTOM with options [{key,value}].
// * thank_you_page.button_type CALL_BUSINESS (business_phone_number) or VIEW_WEBSITE (website_url;
//   a wa.me link is a valid website). privacy_policy {url} is required by Meta for contact details.
const HIGHER_INTENT_FIELD='is_optimized_for_quality';
const FORM_TYPES=Object.freeze({HIGHER_INTENT:true,MORE_VOLUME:false});
const THANK_YOU_BUTTONS=Object.freeze(['CALL_BUSINESS','VIEW_WEBSITE']);
const QUALIFYING=Object.freeze({max:3,minOptions:2,maxOptions:6,optionLength:100});
function id(value){if(typeof value!=='string'||!/^\d{1,40}$/.test(value))throw Error('INVALID_META_OBJECT');return value;}
const formType=p=>p.formType===undefined?'HIGHER_INTENT':p.formType;
function validateThankYou(t){
 if(t===undefined)return;
 if(!t||typeof t!=='object'||Array.isArray(t)||Object.keys(t).some(k=>!['buttonType','buttonText','websiteUrl','phone'].includes(k))||!THANK_YOU_BUTTONS.includes(t.buttonType))throw Error('INVALID_FORM_THANK_YOU');
 if(t.buttonText!==undefined&&(typeof t.buttonText!=='string'||!t.buttonText.trim()||t.buttonText.length>60))throw Error('INVALID_FORM_THANK_YOU');
 if(t.buttonType==='CALL_BUSINESS'){if(t.websiteUrl!==undefined||typeof t.phone!=='string'||!/^\+[1-9]\d{7,14}$/.test(t.phone))throw Error('FORM_THANK_YOU_PHONE_REQUIRED');}
 else{if(t.phone!==undefined)throw Error('INVALID_FORM_THANK_YOU');try{require('./publicWebsite').url(t.websiteUrl);}catch{throw Error('FORM_THANK_YOU_URL_REQUIRED');}}
}
function validate(parameters){
 const p=parameters||{};
 id(p.pageId);
 if(typeof p.name!=='string'||!p.name.trim()||p.name.length>200)throw Error('INVALID_FORM_NAME');
 if(!['HE_IL','EN_US','AR_AR'].includes(p.locale))throw Error('INVALID_FORM_LOCALE');
 try{require('./publicWebsite').url(p.privacyPolicyUrl);}catch{throw Error('FORM_PRIVACY_URL_REQUIRED');}
 if(!Object.hasOwn(FORM_TYPES,formType(p)))throw Error('INVALID_FORM_TYPE');
 validateThankYou(p.thankYou);
 if(!Array.isArray(p.questions)||p.questions.length<2||p.questions.length>12)throw Error('INVALID_FORM_QUESTIONS');
 const seen=new Set();let choices=0;
 for(const q of p.questions){
  if(!q||!['type','key','label'].every(k=>q[k]===undefined||typeof q[k]==='string')||Object.keys(q).some(k=>!['type','key','label','options'].includes(k)))throw Error('INVALID_FORM_QUESTION');
  if(CONTACT_TYPES.includes(q.type)){
   if(q.key!==undefined||q.label!==undefined||q.options!==undefined||seen.has(q.type))throw Error('INVALID_FORM_QUESTION');
   seen.add(q.type);
  }else if(q.type==='CUSTOM'){
   if(!/^[a-z][a-z0-9_]{0,49}$/.test(q.key||'')||!q.label?.trim()||q.label.length>200||seen.has(q.key)||CONTACT_TYPES.includes(q.key.toUpperCase()))throw Error('INVALID_FORM_QUESTION');
   if(q.options!==undefined){
    // A qualifying multiple-choice question (e.g. buy or rent, area, budget range, timeline).
    const o=q.options;
    if(!Array.isArray(o)||o.length<QUALIFYING.minOptions||o.length>QUALIFYING.maxOptions||o.some(v=>typeof v!=='string'||!v.trim()||v.length>QUALIFYING.optionLength)||new Set(o).size!==o.length)throw Error('INVALID_FORM_OPTIONS');
    if(++choices>QUALIFYING.max)throw Error('TOO_MANY_QUALIFYING_QUESTIONS');
   }
   seen.add(q.key);
  }else throw Error('UNSUPPORTED_FORM_QUESTION');
 }
 if(!seen.has('FULL_NAME')||!seen.has('PHONE')&&!seen.has('EMAIL'))throw Error('FORM_CONTACT_REQUIRED');
 return p;
}
// Exactly what Meta receives for an approved plan (pure; tested without the network).
function formBody(parameters){
 const p=validate(parameters),he=p.locale==='HE_IL',t=p.thankYou;
 return{name:p.name,locale:p.locale,privacy_policy:{url:p.privacyPolicyUrl},
  questions:p.questions.map(q=>q.options?{type:q.type,key:q.key,label:q.label,options:q.options.map((value,i)=>({key:q.key+'_'+(i+1),value}))}:q),
  [HIGHER_INTENT_FIELD]:FORM_TYPES[formType(p)],
  thank_you_page:{title:he?'תודה! קיבלנו את הפרטים':'Thanks, we got your details',body:he?'נחזור אליך בהקדם, בדרך כלל בתוך כמה דקות בשעות הפעילות.':'We will get back to you shortly.',
   ...(!t?{button_type:'NONE'}:t.buttonType==='CALL_BUSINESS'?{button_type:'CALL_BUSINESS',button_text:t.buttonText||(he?'להתקשר עכשיו':'Call now'),business_phone_number:t.phone}
    :{button_type:'VIEW_WEBSITE',button_text:t.buttonText||(he?'לשיחה בוואטסאפ':'Continue'),website_url:t.websiteUrl})}};
}
async function pageAccess(clientId,pageId){
 id(pageId);
 if(String(meta.context.getStore())!==String(clientId))throw Error('TENANT_CONTEXT_REQUIRED');
 const c=await meta.credentials(clientId);
 // One exact granted Page, not a token or Page supplied by the model.
 const pages=await meta.graph('/me/accounts',c.token,{fields:'id,access_token',limit:100});
 const page=pages.data?.find(p=>p.id===pageId);
 if(!page?.access_token)throw Error('PAGE_NOT_GRANTED');
 return{token:page.access_token,connection:c};
}
async function pages(){
 const clientId=meta.context.getStore();if(!clientId)throw Error('TENANT_CONTEXT_REQUIRED');
 const c=await meta.credentials(clientId);
 const result=await meta.graph('/me/accounts',c.token,{fields:'id,name',limit:100});
 return{pages:(result.data||[]).map(p=>({id:p.id,name:p.name})),hasMore:!!result.paging?.next};
}
async function inspect(clientId,pageId,formId){
 id(formId);const access=await pageAccess(clientId,pageId);
 const form=await meta.graph('/'+formId,access.token,{fields:'id,name,page_id,locale,privacy_policy_url,questions,status'});
 if(String(form.id)!==formId||String(form.page_id)!==pageId)throw Error('FORM_PAGE_MISMATCH');
 return{form,access};
}
async function list(pageId){
 const clientId=meta.context.getStore();const access=await pageAccess(clientId,pageId);
 const result=await meta.graph('/'+pageId+'/leadgen_forms',access.token,{fields:'id,name,status,locale,questions,privacy_policy_url',limit:50});
 return{forms:(result.data||[]).map(f=>({id:f.id,name:f.name,status:f.status,locale:f.locale,questions:f.questions,privacyPolicyUrl:f.privacy_policy_url})),hasMore:!!result.paging?.next};
}
module.exports={CONTACT_TYPES,HIGHER_INTENT_FIELD,FORM_TYPES,THANK_YOU_BUTTONS,QUALIFYING,formType,formBody,id,validate,pageAccess,pages,inspect,list};
