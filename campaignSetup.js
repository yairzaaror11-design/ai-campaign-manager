'use strict';
// Read-only inventory for the current tenant. A returned asset is not permission to publish.
async function read(clientId){
 const meta=require('./metaConnection');
 if(String(meta.context.getStore())!==String(clientId))throw Error('TENANT_CONTEXT_REQUIRED');
 const v=await require('./metaConversation').verify(clientId);
 if(!v.canRead)return{status:v.status,missing:['verified_account'],externalActions:0};
 const c=await meta.credentials(clientId);
 const account=await meta.graph('/'+c.meta_ad_account_id,c.token,{fields:'id,name,currency,timezone_name,account_status'});
 const list=async(path,fields)=>{const data=[];let after;for(let i=0;i<20;i++){const r=await meta.graph(path,c.token,{fields,limit:100,...(after?{after}:{})});data.push(...(r.data||[]));if(!r.paging?.next)return data;after=r.paging.cursors?.after;if(typeof after!=='string'||after.length>4096)throw Error('INVALID_META_CURSOR');}throw Error('ASSET_PAGE_LIMIT');};
 const result={account,permissions:v.permissions,canManage:v.permissions.includes('ads_management'),writeGateOpen:process.env.READ_ONLY==='false'&&process.env.META_WRITES_ENABLED==='true',pages:[],images:[],pixels:[],missing:[],externalActions:0};
 for(const [key,path,fields]of [['pages','/me/accounts','id,name,link'],['images','/'+account.id+'/adimages','hash,name,url'],['pixels','/'+account.id+'/adspixels','id,name']]){
   try{result[key]=(await list(path,fields)).slice(0,100);}
   catch{result.missing.push(key+'_access');}
 }
 if(!result.canManage)result.missing.push('ads_management');
 result.rule='Use only verified IDs. Ask which page/image when ambiguous. Existing assets are not automatically selected or approved. Never reuse a prior business campaign without confirmation. Missing assets/permissions are unknown, never fabricated.';
 return result;
}
async function start(clientId){
 const p=await require('./marketingStore').load(clientId),d=p?.journey?.draft;
 if(!d||d.stale)return{handled:true,reply:'נכין קודם מודעה ותוכנית מעודכנות, כדי שתוכל לראות ולאשר בדיוק מה ייווצר.'};
 const v=await require('./metaConversation').verify(clientId);
 if(!v.canRead)return{handled:true,reply:require('./metaConversation').statusReply(v),decisionKey:v.status==='ACCOUNT_SELECTION_REQUIRED'?'account_selection':null};
 if(!v.permissions.includes('ads_management'))return{handled:true,reply:'התוכנית שמורה. כדי ליצור אותה בחשבון ״'+v.account.name+'״ נדרשת הרשאת ניהול דרך Meta. החיבור לא מפעיל קמפיין; אישור היצירה וההפעלה יהיו כאן ב־WhatsApp.',decisionKey:'management_connect'};
 await require('./marketingStore').update(clientId,null,profile=>{profile.launch={stage:'SETUP',draftId:d.id,revision:d.revision,accountId:v.account.id};return{handled:false,changed:true};});
 return{handled:false,launchRequested:true};
}
module.exports={read,start};
