'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('crypto');
const axios=require('axios');
const {openDatabase}=require('./helpers/database');

test('production services with embedded PostgreSQL and mocked providers',async t=>{
 const env={...process.env};
 process.env.META_TOKEN_ENCRYPTION_KEY=crypto.randomBytes(32).toString('base64');
 process.env.APPROVAL_HMAC_KEY=crypto.randomBytes(32).toString('hex');
 process.env.DELETION_HMAC_KEY=crypto.randomBytes(32).toString('hex');
 process.env.META_APP_ID='123';process.env.META_APP_SECRET='secret';process.env.META_LOGIN_CONFIG_ID='456';process.env.APP_PUBLIC_URL='https://campaign.example';
 const harness=await openDatabase();const {db}=harness;
 const meta=require('../metaConnection');
 const clientStore=require('../clientStore');
 const approvals=require('../approvalEngine');
 const executor=require('../actionExecutor');
 const {createActionPlan}=require('../actionPlan');
 const originalGet=axios.get,originalPost=axios.post;
 let writes=0,failWrite=false;
 axios.get=async(url)=>{
  if(url.endsWith('/me/permissions')) return {data:{data:[{permission:'ads_read',status:'granted'},{permission:'ads_management',status:'granted'}]}};
  if(url.endsWith('/act_11')) return {data:{id:'act_11',currency:'ILS',name:'Business A',timezone_name:'Asia/Jerusalem'}};
  if(url.endsWith('/999')) return {data:{id:'999',account_id:'22'}};
  return {data:{id:'777',account_id:'11',status:'PAUSED',name:'Test campaign',objective:'OUTCOME_TRAFFIC'}};
 };
 axios.post=async()=>{writes++;if(failWrite) throw Error('unknown response with access_token=DO_NOT_LOG');return {data:{id:'777'}};};
 let a,b;
 const proposal=()=>createActionPlan({intent:'CREATE_CAMPAIGN',summary:'Create paused campaign',target:{accountId:'act_11'},parameters:{name:'Test campaign',objective:'OUTCOME_TRAFFIC'}});
 try {
  a=await clientStore.getOrCreateClient('972500000001');b=await clientStore.getOrCreateClient('972500000002');
  for(const c of [a,b]) {
   await db.query('INSERT INTO meta_connections(client_id,meta_user_id,token_ciphertext,app_id,expires_at) VALUES($1,$2,$3,\'123\',NOW()+INTERVAL \'1 hour\')',[c.id,'10'+c.id,meta.encrypt('token-'+c.id,c.id)]);
   await db.query('UPDATE clients SET meta_ad_account_id=$2,meta_user_id=$3 WHERE id=$1',[c.id,c.id===a.id?'act_11':'act_22','10'+c.id]);
  }
  await t.test('migration checksums and repeat initialization preserve rows',async()=>{
   await db.initializeDatabase();assert.equal((await db.query('SELECT * FROM schema_migrations')).rows.length,3);
   assert.equal((await db.query('SELECT id FROM clients')).rows.length,2);
  });
  await t.test('cross-tenant approval codes are rejected and stored as keyed digests',async()=>{
   const issued=await approvals.createApproval(a.phone,proposal());
   const stored=(await db.query('SELECT code FROM approvals WHERE action_id=$1',[issued.actionId])).rows[0].code;
   assert.notEqual(stored,issued.code);assert.equal(stored.length,64);
   assert.equal((await approvals.consumeApproval(b.phone,issued.code)).ok,false);
   const changed=structuredClone(issued.actionPlan);changed.parameters.name='Tampered';
   await db.query('UPDATE action_plans SET payload=$2::jsonb WHERE id=$1',[issued.actionId,JSON.stringify(changed)]);
   assert.equal((await approvals.consumeApproval(a.phone,issued.code)).reason,'STALE_PLAN');
  });
  await t.test('superseded and expired approvals never execute',async()=>{
   const old=await approvals.createApproval(a.phone,proposal());
   const latest=await approvals.createApproval(a.phone,proposal());
   assert.equal((await approvals.consumeApproval(a.phone,old.code)).ok,false);
   await db.query('UPDATE approvals SET expires_at=NOW()-INTERVAL \'1 second\' WHERE action_id=$1',[latest.actionId]);
   assert.equal((await approvals.consumeApproval(a.phone,latest.code)).reason,'EXPIRED');
   assert.equal(writes,0);
  });
  await t.test('approved mutation executes once, forced PAUSED, with ownership verification',async()=>{
   process.env.READ_ONLY='false';process.env.META_WRITES_ENABLED='true';
   const issue=await approvals.createApproval(a.phone,proposal());
   const consumed=await approvals.consumeApproval(a.phone,issue.code);assert.equal(consumed.ok,true);
   await meta.context.run(String(a.id),async()=>{
    const result=await executor.executeApprovedAction(a.phone,consumed.approval.actionPlan);
    assert.equal(result.ok,true,JSON.stringify(result));
    assert.equal((await executor.executeApprovedAction(a.phone,consumed.approval.actionPlan)).ok,false);
   });
   assert.equal(writes,1);
   assert.equal((await approvals.consumeApproval(a.phone,issue.code)).ok,false);
   assert.equal((await db.query('SELECT status FROM meta_execution_attempts WHERE action_id=$1',[issue.actionId])).rows[0].status,'VERIFIED');
  });
  await t.test('uncertain Meta writes go to manual review and are never replayed',async()=>{
   const issue=await approvals.createApproval(a.phone,proposal());
   const consumed=await approvals.consumeApproval(a.phone,issue.code);failWrite=true;
   await meta.context.run(String(a.id),async()=>{
    assert.equal((await executor.executeApprovedAction(a.phone,consumed.approval.actionPlan)).reason,'MANUAL_REVIEW');
    assert.equal((await executor.executeApprovedAction(a.phone,consumed.approval.actionPlan)).ok,false);
   });
   failWrite=false;assert.equal(writes,2);
  });
  await t.test('direct writes and read-only approvals cannot reach Meta',async()=>{
   await assert.rejects(require('../metaWrite').createCampaign(proposal()),/APPROVED_ACTION_REQUIRED/);
   process.env.READ_ONLY='true';
   assert.equal((await executor.executeApprovedAction(a.phone,proposal())).reason,'READ_ONLY');
   assert.equal(writes,2);
  });
  await t.test('ad sets, creatives, ads, image uploads and approved changes use tenant-scoped verified endpoints',async()=>{
   const c=await clientStore.getOrCreateClient('972500000003');
   await db.query('INSERT INTO meta_connections(client_id,meta_user_id,token_ciphertext,app_id,expires_at) VALUES($1,$2,$3,\'123\',NOW()+INTERVAL \'1 hour\')',[c.id,'10'+c.id,meta.encrypt('token-'+c.id,c.id)]);
   await db.query('UPDATE clients SET meta_ad_account_id=$2 WHERE id=$1',[c.id,'act_11']);
   const beforeGet=axios.get,beforePost=axios.post;
   const objects=new Map([['123',{id:'123',account_id:'11',name:'Existing',objective:'OUTCOME_TRAFFIC'}],['222',{id:'222',account_id:'11'}],['333',{id:'333',account_id:'11'}]]);
   const mediaId=await require('../mediaStore').saveMedia(c.id,{mediaId:'wa-image',type:'image',mimeType:'image/png',caption:'Image'});
   let sent=0;
   axios.post=async(url,body,options)=>{
    sent++;assert.match(options.headers.Authorization,/^Bearer token-/);
    const fields=Object.fromEntries(body.entries());
    assert.equal(fields.access_token,undefined);
    if(url.endsWith('/adimages')) return {data:{images:{test:{hash:'imagehash'}}}};
    const id=url.endsWith('/123')?'123':String(800+sent);
    objects.set(id,{...objects.get(id),...fields,id,account_id:'11',creative:fields.creative?{id:JSON.parse(fields.creative).creative_id}:undefined});
    if(['adsets','ads'].some(edge=>url.endsWith('/'+edge))) assert.equal(fields.status,'PAUSED');
    return {data:{id}};
   };
   axios.get=async(url,options)=>{
    if(url.includes('lookaside.fbsbx.com')) return {data:Buffer.from('image')};
    if(url.endsWith('/wa-image')) return {data:{mime_type:'image/png',url:'https://lookaside.fbsbx.com/image'}};
    if(url.endsWith('/me/accounts')) return {data:{data:[{id:'12'}]}};
    if(url.endsWith('/act_11/adimages')) return {data:{data:[{hash:'imagehash'}]}};
    const id=url.split('/').at(-1);if(objects.has(id)) return {data:objects.get(id)};
    return beforeGet(url,options);
   };
   process.env.READ_ONLY='false';process.env.META_WRITES_ENABLED='true';process.env.WHATSAPP_ACCESS_TOKEN='test-only';
   try {
    const plans=[
     ['UPLOAD_IMAGE',{mediaId}],
     ['CREATE_ADSET',{name:'Set',campaignId:'123',dailyBudget:20,dailyBudgetMinor:1,currency:'USD',targeting:{geo_locations:{countries:['IL']},age_min:18},billingEvent:'IMPRESSIONS',optimizationGoal:'LINK_CLICKS',startTime:'2026-11-01T10:00:00Z'}],
     ['CREATE_CREATIVE',{name:'Creative',pageId:'12',link:'https://example.com',message:'Body',headline:'Headline',imageHash:'imagehash'}],
     ['CREATE_AD',{name:'Ad',adsetId:'222',creativeId:'333'}],
     ['CHANGE_BUDGET',{dailyBudget:25}],['PAUSE_CAMPAIGN',{}],['RESUME_CAMPAIGN',{}],['EDIT_CAMPAIGN',{name:'Updated'}]
    ];
    for(const [intent,parameters] of plans) {
     const target={accountId:'act_11',...(['CHANGE_BUDGET','PAUSE_CAMPAIGN','RESUME_CAMPAIGN','EDIT_CAMPAIGN'].includes(intent)?{campaignId:'123'}:{})};
     const issue=await approvals.createApproval(c.phone,createActionPlan({intent,target,parameters}));
     if(intent==='CREATE_ADSET') {assert.equal(issue.actionPlan.parameters.currency,'ILS');assert.equal(issue.actionPlan.parameters.dailyBudgetMinor,2000);}
     const consumed=await approvals.consumeApproval(c.phone,issue.code);assert.equal(consumed.ok,true,intent);
     const result=await meta.context.run(String(c.id),()=>executor.executeApprovedAction(c.phone,consumed.approval.actionPlan));
     assert.equal(result.ok,true,intent+': '+JSON.stringify(result));
    }
    assert.equal(sent,plans.length);
   } finally {axios.get=beforeGet;axios.post=beforePost;process.env.READ_ONLY='true';}
  });
  await t.test('full campaign creation remains PAUSED until a second bundle-specific activation approval',async()=>{
   const c=await clientStore.getOrCreateClient('972500000004');
   await db.query('INSERT INTO meta_connections(client_id,meta_user_id,token_ciphertext,app_id,expires_at) VALUES($1,$2,$3,\'123\',NOW()+INTERVAL \'1 hour\')',[c.id,'10'+c.id,meta.encrypt('token-'+c.id,c.id)]);
   await db.query('UPDATE clients SET meta_ad_account_id=$2 WHERE id=$1',[c.id,'act_11']);
   const beforeGet=axios.get,beforePost=axios.post;
   const objects=new Map();let sequence=1000,activations=0;
   axios.post=async(url,body)=>{
    const fields=Object.fromEntries(body.entries());
    const existing=url.split('/').at(-1);
    if(objects.has(existing)) {objects.set(existing,{...objects.get(existing),...fields});if(fields.status==='ACTIVE') activations++;return {data:{id:existing}};}
    const id=String(++sequence);
    objects.set(id,{...fields,id,account_id:'11',creative:fields.creative?{id:JSON.parse(fields.creative).creative_id}:undefined});
    if(fields.status) assert.equal(fields.status,'PAUSED');
    return {data:{id}};
   };
   axios.get=async(url,options)=>{
    if(url.endsWith('/me/accounts')) return {data:{data:[{id:'12'}]}};
    const id=url.split('/').at(-1);if(objects.has(id)) return {data:objects.get(id)};
    return beforeGet(url,options);
   };
   process.env.READ_ONLY='false';process.env.META_WRITES_ENABLED='true';
   try {
    const parameters={name:'Complete campaign',objective:'OUTCOME_TRAFFIC',dailyBudget:100,pageId:'12',link:'https://example.com',message:'Body',headline:'Headline',imageHash:'verified-existing-image',adSets:[{name:'Audience',dailyBudget:100,targeting:{geo_locations:{countries:['IL']},age_min:18},billingEvent:'IMPRESSIONS',optimizationGoal:'LINK_CLICKS',startTime:'2026-11-01T10:00:00Z'}]};
    const issued=await approvals.createApproval(c.phone,createActionPlan({intent:'CREATE_BUNDLE',target:{accountId:'act_11'},parameters}));
    const consumed=await approvals.consumeApproval(c.phone,issued.code);
    const created=await meta.context.run(String(c.id),()=>executor.executeApprovedAction(c.phone,consumed.approval.actionPlan));
    assert.equal(created.ok,true,JSON.stringify(created));assert.equal(activations,0);
    const ids=created.writeResult.objects;
    assert.equal(ids.adsetIds.length,1);assert.equal(ids.adIds.length,1);
    const activation=createActionPlan({intent:'ACTIVATE_BUNDLE',target:{accountId:'act_11',campaignId:ids.campaignId},parameters:{adsetIds:ids.adsetIds,adIds:ids.adIds}});
    assert.equal((await meta.context.run(String(c.id),()=>executor.executeApprovedAction(c.phone,activation))).ok,false);assert.equal(activations,0);
    const second=await approvals.createApproval(c.phone,activation);
    const accepted=await approvals.consumeApproval(c.phone,second.code);
    assert.notEqual(second.actionId,issued.actionId);
    const active=await meta.context.run(String(c.id),()=>executor.executeApprovedAction(c.phone,accepted.approval.actionPlan));
    assert.equal(active.ok,true,JSON.stringify(active));assert.equal(activations,3);
    for(const id of [ids.campaignId,...ids.adsetIds,...ids.adIds]) assert.equal(objects.get(id).status,'ACTIVE');
   } finally {axios.get=beforeGet;axios.post=beforePost;process.env.READ_ONLY='true';}
  });
  await t.test('WhatsApp dedupe, 24-hour window, opted-in templates and ordered receipts',async()=>{
   const wa=require('../whatsappDelivery');
   const enqueue=(id,text)=>meta.context.run(String(a.id),()=>wa.messageContext.run({eventId:id,sequence:0},()=>wa.enqueue(a.phone,wa.textPayload(text))));
   await wa.recordInbound({from:a.phone,timestamp:String(Math.floor(Date.now()/1000))});
   await enqueue('in-1','reply');await enqueue('in-1','reply');
   assert.equal((await db.query('SELECT * FROM whatsapp_outbox')).rows.length,1);
   let sends=0;process.env.WHATSAPP_SEND_ENABLED='false';
   assert.equal((await wa.runOne({transport:async()=>{sends++;}})).status,'DISABLED');
   process.env.WHATSAPP_SEND_ENABLED='true';
   assert.equal((await wa.runOne({transport:async()=>{sends++;return {messages:[{id:'wamid.mock.1'}]};}})).status,'SENT');
   assert.equal(sends,1);
   const receipt=status=>({entry:[{changes:[{value:{statuses:[{id:'wamid.mock.1',timestamp:'1720000000',status}]}}]}]});
   await wa.ingestReceipts(receipt('read'));await wa.ingestReceipts(receipt('sent'));await wa.ingestReceipts(receipt('read'));
   assert.equal((await db.query('SELECT status FROM whatsapp_outbox')).rows[0].status,'READ');
   assert.equal((await db.query('SELECT * FROM whatsapp_receipts')).rows.length,2);
   await db.query("UPDATE whatsapp_contacts SET last_inbound_at=NOW()-INTERVAL '25 hours' WHERE phone=$1",[a.phone]);
   await enqueue('in-2','expired');
   assert.equal((await wa.runOne({transport:async()=>{sends++;}})).status,'BLOCKED');assert.equal(sends,1);
   await enqueue('in-3','uncertain');
   await db.query('UPDATE whatsapp_contacts SET last_inbound_at=NOW() WHERE phone=$1',[a.phone]);
   assert.equal((await wa.runOne({transport:async()=>{sends++;throw Error('network timeout');}})).status,'UNKNOWN');
   assert.equal((await wa.runOne({transport:async()=>{sends++;}})).status,'IDLE');assert.equal(sends,2);
   process.env.WHATSAPP_APPROVED_TEMPLATES='welcome';
   await meta.context.run(String(a.id),()=>wa.messageContext.run({eventId:'in-4',sequence:0},()=>wa.enqueueTemplate(a.phone,'welcome','he')));
   assert.equal((await wa.runOne({transport:async()=>{sends++;}})).status,'BLOCKED');
  });
  await t.test('shared rate limiting and key rotation work across requests',async()=>{
   const {take}=require('../rateLimit');
   assert.equal(await take('example',1),true);assert.equal(await take('example',1),false);
   const previous=process.env.META_TOKEN_ENCRYPTION_KEY;
   process.env.META_TOKEN_KEY_ID='rotated';process.env.META_TOKEN_ENCRYPTION_KEY=crypto.randomBytes(32).toString('base64');process.env.META_TOKEN_PREVIOUS_KEYS=JSON.stringify({primary:previous});
   assert.equal((await meta.credentials(a.id)).token,'token-'+a.id);
   await meta.rotateStoredKeys();
   process.env.META_TOKEN_PREVIOUS_KEYS='{}';
   assert.equal((await meta.credentials(a.id)).token,'token-'+a.id);
  });
  await t.test('HTTP endpoints enforce signatures, OAuth origin and secure cookies without live calls',async()=>{
   const app=require('../index');
   const server=await new Promise(resolve=>{const started=app.listen(0,'127.0.0.1',()=>resolve(started));});
   const base='http://127.0.0.1:'+server.address().port;
   try {
    const invalid=await fetch(base+'/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(invalid.status,401);
    const token=(await meta.createInvite(b.id)).split('#')[1];
    const wrong=await fetch(base+'/auth/meta/start',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://attacker.example'},body:JSON.stringify({invite:token})});
    assert.equal(wrong.status,400);
    const correct=await fetch(base+'/auth/meta/start',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://campaign.example'},body:JSON.stringify({invite:token})});
    assert.equal(correct.status,200);
    const cookie=correct.headers.get('set-cookie');
    assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Lax/);
    assert.equal((await correct.json()).url.startsWith('https://www.facebook.com/'),true);
    assert.equal((await fetch(base+'/privacy')).status,503);
    assert.equal((await fetch(base+'/health')).status,200);
    process.env.READ_ONLY='invalid';assert.equal((await fetch(base+'/health')).status,503);process.env.READ_ONLY='true';
   } finally {await new Promise(resolve=>server.close(resolve));}
  });
  await t.test('deletion scrubs queued events, removes outbound/receipts, and prevents resurrection',async()=>{
   await db.query('INSERT INTO whatsapp_inbound_events(event_id,payload) VALUES($1,$2::jsonb)',['old-event',JSON.stringify({message:{from:a.phone,text:{body:'private'}}})]);
   await db.transaction(tx=>require('../metaDeletion').deleteClient(a.id,tx));
   const scrubbed=(await db.query("SELECT payload,status FROM whatsapp_inbound_events WHERE event_id='old-event'")).rows[0];
   assert.deepEqual(scrubbed.payload,{});assert.equal(scrubbed.status,'MANUAL_REVIEW');
   assert.equal((await db.query('SELECT id FROM whatsapp_outbox WHERE client_id=$1',[a.id])).rows.length,0);
   assert.equal((await db.query('SELECT id FROM clients WHERE id=$1',[b.id])).rows.length,1);
   await assert.rejects(clientStore.getOrCreateClient(a.phone),/CLIENT_DELETED/);
  });
 } finally {axios.get=originalGet;axios.post=originalPost;await harness.close();for(const key of Object.keys(process.env)) if(!(key in env)) delete process.env[key];Object.assign(process.env,env);}
});
