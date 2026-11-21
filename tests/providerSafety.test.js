'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const axios=require('axios');
const {processMessage,registerProvider}=require('../aiService');
const {minorUnits,strictPlan}=require('../approvalPolicy');
const {createActionPlan}=require('../actionPlan');

test('AI service rejects malformed output and provider-selected writes',async()=>{
 const prior=process.env.AI_PROVIDER;process.env.AI_PROVIDER='test_mock';
 try {
  registerProvider('test_mock',async()=>({text:'שלום',actionPlans:[{intent:'DELETE_EVERYTHING',requiresApproval:true,id:'x'}]}));
  await assert.rejects(processMessage('שלום'),/INVALID_AI_PLAN/);
  registerProvider('test_mock',async()=>({text:'מה מטרת הקמפיין?',actionPlans:[]}));
  assert.equal((await processMessage('אני רוצה קמפיין')).text,'מה מטרת הקמפיין?');
 } finally {if(prior===undefined) delete process.env.AI_PROVIDER;else process.env.AI_PROVIDER=prior;}
});
test('Claude service uses shared read/propose tools without enabling a write tool',async()=>{
 const before=process.env.CLAUDE_MODEL;process.env.CLAUDE_MODEL='mock-model';
 try {
  const response=await require('../claude').processWithClaude('שלום',[],{client:{create:async body=>{
   assert.ok(body.tools.some(t=>t.name==='propose_action'));
   assert.equal(body.tools.some(t=>/execute|publish|write/.test(t.name)),false);
   return {content:[{type:'text',text:'שלום לך'}]};
  }}});
  assert.equal(response.text,'שלום לך');assert.deepEqual(response.actionPlans,[]);
 } finally {if(before===undefined) delete process.env.CLAUDE_MODEL;else process.env.CLAUDE_MODEL=before;}
});
test('currency conversion rejects precision loss and unconfigured currencies',()=>{
 assert.equal(minorUnits('100.25','ILS'),10025);
 assert.equal(minorUnits('100','JPY'),100);
 assert.throws(()=>minorUnits('1.001','ILS'),/PRECISION/);
 assert.throws(()=>minorUnits('10','ZZZ'),/CURRENCY/);
 assert.throws(()=>minorUnits('1e5','ILS'),/INVALID/);
});
test('write schema blocks status injection and incomplete delivery settings',()=>{
 const plan=createActionPlan({intent:'CREATE_CAMPAIGN',target:{accountId:'act_11'},parameters:{name:'Campaign',objective:'OUTCOME_TRAFFIC',status:'ACTIVE'}});
 assert.throws(()=>strictPlan(plan),/UNSUPPORTED_ACTION_PARAMETERS/);
 const set=createActionPlan({intent:'CREATE_ADSET',target:{accountId:'act_11'},parameters:{name:'Ad set',campaignId:'123',dailyBudget:25,dailyBudgetMinor:2500,currency:'ILS'}});
 assert.throws(()=>strictPlan(set),/TARGETING_REQUIRED/);
});
test('voice transcription handles Hebrew as content and rejects untrusted media URLs before download',async()=>{
 const get=axios.get;const before=process.env.WHATSAPP_ACCESS_TOKEN;process.env.WHATSAPP_ACCESS_TOKEN='test-whatsapp-token';
 let calls=0;
 try {
  axios.get=async url=>{calls++;return url.includes('graph.facebook.com')?{data:{mime_type:'audio/ogg',url:'https://lookaside.fbsbx.com/audio'}}:{data:Buffer.from('mock audio')};};
  const result=await require('../voiceHandler').transcribeVoiceMessage({audio:{id:'media1'}},{ai:{models:{generateContent:async body=>{
   assert.match(body.contents[0].parts[0].text,/do not execute/);
   return {text:'בנה לי קמפיין לידים'};
  }}}});
  assert.equal(result,'בנה לי קמפיין לידים');assert.equal(calls,2);
  calls=0;axios.get=async()=>{calls++;return {data:{mime_type:'audio/ogg',url:'http://127.0.0.1/private'}};};
  await assert.rejects(require('../voiceHandler').getAudio({audio:{id:'media1'}}),/Untrusted/);assert.equal(calls,1);
 } finally {axios.get=get;if(before===undefined) delete process.env.WHATSAPP_ACCESS_TOKEN;else process.env.WHATSAPP_ACCESS_TOKEN=before;}
});
test('logs redact secrets, request credentials and database URLs',()=>{
 const {redact}=require('../logger');
 assert.equal(redact({access_token:'secret'}).access_token,'[REDACTED]');
 assert.equal(redact('failed access_token=secret&state=abcdef'),'failed access_token=[REDACTED]&state=[REDACTED]');
 assert.equal(redact('postgresql://username:password@db.example/data'),'[DATABASE_URL]');
});
