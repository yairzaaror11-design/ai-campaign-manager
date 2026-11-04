'use strict';
// Page credentials never leave this module's backend callers.
const meta=require('./metaConnection');
const CONTACT_TYPES=['FULL_NAME','EMAIL','PHONE'];
function id(value){if(typeof value!=='string'||!/^\d{1,40}$/.test(value))throw Error('INVALID_META_OBJECT');return value;}
function validate(parameters){
 const p=parameters||{};
 id(p.pageId);
 if(typeof p.name!=='string'||!p.name.trim()||p.name.length>200)throw Error('INVALID_FORM_NAME');
 if(!['HE_IL','EN_US','AR_AR'].includes(p.locale))throw Error('INVALID_FORM_LOCALE');
 try{require('./publicWebsite').url(p.privacyPolicyUrl);}catch{throw Error('FORM_PRIVACY_URL_REQUIRED');}
 if(!Array.isArray(p.questions)||p.questions.length<2||p.questions.length>12)throw Error('INVALID_FORM_QUESTIONS');
 const seen=new Set();
 for(const q of p.questions){
  if(!q||!['type','key','label'].every(k=>q[k]===undefined||typeof q[k]==='string')||Object.keys(q).some(k=>!['type','key','label'].includes(k)))throw Error('INVALID_FORM_QUESTION');
  if(CONTACT_TYPES.includes(q.type)){
   if(q.key!==undefined||q.label!==undefined||seen.has(q.type))throw Error('INVALID_FORM_QUESTION');
   seen.add(q.type);
  }else if(q.type==='CUSTOM'){
   if(!/^[a-z][a-z0-9_]{0,49}$/.test(q.key||'')||!q.label?.trim()||q.label.length>200||seen.has(q.key)||CONTACT_TYPES.includes(q.key.toUpperCase()))throw Error('INVALID_FORM_QUESTION');
   seen.add(q.key);
  }else throw Error('UNSUPPORTED_FORM_QUESTION');
 }
 if(!seen.has('FULL_NAME')||!seen.has('PHONE')&&!seen.has('EMAIL'))throw Error('FORM_CONTACT_REQUIRED');
 return p;
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
module.exports={CONTACT_TYPES,id,validate,pageAccess,pages,inspect,list};
