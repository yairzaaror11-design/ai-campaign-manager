'use strict';
// Isolated probes. This module imports no message handlers, workers or write adapters.
const fs=require('node:fs');
const axios=require('axios');
const dotenv=require('dotenv');
function errorSummary(error) {
 const code=error.response?.data?.error?.code;
 const subcode=error.response?.data?.error?.error_subcode;
 return {status:'FAILED',httpStatus:error.response?.status || null,providerCode:typeof code==='number'?code:null,providerSubcode:typeof subcode==='number'?subcode:null};
}
async function probe(name,work) {
 try {return {name,status:'PASSED',...await work()};}
 catch(error) {return {name,...errorSummary(error)};}
}
async function run({envFile,targets=null}) {
 const values=dotenv.parse(fs.readFileSync(envFile));
 const version=/^v\d+\.\d+$/.test(values.META_GRAPH_VERSION || '')?values.META_GRAPH_VERSION:'v26.0';
 const graph=(path,token,params={})=>axios.get('https://graph.facebook.com/'+version+path,{headers:{Authorization:'Bearer '+token},params,timeout:15000,maxRedirects:0}).then(r=>r.data);
 const results=[];
 if(!targets || targets.includes('META_ACCOUNT_ACCESS')) results.push(await probe('META_ACCOUNT_ACCESS',async()=>{
   if(!values.META_ADS_ACCESS_TOKEN) throw Error('missing');
   const accounts=await graph('/me/adaccounts',values.META_ADS_ACCESS_TOKEN,{fields:'id,account_status,currency',limit:100});
   return {accessibleAccounts:accounts.data?.length || 0,activeAccounts:accounts.data?.filter(a=>a.account_status===1).length || 0,partial:!!accounts.paging?.next,oauthFlowVerified:false};
 }));
 if(!targets || targets.includes('META_PERMISSION_ACCESS')) results.push(await probe('META_PERMISSION_ACCESS',async()=>{
   const permissions=await graph('/me/permissions',values.META_ADS_ACCESS_TOKEN);
   return {granted:(permissions.data || []).filter(p=>p.status==='granted').map(p=>p.permission),commercialApprovalVerified:false};
 }));
 if(!targets || targets.includes('WHATSAPP_PHONE_ACCESS')) results.push(await probe('WHATSAPP_PHONE_ACCESS',async()=>{
   if(!values.WHATSAPP_ACCESS_TOKEN?.trim()) return {status:'NOT_CONFIGURED',missing:'WHATSAPP_ACCESS_TOKEN',messagesSent:0};
   if(!/^\d+$/.test(values.WHATSAPP_PHONE_NUMBER_ID || '')) return {status:'NOT_CONFIGURED',missing:'WHATSAPP_PHONE_NUMBER_ID'};
   const phone=await graph('/'+values.WHATSAPP_PHONE_NUMBER_ID,values.WHATSAPP_ACCESS_TOKEN,{fields:'id,verified_name,quality_rating,code_verification_status'});
   return {phoneAccessible:!!phone.id,verification:phone.code_verification_status || null,quality:phone.quality_rating || null,messagesSent:0};
 }));
 if(!targets || targets.includes('GEMINI_CAMPAIGN_UNDERSTANDING')) results.push(await probe('GEMINI_CAMPAIGN_UNDERSTANDING',async()=>{
   if(!values.GEMINI_API_KEY) throw Error('missing');
   const available=(await axios.get('https://generativelanguage.googleapis.com/v1beta/models',{headers:{'x-goog-api-key':values.GEMINI_API_KEY},timeout:15000,maxRedirects:0})).data.models || [];
   const preferred=['gemini-3.8-flash','gemini-3.5-flash','gemini-2.5-flash'];
   const model=preferred.find(id=>available.some(m=>m.name==='models/'+id&&m.supportedGenerationMethods?.includes('generateContent')));
   if(!model) return {status:'NO_SUPPORTED_MODEL',modelsListed:available.length};
   const response=(await axios.post('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent',{
     contents:[{role:'user',parts:[{text:'לקוח אומר: בנה קמפיין לידים לעסק שלי בתקציב 100 שקל ביום. החזר JSON בלבד עם objective OUTCOME_LEADS, dailyBudget מספר, currency ILS, requiresApproval true ו-missing שאלות חסרות בעברית. אל תפעיל כלים ואל תבצע שום פעולה.'}]}],
     generationConfig:{maxOutputTokens:768,responseMimeType:'application/json'}
   },{headers:{'x-goog-api-key':values.GEMINI_API_KEY},timeout:30000,maxRedirects:0})).data;
   const text=(response.candidates?.[0]?.content?.parts || []).filter(p=>!p.thought).map(p=>p.text || '').join('');
   let parsed;try{parsed=JSON.parse(text);}catch{return {status:'INVALID_STRUCTURED_RESPONSE',model};}
   const valid=parsed.objective==='OUTCOME_LEADS'&&parsed.dailyBudget===100&&parsed.currency==='ILS'&&parsed.requiresApproval===true&&Array.isArray(parsed.missing)&&parsed.missing.length>0;
   return {status:valid?'PASSED':'SCHEMA_VALIDATION_FAILED',model,understandsHebrew:valid,requiresApproval:parsed.requiresApproval===true,missingFieldCount:Array.isArray(parsed.missing)?parsed.missing.length:0,externalActions:0};
 }));
 if(!targets || targets.includes('CLAUDE_API_ACCESS')) results.push(await probe('CLAUDE_API_ACCESS',async()=>{
   if(!values.ANTHROPIC_API_KEY?.trim()) return {status:'NOT_CONFIGURED',missing:'ANTHROPIC_API_KEY'};
   const response=await axios.get('https://api.anthropic.com/v1/models',{headers:{'x-api-key':values.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},timeout:15000,maxRedirects:0});
   return {modelsAvailable:response.data.data?.length || 0,generationTested:false};
 }));
 return results;
}
if(require.main===module) {
 const envFile=process.argv[2];
 if(!envFile) {console.error('Usage: node scripts/live-readiness.js <private-env-file>');process.exitCode=1;}
 else run({envFile,targets:process.argv[3]?process.argv[3].split(','):null}).then(results=>console.log(JSON.stringify({results},null,2))).catch(()=>{console.error('Readiness probe failed; no credentials logged');process.exitCode=1;});
}
module.exports={run,errorSummary};
