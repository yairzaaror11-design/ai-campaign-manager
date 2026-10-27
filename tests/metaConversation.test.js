'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),axios=require('axios');
const {openDatabase}=require('./helpers/database');
test('guided Meta connection states, verified permissions and tenant boundaries',async t=>{
 const previous={...process.env},h=await openDatabase(),get=axios.get,post=axios.post;
 Object.assign(process.env,{META_TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),META_APP_ID:'123',META_APP_SECRET:'test-secret',META_LOGIN_CONFIG_ID:'456',APP_PUBLIC_URL:'https://campaign.example',META_WRITES_ENABLED:'false',READ_ONLY:'true'});
 const meta=require('../metaConnection'),guided=require('../metaConversation'),store=require('../marketingStore');
 const a=await require('../clientStore').getOrCreateClient('972501009111'),b=await require('../clientStore').getOrCreateClient('972501009222');
 let permissions=['ads_read'],accounts=[{id:'act_11',name:'חשבון א',account_status:1,currency:'ILS'},{id:'act_12',name:'חשבון נוסף',account_status:1,currency:'ILS'}],failure=null;
 axios.get=async url=>{
  if(failure)throw failure;
  if(url.endsWith('/me/permissions'))return{data:{data:permissions.map(permission=>({permission,status:'granted'}))}};
  if(url.endsWith('/me/adaccounts'))return{data:{data:accounts}};
  return{data:{id:'person'}};
 };
 const connect=async()=>h.db.query("INSERT INTO meta_connections(client_id,meta_user_id,token_ciphertext,expires_at,app_id) VALUES($1,'person',$2,NOW()+INTERVAL '1 hour','123') ON CONFLICT(client_id) DO UPDATE SET expires_at=EXCLUDED.expires_at",[a.id,meta.encrypt('tenant-test-token',a.id)]);
 try{
  await t.test('user saying connected is not proof',async()=>{const r=await guided.handle(b.id,'התחברתי',{intent:'connection_status'});assert.match(r.reply,/אין כרגע/);assert.equal((await store.load(b.id)).connection.status,'NOT_CONNECTED');});
  await t.test('new advertiser is asked about an account before creating an invite',async()=>{
   const manager=require('../marketingConversation');
   let r=await manager.handleMarketingMessage(a.id,'אני רוצה להתחיל לפרסם בפייסבוק','meta-intro');assert.match(r.reply,/יש כבר חשבון/);
   r=await manager.handleMarketingMessage(a.id,'כן','has-account');assert.match(r.reply,/לשלוח קישור/);assert.equal((await store.load(a.id)).connection.status,'CONNECTION_OFFERED');
   r=await manager.handleMarketingMessage(a.id,'כן','invite-request');assert.match(r.reply,/https:\/\/campaign.example\/auth\/meta\/connect#/);
   assert.equal((await store.load(a.id)).connection.status,'AWAITING_OAUTH');
   const count=(await h.db.query('SELECT COUNT(*)::int AS n FROM meta_login_secrets WHERE client_id=$1',[a.id])).rows[0].n;
   await manager.handleMarketingMessage(a.id,'כן','invite-request');assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM meta_login_secrets WHERE client_id=$1',[a.id])).rows[0].n,count);
   assert.equal(JSON.stringify((await store.load(a.id)).events).includes('connect#'),false);
  });
  await t.test('multiple server-returned accounts require selection and an invalid ID is rejected',async()=>{
   await connect();const v=await guided.verify(a.id);assert.equal(v.status,'ACCOUNT_SELECTION_REQUIRED');assert.equal(v.accounts.length,2);assert.equal(v.canRead,false);
   const r=await guided.handle(a.id,'/meta-select act_999',{intent:'select_account'});assert.match(r.reply,/אינו ברשימת/);
   const selected=await guided.handle(a.id,'2',{intent:'other'});assert.match(selected.reply,/אומת וחובר/);assert.equal((await store.load(a.id)).connection.account.id,'act_12');
  });
  await t.test('a connected read-only account is reused without issuing another OAuth link',async()=>{
   const before=(await h.db.query('SELECT COUNT(*)::int AS n FROM meta_login_secrets')).rows[0].n;
   const r=await guided.handle(a.id,'/meta-connect',{intent:'connect'});assert.match(r.reply,/אומת וחובר/);assert.doesNotMatch(r.reply,/connect#/);
   assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM meta_login_secrets')).rows[0].n,before);
   const v=await guided.verify(a.id);assert.equal(v.canRead,true);assert.equal(v.canManage,false);assert.deepEqual(v.permissions,['ads_read']);
  });
  await t.test('missing ads_read is explicit and no false connected result is returned',async()=>{permissions=[];const v=await guided.verify(a.id);assert.equal(v.status,'MISSING_PERMISSIONS');assert.match(guided.statusReply(v),/ads_read/);assert.equal(v.canRead,false);permissions=['ads_read'];});
  await t.test('server-recorded expiration requires reconnection',async()=>{await h.db.query("UPDATE meta_connections SET expires_at=NOW()-INTERVAL '1 minute' WHERE client_id=$1",[a.id]);assert.equal((await guided.verify(a.id)).status,'TOKEN_EXPIRED');await connect();});
  await t.test('revoked token and temporary provider failures are sanitized',async()=>{
   failure={response:{data:{error:{code:190,message:'NEVER_EXPOSE_SECRET'}}}};assert.equal((await guided.verify(a.id)).status,'TOKEN_EXPIRED');
   failure=Error('secret-token-and-provider-body');const v=await guided.verify(a.id);assert.equal(v.status,'CONNECTION_FAILED');assert.equal(JSON.stringify(v).includes('secret-token'),false);failure=null;
  });
  await t.test('no active ad account is distinguished from a completed connection',async()=>{const before=accounts;accounts=[];const v=await guided.verify(a.id);assert.equal(v.status,'ACCOUNT_SELECTION_REQUIRED');assert.match(guided.statusReply(v),/לא נמצא/);accounts=before;});
  await t.test('knowledge is bounded, versioned, database-backed and has no token fields',async()=>{
   const topics=await require('../metaKnowledge').retrieve({query:'הרשאות',limit:2});assert.ok(topics.length&&topics.length<=2);assert.ok(topics.every(x=>x.source&&x.version===1));
   assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM meta_ads_knowledge')).rows[0].n,15);
   const payload=JSON.stringify(topics);assert.equal(payload.includes('tenant-test-token'),false);
   assert.throws(()=>require('../metaKnowledge').search({limit:100}),/INVALID/);
  });
  await t.test('tools use server-side tenant context and never accept a client override',async()=>{
   const v=await meta.context.run(String(b.id),()=>require('../gemini').runTool('get_meta_connection_status',{clientId:a.id}));assert.equal(v.status,'NOT_CONNECTED');assert.equal(v.accounts.length,0);
   await assert.rejects(require('../gemini').runTool('get_business_facts'),/TENANT_CONTEXT_REQUIRED/);
   const facts=await meta.context.run(String(b.id),()=>require('../gemini').runTool('get_business_facts',{fields:['dailyBudget']}));assert.equal(facts.dailyBudget,null);
  });
  await t.test('disconnect retains business data while removing tokens and pending approvals',async()=>{
   const r=await guided.handle(a.id,'נתק את חשבון מטא',{intent:'disconnect'});assert.match(r.reply,/נותק/);assert.equal((await store.load(a.id)).connection.status,'DISCONNECTED');
   await assert.rejects(meta.credentials(a.id),/META_CONNECTION_REQUIRED/);assert.equal((await guided.verify(a.id)).status,'DISCONNECTED');
   assert.ok((await h.db.query("SELECT id FROM tenant_audit WHERE client_id=$1 AND event='CONVERSATION_STATE'",[a.id])).rows.length>0);
  });
  await t.test('a user without an ad account can contextually accept local campaign preparation',async()=>{
   const manager=require('../marketingConversation');await manager.handleMarketingMessage(b.id,'אני רוצה להתחיל לפרסם בפייסבוק','new-advertiser');
   assert.match((await manager.handleMarketingMessage(b.id,'לא','no-account')).reply,/טיוטת קמפיין/);
   const r=await manager.handleMarketingMessage(b.id,'כן','prepare-local');assert.match(r.reply,/מה העסק עושה/);assert.equal((await store.load(b.id)).journey.stage,'DISCOVERY');
  });
  await t.test('failed OAuth persists a sanitized failure and a consumed callback cannot replay',async()=>{
   const c=await require('../clientStore').getOrCreateClient('972501009333');
   const login=await meta.begin((await meta.createInvite(c.id)).split('#')[1]);
   const state=new URL(login.url).searchParams.get('state');
   axios.post=async()=>{throw Error('provider-secret');};
   await assert.rejects(meta.callback(state,login.browser,'test-code'),/META_LOGIN_FAILED/);
   const p=await store.load(c.id);assert.equal(p.connection.status,'CONNECTION_FAILED');assert.equal(p.connection.lastError,'OAUTH_CALLBACK_FAILED');
   assert.equal(JSON.stringify(p).includes('provider-secret'),false);
   await assert.rejects(meta.callback(state,login.browser,'test-code'),/INVALID_LOGIN/);
  });
  await t.test('two parallel OAuth callbacks cannot overwrite the first committed connection',async()=>{
   const c=await require('../clientStore').getOrCreateClient('972501009444');
   const first=await meta.begin((await meta.createInvite(c.id)).split('#')[1]);
   const second=await meta.begin((await meta.createInvite(c.id)).split('#')[1]);
   let release,entered;const waiting=new Promise(r=>{entered=r;});let exchanges=0;
   axios.post=async()=>{exchanges++;if(exchanges===1){entered();await new Promise(r=>{release=r;});}return{data:{access_token:'tenant-test-token',expires_in:3600}};};
   const delayed=meta.callback(new URL(first.url).searchParams.get('state'),first.browser,'first');
   await waiting;await meta.callback(new URL(second.url).searchParams.get('state'),second.browser,'second');release();
   await assert.rejects(delayed,/CONNECTION_REVOKED/);assert.equal((await meta.credentials(c.id)).token,'tenant-test-token');
  });
 }finally{axios.get=get;axios.post=post;for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);await h.close();}
});
