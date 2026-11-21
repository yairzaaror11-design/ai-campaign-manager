'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),axios=require('axios');
const {createActionPlan,formatActionPlan}=require('../actionPlan'),{strictPlan}=require('../approvalPolicy'),forms=require('../metaLeadForms');
const parameters=()=>({name:'Recruitment form',pageId:'555',locale:'HE_IL',privacyPolicyUrl:'https://business.example/privacy',questions:[{type:'FULL_NAME'},{type:'PHONE'},{type:'CUSTOM',key:'experience',label:'What relevant experience do you have?'}]});
test('form proposals require contact, explicit privacy policy, supported bounded questions and exact review',()=>{
 const plan=createActionPlan({intent:'CREATE_LEAD_FORM',target:{accountId:'act_11'},parameters:parameters()});
 assert.equal(plan.requiresApproval,true);strictPlan(plan);
 assert.match(formatActionPlan(plan),/experience/);assert.match(formatActionPlan(plan),/business.example\/privacy/);
 for(const patch of [{privacyPolicyUrl:'http://127.0.0.1/private'},{questions:[{type:'FULL_NAME'}]},{questions:[{type:'FULL_NAME'},{type:'PHONE'},{type:'CUSTOM',key:'x',label:'Question',options:['unreviewed']}]},{questions:[{type:'FULL_NAME'},{type:'PHONE'},{type:'DATE_OF_BIRTH'}]},{questions:[{type:'FULL_NAME'},{type:'PHONE'},{type:'PHONE'}]},{locale:'invented'}]){
  assert.throws(()=>strictPlan({...plan,parameters:{...parameters(),...patch}}));
 }
 assert.throws(()=>strictPlan({...plan,parameters:{...parameters(),status:'ACTIVE'}}),/UNSUPPORTED/);
});

test('approved form creation uses granted Page credentials, verifies fields, blocks replays and mismatched Pages',async t=>{
 const env={...process.env},get=axios.get,post=axios.post;
 const h=await require('./helpers/database').openDatabase(),meta=require('../metaConnection');
 Object.assign(process.env,{META_TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),APPROVAL_HMAC_KEY:crypto.randomBytes(32).toString('hex'),META_APP_ID:'123',META_APP_SECRET:'test-secret',META_LOGIN_CONFIG_ID:'456',APP_PUBLIC_URL:'https://campaign.example',META_WRITES_ENABLED:'true',READ_ONLY:'false'});
 const a=await require('../clientStore').getOrCreateClient('972500001111'),b=await require('../clientStore').getOrCreateClient('972500002222');
 for(const c of [a,b]){
  await h.db.query("INSERT INTO meta_connections(client_id,meta_user_id,token_ciphertext,app_id,expires_at) VALUES($1,$2,$3,'123',NOW()+INTERVAL '1 hour')",[c.id,'user-'+c.id,meta.encrypt('user-token-'+c.id,c.id)]);
  await h.db.query('UPDATE clients SET meta_ad_account_id=$2 WHERE id=$1',[c.id,'act_11']);
 }
 let writes=0,wrongPage=false,wrongQuestions=false,fail=false;
 axios.get=async(url,options)=>{
  const userToken='Bearer user-token-'+a.id;
  if(url.endsWith('/me/permissions'))return{data:{data:[{permission:'ads_management',status:'granted'}]}};
  if(url.endsWith('/act_11'))return{data:{id:'act_11',currency:'ILS',name:'Account',timezone_name:'Asia/Jerusalem'}};
  if(url.endsWith('/me/accounts')){
   const granted=options.headers.Authorization===userToken;
   return{data:{data:granted?[{id:'555',name:'Business Page',access_token:'private-page-token'}]:[]}};
  }
  if(url.endsWith('/555/leadgen_forms'))return{data:{data:[{id:'777',name:'Form'}]}};
  if(url.endsWith('/777')){assert.equal(options.headers.Authorization,'Bearer private-page-token');return{data:{id:'777',page_id:wrongPage?'999':'555',name:parameters().name,locale:'HE_IL',privacy_policy_url:parameters().privacyPolicyUrl,questions:wrongQuestions?[]:parameters().questions,status:'ACTIVE'}};}
  throw Error('Unexpected GET');
 };
 axios.post=async(url,body,options)=>{
  writes++;assert.ok(url.endsWith('/555/leadgen_forms'));assert.equal(options.headers.Authorization,'Bearer private-page-token');assert.equal(body.get('access_token'),null);assert.equal(body.get('status'),null);
  assert.deepEqual(JSON.parse(body.get('questions')),parameters().questions);assert.equal(JSON.parse(body.get('privacy_policy')).url,parameters().privacyPolicyUrl);
  if(fail)throw Error('provider uncertainty private-page-token');return{data:{id:'777'}};
 };
 const approve=async()=>{
  const issued=await require('../approvalEngine').createApproval(a.phone,createActionPlan({intent:'CREATE_LEAD_FORM',summary:'Create recruitment form for review',target:{accountId:'act_11'},parameters:parameters()}));
  return(await require('../approvalEngine').consumeApproval(a.phone,issued.code)).approval.actionPlan;
 };
 try{
  await t.test('Page read tools never return credentials or cross tenant Pages',async()=>{
   await meta.context.run(String(a.id),async()=>{assert.deepEqual((await forms.pages()).pages,[{id:'555',name:'Business Page'}]);assert.equal((await forms.list('555')).forms[0].id,'777');});
   await assert.rejects(meta.context.run(String(b.id),()=>forms.list('555')),/PAGE_NOT_GRANTED/);
  });
  await t.test('approval is required and successful execution is not repeated',async()=>{
   await assert.rejects(meta.context.run(String(a.id),()=>require('../metaWrite').createLeadForm({parameters:parameters()})),/APPROVED/);
   const plan=await approve();
   await meta.context.run(String(a.id),async()=>{
    const result=await require('../actionExecutor').executeApprovedAction(a.phone,plan);assert.equal(result.ok,true,JSON.stringify(result));
    assert.equal((await require('../actionExecutor').executeApprovedAction(a.phone,plan)).ok,false);
   });assert.equal(writes,1);
  });
  await t.test('wrong Page or altered questions cannot count as verified',async()=>{
   for(const mode of ['page','questions']){
    wrongPage=mode==='page';wrongQuestions=mode==='questions';
    const plan=await approve();
    const result=await meta.context.run(String(a.id),()=>require('../actionExecutor').executeApprovedAction(a.phone,plan));assert.equal(result.reason,'MANUAL_REVIEW');
   }wrongPage=false;wrongQuestions=false;
  });
  await t.test('uncertain form creation is never automatically retried',async()=>{
   fail=true;const plan=await approve(),before=writes;
   await meta.context.run(String(a.id),async()=>{
    assert.equal((await require('../actionExecutor').executeApprovedAction(a.phone,plan)).reason,'MANUAL_REVIEW');
    assert.equal((await require('../actionExecutor').executeApprovedAction(a.phone,plan)).ok,false);
   });assert.equal(writes,before+1);
  });
 }finally{axios.get=get;axios.post=post;await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});

test('lead form creative requires same Page and verifies the actual form attachment',async()=>{
 const meta=require('../metaConnection'),execution=require('../metaExecution'),write=require('../metaWrite'),verify=require('../metaVerify');
 const graph=meta.graph,credentials=meta.credentials,permit=execution.assertPermit,post=axios.post,env={...process.env};
 const plan=createActionPlan({intent:'CREATE_CREATIVE',target:{accountId:'act_11'},parameters:{name:'Recruitment ad',pageId:'555',formId:'777',link:'https://business.example/jobs',message:'Join our team',headline:'Job opening',imageHash:'image-hash'}});
 strictPlan(plan);let calls=0,wrongPage=false,wrongAttachment=false;
 Object.assign(process.env,{META_WRITES_ENABLED:'true',READ_ONLY:'false',META_TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),META_APP_ID:'123',META_APP_SECRET:'secret',META_LOGIN_CONFIG_ID:'456',APP_PUBLIC_URL:'https://campaign.example'});
 execution.assertPermit=()=>({clientId:'1',token:'user-token',plan});meta.credentials=async()=>({token:'user-token'});
 meta.graph=async path=>{
  if(path==='/me/accounts')return{data:[{id:'555',access_token:'page-token'}]};
  if(path==='/777')return{id:'777',page_id:wrongPage?'999':'555'};
  if(path==='/888')return{id:'888',account_id:'11',name:plan.parameters.name,object_story_spec:{link_data:{call_to_action:{value:{lead_gen_form_id:wrongAttachment?'999':'777'}}}}};
  throw Error('Unexpected graph request');
 };
 axios.post=async(_url,body)=>{calls++;const spec=JSON.parse(body.get('object_story_spec'));assert.equal(spec.page_id,'555');assert.equal(spec.link_data.call_to_action.value.lead_gen_form_id,'777');return{data:{id:'888'}};};
 try{
  await meta.context.run('1',async()=>{
   const result=await write.createCreative(plan);assert.equal((await verify.verifyAction(plan,result)).verified,true);
   wrongAttachment=true;assert.equal((await verify.verifyAction(plan,result)).verified,false);
   wrongPage=true;await assert.rejects(write.createCreative(plan),/FORM_PAGE_MISMATCH/);assert.equal(calls,1);
  });
 }finally{meta.graph=graph;meta.credentials=credentials;execution.assertPermit=permit;axios.post=post;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
