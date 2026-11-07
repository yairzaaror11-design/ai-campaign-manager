'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),axios=require('axios');
const {openDatabase}=require('./helpers/isolatedDatabase');
test('authenticated owner scope flows from HTTP consent through voice/task execution, rechecks revocation, and never authorizes spend',async()=>{
 const env={...process.env},h=await openDatabase(),meta=require('../metaConnection'),authority=require('../scopedAuthority'),wa=require('../whatsapp'),voice=require('../voiceHandler');
 const before={get:axios.get,post:axios.post,send:wa.safeSend,voice:voice.transcribeVoiceMessage,authorize:authority.approveIfCovered};
 const phone='972500077001',otherPhone='972500077002',sent=[];
 Object.assign(process.env,{APP_PUBLIC_URL:'https://scorpio.example',META_APP_ID:'123',META_APP_SECRET:'fixture',META_LOGIN_CONFIG_ID:'456',META_TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),APPROVAL_HMAC_KEY:crypto.randomBytes(32).toString('hex'),SCOPED_AUTOMATION_ENABLED:'true',READ_ONLY:'false',META_WRITES_ENABLED:'true',WHATSAPP_SEND_ENABLED:'false',UNIFIED_CONVERSATION_ENABLED:'true',TASK_AGENT_ENABLED:'true',TASK_AGENT_REQUIRE_EVAL:'false',TASK_AGENT_PILOT_ONLY:'true',AUTHORIZED_PHONE_NUMBERS:phone,PUBLIC_ONBOARDING_ENABLED:'false',AI_PROVIDER:'authority_fixture'});
 const a=await require('../clientStore').getOrCreateClient(phone),b=await require('../clientStore').getOrCreateClient(otherPhone);
 for(const c of [a,b]){await h.db.query("INSERT INTO meta_connections(client_id,meta_user_id,token_ciphertext,app_id,expires_at) VALUES($1,'fixture',$2,'123',NOW()+INTERVAL '1 hour')",[c.id,meta.encrypt('fixture-token',c.id)]);await h.db.query("UPDATE clients SET meta_ad_account_id='act_11' WHERE id=$1",[c.id]);}
 const parameters={name:'מחסנאי בחיפה',pageId:'555',locale:'HE_IL',privacyPolicyUrl:'https://business.example/privacy',questions:[{type:'FULL_NAME'},{type:'PHONE'}]};
 let writes=0,changeProposal=false;
 axios.get=async url=>{
  if(url.endsWith('/act_11'))return{data:{id:'act_11',name:'Fixture account',currency:'ILS',timezone_name:'Asia/Jerusalem'}};
  if(url.endsWith('/me/permissions'))return{data:{data:[{permission:'ads_management',status:'granted'}]}};
  if(url.endsWith('/me/accounts'))return{data:{data:[{id:'555',name:'Fixture page',access_token:'fixture-page'}]}};
  if(url.endsWith('/777'))return{data:{id:'777',page_id:'555',name:parameters.name,locale:parameters.locale,privacy_policy_url:parameters.privacyPolicyUrl,questions:parameters.questions,status:'ACTIVE'}};
  throw Error('UNEXPECTED_FIXTURE_READ');
 };
 axios.post=async url=>{assert.ok(url.endsWith('/555/leadgen_forms'));writes++;return{data:{id:'777'}};};
 const plan=[{id:'copy',label:'שאלות הטופס',kind:'draft',dependsOn:[]},{id:'form',label:'יצירת טופס',kind:'meta',intent:'CREATE_LEAD_FORM',dependsOn:['copy']}];
 require('../aiService').registerProvider('authority_fixture',async raw=>{
  const c=JSON.parse(raw);let next;
  if(!c.plan.length)next={op:'draft',stepId:'copy',title:'טופס מועמדות',content:JSON.stringify(parameters)};
  else if(c.plan[0].status==='PREPARED')next={op:'review'};
  else if(c.plan[1].status!=='DONE')next={op:'meta',stepId:'form',proposal:{intent:'CREATE_LEAD_FORM',summary:'יצירת טופס מועמדות',target:{accountId:'act_11'},parameters:changeProposal?{...parameters,name:'תוכן ששונה אחרי האישור'}:parameters}};
  else next={op:'finish'};
  return{text:JSON.stringify({...(!c.plan.length?{plan}:{}),next}),actionPlans:[]};
 });
 wa.safeSend=async(_to,text)=>sent.push(text);voice.transcribeVoiceMessage=async()=> 'תכין טופס מועמדות למחסנאי בחיפה';
 delete require.cache[require.resolve('../messageHandler')];const incoming=require('../messageHandler').handleIncomingMessage;
 const send=(id,text,audio=false)=>incoming({id,from:phone,timestamp:String(Math.floor(Date.now()/1000)),type:audio?'audio':'text',...(audio?{audio:{id:'fixture-audio'}}:{text:{body:text}})});
 const app=require('../index'),server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));}),root='http://127.0.0.1:'+server.address().port;
 const call=(path,body,session,csrf=session?.csrf)=>fetch(root+path,{method:body?'POST':'GET',headers:{...(session?{Cookie:session.cookie}:{}),...(body?{Origin:'https://scorpio.example','Content-Type':'application/json','X-CSRF-Token':csrf||''}:{})},body:body?JSON.stringify(body):undefined});
 async function login(c){const url=await require('../portalStore').createTicket(c.id),r=await call('/app/api/login',{token:url.split('#login=')[1]});assert.equal(r.status,200);const cookies=r.headers.getSetCookie().map(c=>c.split(';')[0]);return{cookie:cookies.join('; '),csrf:cookies.find(c=>c.startsWith('cb_csrf=')).split('=')[1]};}
 const input=(extra={})=>({requestId:crypto.randomUUID(),label:'יצירת טופס מוגבלת',intents:['CREATE_LEAD_FORM'],pageIds:['555'],currency:'ILS',maxActions:1,expiresAt:new Date(Date.now()+3600000).toISOString(),...extra});
 async function grant(session,extra={}){const r=await call('/app/api/authority/proposals',input(extra),session);assert.equal(r.status,200);const p=await r.json();const approved=await call('/app/api/authority/'+p.id+'/approve',{revision:p.revision,confirmHash:p.hash,confirmation:'APPROVE_SCOPED_AUTHORITY'},session);assert.equal(approved.status,200);return approved.json();}
 try{
  assert.equal((await call('/app/api/authority')).status,401);const sa=await login(a),sb=await login(b);
  assert.equal((await call('/app/api/authority/proposals',input(),sa,'wrong')).status,403);
  assert.equal((await call('/app/api/authority/proposals',input({clientId:b.id,role:'OWNER'}),sa)).status,400);
  assert.equal((await call('/app/api/authority/proposals',input({intents:['ACTIVATE_BUNDLE']}),sa)).status,400);
  assert.equal((await call('/app/api/authority/proposals',input({intents:['CHANGE_BUDGET']}),sa)).status,400);
  assert.equal((await call('/app/api/authority/proposals',input({intents:['CREATE_BUNDLE']}),sa)).status,400);
  assert.equal((await call('/app/api/authority/proposals',input({expiresAt:new Date(Date.now()-1).toISOString()}),sa)).status,400);
  const request=input(),proposalResponse=await call('/app/api/authority/proposals',request,sa),proposal=await proposalResponse.json();assert.equal(proposal.status,'DRAFT');assert.equal(proposal.policy.accountId,'act_11');assert.equal(proposal.spendingAuthorized,false);assert.equal(proposal.remainingActions,0);
  const replay=await(await call('/app/api/authority/proposals',request,sa)).json();assert.equal(replay.id,proposal.id);
  assert.equal((await call('/app/api/authority/proposals',{...request,maxActions:2},sa)).status,409);
  assert.equal((await call('/app/api/authority/'+proposal.id+'/approve',{revision:1,confirmHash:'0'.repeat(64),confirmation:'APPROVE_SCOPED_AUTHORITY'},sa)).status,409);
  assert.equal((await call('/app/api/authority/'+proposal.id+'/approve',{revision:1,confirmHash:proposal.hash,confirmation:'APPROVE_SCOPED_AUTHORITY'},sb)).status,409);
  assert.deepEqual((await(await call('/app/api/authority',null,sb)).json()).mandates,[]);
  assert.equal((await call('/app/api/authority/'+proposal.id+'/approve',{revision:1,confirmHash:proposal.hash,confirmation:'APPROVE_SCOPED_AUTHORITY'},sa)).status,200);
  await assert.rejects(meta.context.run(String(a.id),()=>authority.propose(a.id,input())),/OWNER_REQUIRED/);
  await assert.rejects(authority.list(a.id),/TENANT_CONTEXT_REQUIRED/);
  authority.approveIfCovered=async(client,plan)=>{process.env.READ_ONLY='true';assert.equal(await before.authorize(client,plan),false);process.env.READ_ONLY='false';const decisions=await Promise.all([before.authorize(client,plan),before.authorize(client,plan)]);assert.deepEqual(decisions.sort(),[false,true]);return true;};
  await send('voice-request',null,true);assert.match(sent.at(-1),/מאשר את התוכן/);assert.equal(writes,0);
  await send('review-approval','מאשר את החבילה');assert.equal(writes,1);assert.equal((await require('../taskAgent').current(a.id)).status,'COMPLETE');assert.match(sent.at(-1),/אומתו מול Meta/);
  await send('review-approval','מאשר את החבילה');assert.equal(writes,1);
  const state=(await(await call('/app/api/authority',null,sa)).json()).mandates[0];assert.equal(state.usedActions,1);assert.equal(state.remainingActions,0);
  const usedReplay=await(await call('/app/api/authority/proposals',request,sa)).json();assert.equal(usedReplay.usedActions,1);assert.equal(usedReplay.remainingActions,0);
  authority.approveIfCovered=before.authorize;
  await grant(sa,{pageIds:['999']});
  await send('next-request','תכין טופס מועמדות נוסף');await send('next-review','מאשר את החבילה');assert.equal((await require('../taskAgent').current(a.id)).status,'WAITING_APPROVAL');assert.equal(writes,1);assert.match(sent.at(-1),/נדרש אישור מפורש/);
  await meta.context.run(String(a.id),()=>require('../taskAgent').cancel(a.id));
  const contentBound=await grant(sa);changeProposal=true;
  await send('changed-content-request','תכין טופס מועמדות');await send('changed-content-review','מאשר את החבילה');assert.equal(writes,1);assert.equal((await require('../taskAgent').current(a.id)).status,'WAITING_APPROVAL');
  assert.equal((await(await call('/app/api/authority',null,sa)).json()).mandates.find(m=>m.id===contentBound.id).remainingActions,1);
  await call('/app/api/authority/'+contentBound.id+'/revoke',{revision:contentBound.revision},sa);await meta.context.run(String(a.id),()=>require('../taskAgent').cancel(a.id));changeProposal=false;
  const revocable=await grant(sa);
  authority.approveIfCovered=async(client,plan)=>{const ok=await before.authorize(client,plan);if(ok){const r=await call('/app/api/authority/'+revocable.id+'/revoke',{revision:revocable.revision},sa);assert.equal(r.status,200);}return ok;};
  await send('revoked-request','תכין טופס מועמדות');await send('revoked-review','מאשר את החבילה');assert.equal(writes,1);assert.equal((await require('../taskAgent').current(a.id)).status,'BLOCKED');
  assert.equal((await h.db.query("SELECT COUNT(*)::int AS n FROM meta_execution_attempts WHERE status='BLOCKED'")).rows[0].n,1);
  const pB=await(await call('/app/api/authority/proposals',input(),sb)).json();await h.db.query('UPDATE clients SET meta_generation=meta_generation+1 WHERE id=$1',[b.id]);
  assert.equal((await call('/app/api/authority/'+pB.id+'/approve',{revision:1,confirmHash:pB.hash,confirmation:'APPROVE_SCOPED_AUTHORITY'},sb)).status,409);
  process.env.SCOPED_AUTOMATION_ENABLED='false';assert.equal((await call('/app/api/authority/proposals',input(),sa)).status,403);assert.ok((await(await call('/app/api/authority',null,sa)).json()).mandates.every(m=>m.remainingActions===0));
  assert.equal((await call('/app/api/authority/'+proposal.id+'/revoke',{revision:2},sa)).status,200);
  assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM authority_audit WHERE client_id=$1',[a.id])).rows[0].n>=7,true);
  await h.db.query('DELETE FROM clients WHERE id=$1',[a.id]);
  for(const table of ['authority_mandates','authority_uses','authority_requests','authority_audit'])assert.equal(Number((await h.db.query('SELECT COUNT(*) AS n FROM '+table+' WHERE client_id=$1',[a.id])).rows[0].n),0);
  assert.equal((await call('/app/api/authority',null,sa)).status,401);
 }finally{axios.get=before.get;axios.post=before.post;wa.safeSend=before.send;voice.transcribeVoiceMessage=before.voice;authority.approveIfCovered=before.authorize;delete require.cache[require.resolve('../messageHandler')];await new Promise(resolve=>server.close(resolve));if(h.native)await h.db.query('DELETE FROM clients WHERE id=ANY($1::bigint[])',[[a.id,b.id]]);await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
