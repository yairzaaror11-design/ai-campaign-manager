'use strict';
const crypto=require('node:crypto'),db=require('./db');
const KINDS=['products','content','tasks','expenses','personas','research'];
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
function string(value,max,required=false){
 if(value==null&&!required)return '';
 if(typeof value!=='string'||value.length>max||required&&!value.trim())throw Error('INVALID_WORKSPACE_INPUT');
 return value.trim();
}
function money(value){if(value==null||value==='')return null;if(!Number.isSafeInteger(value)||value<0||value>100000000000)throw Error('INVALID_WORKSPACE_MONEY');return value;}
function date(value){if(value==null||value==='')return null;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw Error('INVALID_WORKSPACE_DATE');return value;}
function choice(value,allowed,fallback){if(value===undefined)return fallback;if(!allowed.includes(value))throw Error('INVALID_WORKSPACE_INPUT');return value;}
function validate(kind,input){
 if(!KINDS.includes(kind)||!input||typeof input!=='object'||Array.isArray(input))throw Error('INVALID_WORKSPACE_INPUT');
 if(kind==='research'&&input.sourceUrl)require('./publicWebsite').url(input.sourceUrl);
 if(kind==='personas')return {name:string(input.name,120,true),audience:string(input.audience,1000,true),pains:string(input.pains,2000),desires:string(input.desires,2000),channels:string(input.channels,500),notes:string(input.notes,2000)};
 if(kind==='research')return {title:string(input.title,160,true),question:string(input.question,2000,true),findings:string(input.findings,6000),sourceUrl:string(input.sourceUrl,2000),status:choice(input.status,['PLANNED','IN_PROGRESS','COMPLETE'],'PLANNED')};
 if(kind==='products')return {name:string(input.name,120,true),audience:string(input.audience,1000),promise:string(input.promise,1000),priceMinor:money(input.priceMinor),costMinor:money(input.costMinor),currency:choice(input.currency,['ILS','USD','EUR'],'ILS'),active:choice(input.active,[true,false],true)};
 if(kind==='content')return {title:string(input.title,160,true),body:string(input.body,8000,true),channel:choice(input.channel,['Facebook','Instagram'],'Facebook'),date:date(input.date),status:'DRAFT'};
 if(kind==='tasks')return {title:string(input.title,160,true),note:string(input.note,2000),date:date(input.date),status:choice(input.status,['OPEN','DONE'],'OPEN')};
 const amount=money(input.amountMinor);if(amount===null)throw Error('INVALID_WORKSPACE_MONEY');
 return {title:string(input.title,160,true),amountMinor:amount,currency:choice(input.currency,['ILS','USD','EUR'],'ILS'),date:date(input.date),category:string(input.category,120)};
}
async function list(clientId,kind){
 if(!KINDS.includes(kind))throw Error('INVALID_WORKSPACE_INPUT');
 const r=await db.query('SELECT id,payload,version,created_at,updated_at FROM workspace_items WHERE client_id=$1 AND kind=$2 ORDER BY created_at DESC,id DESC LIMIT 201',[clientId,kind]);
 return {items:r.rows.slice(0,200),hasMore:r.rows.length>200};
}
async function save(clientId,kind,input,{id,version,requestId}={}){
 const payload=validate(kind,input);
 if(!uuid(requestId)||id!==undefined&&(!uuid(id)||!Number.isSafeInteger(version)||version<1))throw Error('INVALID_WORKSPACE_INPUT');
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify({kind,id:id||null,version:version||null,payload})).digest('hex');
 return db.transaction(async tx=>{
  const client=await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[clientId]);if(!client.rows.length)throw Error('CLIENT_NOT_FOUND');
  const cached=(await tx('SELECT fingerprint,result FROM workspace_requests WHERE client_id=$1 AND request_id=$2',[clientId,requestId])).rows[0];
  if(cached){if(cached.fingerprint!==fingerprint)throw Error('WORKSPACE_REQUEST_CONFLICT');return cached.result;}
  let result;
  if(id){
   result=(await tx('UPDATE workspace_items SET payload=$4::jsonb,version=version+1,updated_at=NOW() WHERE client_id=$1 AND kind=$2 AND id=$3 AND version=$5 RETURNING id,payload,version,created_at,updated_at',[clientId,kind,id,JSON.stringify(payload),version])).rows[0];
   if(!result)throw Error('WORKSPACE_STALE');
  }else result=(await tx('INSERT INTO workspace_items(id,client_id,kind,payload) VALUES($1,$2,$3,$4::jsonb) RETURNING id,payload,version,created_at,updated_at',[crypto.randomUUID(),clientId,kind,JSON.stringify(payload)])).rows[0];
  await tx('INSERT INTO workspace_requests(client_id,request_id,fingerprint,result) VALUES($1,$2,$3,$4::jsonb)',[clientId,requestId,fingerprint,JSON.stringify(result)]);
  await tx('INSERT INTO tenant_audit(client_id,event,result) VALUES($1,$2,$3)',[clientId,'WORKSPACE_'+kind.toUpperCase(),id?'UPDATED':'CREATED']);
  return result;
 });
}
async function saveBrand(clientId,input){
 const businessName=string(input?.businessName,120,true),businessType=string(input?.businessType,500),logo=string(input?.logo,2000);
 if(logo){try{require('./publicWebsite').url(logo);if(new URL(logo).hash)throw Error('HASH');}catch{throw Error('INVALID_BRAND_LOGO');}}
 if(!Array.isArray(input?.colors)||input.colors.length!==5||input.colors.some(c=>typeof c!=='string'||!/^#[0-9a-f]{6}$/i.test(c)))throw Error('INVALID_BRAND_COLORS');
 if(!Number.isSafeInteger(input.version)||input.version<0)throw Error('INVALID_WORKSPACE_INPUT');
 return require('./marketingStore').update(clientId,null,p=>{
  if((p.version||0)!==input.version)throw Error('WORKSPACE_STALE');
  const facts=require('./conversationFacts');const changed=[];
  if(facts.write(p,'businessName',businessName,{source:'portal_explicit',evidence:businessName}))changed.push('businessName');
  if(facts.write(p,'businessType',businessType||null,{status:businessType?'known':'unknown',source:'portal_explicit',evidence:businessType}))changed.push('businessType');
  p.brand={...(p.brand||{}),logo:logo||null,colors:input.colors.map(c=>c.toUpperCase())};
  facts.correctionsInvalidate(p,[...changed,'brand']);
  return {handled:false,changed:true,audit:'PORTAL_BRAND_SAVED',saved:true};
 });
}
module.exports={KINDS,uuid,validate,list,save,saveBrand};
