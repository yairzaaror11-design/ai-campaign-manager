'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {errorSummary}=require('../scripts/live-readiness');
test('live readiness reports classify failures without leaking provider bodies or credentials',()=>{
 const error={message:'secret-token',config:{headers:{Authorization:'Bearer secret-token'}},response:{status:401,data:{error:{code:190,error_subcode:463,message:'secret-token'}}}};
 const summary=errorSummary(error);
 assert.equal(summary.httpStatus,401);assert.equal(summary.providerCode,190);assert.equal(summary.providerSubcode,463);
 assert.equal(JSON.stringify(summary).includes('secret-token'),false);
});
test('default readiness uses injected environment bindings and read-only provider requests',async()=>{
 const axios=require('axios'),get=axios.get,post=axios.post;const calls=[];
 axios.get=async(url,options)=>{
  calls.push(url);assert.equal(options.maxRedirects,0);
  if(url.endsWith('/me/adaccounts'))return{data:{data:[{id:'act_1',account_status:1}]}};
  if(url.endsWith('/me/permissions'))return{data:{data:[{permission:'ads_read',status:'granted'}]}};
  if(url.endsWith('/123'))return{data:{id:'123',code_verification_status:'VERIFIED'}};
  if(url.endsWith('/models'))return{data:{models:[{name:'models/gemini-fixture',supportedGenerationMethods:['generateContent']}]}};
  throw Error('UNEXPECTED_ENDPOINT');
 };
 axios.post=async()=>{throw Error('GENERATION_MUST_NOT_RUN');};
 try{
  const results=await require('../scripts/live-readiness').run({values:{META_ACCESS_TOKEN:'fixture-meta',WHATSAPP_ACCESS_TOKEN:'fixture-wa',WHATSAPP_PHONE_NUMBER_ID:'123',GEMINI_API_KEY:'fixture-gemini',GEMINI_MODEL:'gemini-fixture'}});
  assert.equal(results.length,4);assert.ok(results.every(r=>r.status==='PASSED'));
  assert.equal(calls.length,4);assert.equal(results.at(-1).generationTested,false);
  assert.doesNotMatch(JSON.stringify(results),/fixture-meta|fixture-wa|fixture-gemini/);
 }finally{axios.get=get;axios.post=post;}
});
test('missing bindings and unapproved generation make no network requests',async()=>{
 const axios=require('axios'),get=axios.get,post=axios.post;let calls=0;
 axios.get=axios.post=async()=>{calls++;throw Error('UNEXPECTED_NETWORK');};
 try{
  const results=await require('../scripts/live-readiness').run({values:{}});
  assert.ok(results.every(r=>r.status==='NOT_CONFIGURED'));
  const generation=await require('../scripts/live-readiness').run({values:{GEMINI_API_KEY:'fixture'},targets:['GEMINI_CAMPAIGN_UNDERSTANDING']});
  assert.equal(generation[0].status,'APPROVAL_REQUIRED');assert.equal(calls,0);
  await assert.rejects(require('../scripts/live-readiness').run({targets:['UNKNOWN'],values:{}}),/INVALID_READINESS_TARGETS/);
 }finally{axios.get=get;axios.post=post;}
});
test('CLI fails readiness when a required binding is missing without printing credentials',()=>{
 const {spawnSync}=require('node:child_process');
 const result=spawnSync(process.execPath,['scripts/live-readiness.js','--env','WHATSAPP_PHONE_ACCESS'],{cwd:require('node:path').join(__dirname,'..'),env:{...process.env,WHATSAPP_ACCESS_TOKEN:'',WHATSAPP_PHONE_NUMBER_ID:''},encoding:'utf8'});
 assert.equal(result.status,1);const data=JSON.parse(result.stdout);
 assert.equal(data.results[0].status,'NOT_CONFIGURED');assert.equal(data.results[0].messagesSent,0);
});
test('an explicitly authorized generation probe preserves the structured-response check',async()=>{
 const axios=require('axios'),get=axios.get,post=axios.post;let generations=0;
 axios.get=async()=>({data:{models:[{name:'models/gemini-fixture',supportedGenerationMethods:['generateContent']}]}});
 axios.post=async(url,body)=>{
  generations++;assert.match(url,/gemini-fixture:generateContent$/);
  assert.equal(body.generationConfig.maxOutputTokens,768);
  return{data:{candidates:[{content:{parts:[{text:JSON.stringify({objective:'OUTCOME_LEADS',dailyBudget:100,currency:'ILS',requiresApproval:true,missing:['שם העסק']})}]}}]}};
 };
 try{
  const {run}=require('../scripts/live-readiness');
  const options={values:{GEMINI_API_KEY:'fixture',GEMINI_MODEL:'gemini-fixture'},targets:['GEMINI_CAMPAIGN_UNDERSTANDING']};
  assert.equal((await run({...options,allowGeneration:'true'}))[0].status,'APPROVAL_REQUIRED');
  assert.equal(generations,0);
  const result=await run({...options,allowGeneration:true});
  assert.equal(result[0].status,'PASSED');assert.equal(result[0].requiresApproval,true);assert.equal(generations,1);
 }finally{axios.get=get;axios.post=post;}
});
