'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {openDatabase}=require('./helpers/database');
const workspace=require('../workspaceService');
const requestId=()=>crypto.randomUUID();
test('workspace validates exact money, dates, finite enums and bounded fields',()=>{
 assert.equal(workspace.validate('products',{name:'מוצר',priceMinor:0,costMinor:0}).priceMinor,0);
 for(const value of [-1,1.1,NaN,Infinity,'500',100000000001])assert.throws(()=>workspace.validate('expenses',{title:'הוצאה',amountMinor:value}));
 for(const date of ['2026-02-30','2026-13-01','10/26/2026',true])assert.throws(()=>workspace.validate('tasks',{title:'משימה',date}));
 assert.throws(()=>workspace.validate('content',{title:'פוסט',body:'x',channel:'TikTok'}));
 assert.throws(()=>workspace.validate('products',{name:'x'.repeat(121)}));
 assert.equal(workspace.validate('content',{title:'פוסט',body:'תוכן',status:'PUBLISHED'}).status,'DRAFT');
 assert.throws(()=>workspace.validate('unknown',{}));
});
test('workspace persists tenant-owned records, rejects stale and foreign edits, deduplicates retries and cascades deletion',async t=>{
 const h=await openDatabase(),a=await require('../clientStore').getOrCreateClient('972509001111'),b=await require('../clientStore').getOrCreateClient('972509002222');
 try{
  await t.test('all record kinds persist after reads without trusting supplied tenant IDs',async()=>{
   for(const [kind,payload]of Object.entries({products:{name:'מוצר',audience:'עסקים',priceMinor:25000,costMinor:10000},content:{title:'פוסט',body:'טיוטה בלבד',date:'2026-10-26',status:'PUBLISHED'},tasks:{title:'שיחת המשך',date:'2026-10-27'},expenses:{title:'חומרי גלם',amountMinor:12345,currency:'ILS',date:'2026-10-26'}})){
    const r=await workspace.save(a.id,kind,{...payload,clientId:b.id},{requestId:requestId()});assert.equal(r.version,1);assert.equal((await workspace.list(a.id,kind)).items[0].id,r.id);assert.equal((await workspace.list(b.id,kind)).items.length,0);
   }
   assert.equal((await workspace.list(a.id,'content')).items[0].payload.status,'DRAFT');
  });
  await t.test('replayed create is identical and changed body conflicts',async()=>{
   const id=requestId(),body={name:'מוצר חוזר'};const [x,y]=await Promise.all([workspace.save(a.id,'products',body,{requestId:id}),workspace.save(a.id,'products',body,{requestId:id})]);assert.equal(x.id,y.id);
   await assert.rejects(workspace.save(a.id,'products',{name:'שינוי'},{requestId:id}),/WORKSPACE_REQUEST_CONFLICT/);
  });
  await t.test('updates bind kind, tenant and version and do not repeat on retry',async()=>{
   const x=(await workspace.list(a.id,'tasks')).items[0],id=requestId(),opts={id:x.id,version:1,requestId:id},payload={...x.payload,status:'DONE'};
   await assert.rejects(workspace.save(b.id,'tasks',payload,opts),/WORKSPACE_STALE/);
   await assert.rejects(workspace.save(a.id,'products',{name:'שגיאה'},opts),/WORKSPACE_STALE/);
   const updated=await workspace.save(a.id,'tasks',payload,opts);assert.equal(updated.version,2);
   assert.equal((await workspace.save(a.id,'tasks',payload,opts)).version,2);
   await assert.rejects(workspace.save(a.id,'tasks',payload,{...opts,requestId:requestId()}),/WORKSPACE_STALE/);
  });
  await t.test('brand shares facts with the journey, preserves connection and invalidates draft approvals',async()=>{
   const store=require('../marketingStore');await store.update(a.id,null,p=>{p.connection={status:'CONNECTED',account:{id:'act_11'}};p.journey={revision:1,draft:{stale:false},strategyApproved:true,creativeApproved:true,planApproved:true};return{handled:false,changed:true};});
   const p=await store.load(a.id),input={businessName:'העסק החדש',businessType:'שירותים',logo:'https://images.example.test/logo.png',colors:['#195B48','#FFFFFF','#587264','#F3F6F2','#173D36'],version:p.version};
   await workspace.saveBrand(a.id,input);const after=await store.load(a.id);assert.equal(require('../conversationFacts').value(after,'businessName'),'העסק החדש');assert.equal(after.connection.account.id,'act_11');assert.equal(after.journey.draft.stale,true);assert.equal(after.journey.planApproved,false);
   await assert.rejects(workspace.saveBrand(a.id,input),/WORKSPACE_STALE/);assert.equal(await store.load(b.id),null);
   for(const logo of ['javascript:alert(1)','http://example.test/logo.png','https://user:password@example.test/x'])await assert.rejects(workspace.saveBrand(a.id,{...input,logo,version:after.version}),/INVALID_BRAND_LOGO/);
   await assert.rejects(workspace.saveBrand(a.id,{...input,colors:['red'],version:after.version}),/INVALID_BRAND_COLORS/);
  });
  await t.test('planning agent reuses journey facts, validates screen, persists history and has no provider effects',async()=>{
   const agent=require('../portalAgent'),axios=require('axios'),get=axios.get,post=axios.post;let calls=0;axios.get=axios.post=async()=>{calls++;throw Error('UNEXPECTED_PROVIDER_CALL');};
   try{
    const id=requestId(),r=await agent.send(a.id,{message:'מה כבר ידוע',screen:'brand',requestId:id});assert.match(r.reply,/העסק החדש/);assert.equal(r.externalActionsExecuted,false);assert.ok(r.actions.every(a=>agent.SCREENS.includes(a.screen)));
    await agent.send(a.id,{message:'מה כבר ידוע',screen:'brand',requestId:id});assert.equal((await agent.history(a.id)).messages.length,2);
    await assert.rejects(agent.send(a.id,{message:'אחר',screen:'brand',requestId:id}),/WORKSPACE_REQUEST_CONFLICT/);
    assert.equal((await agent.history(b.id)).messages.length,0);
    const blocked=await agent.send(a.id,{message:'פרסם עכשיו ושלח הודעה',screen:'campaign',requestId:requestId()});assert.match(blocked.reply,/אישור/);assert.equal(calls,0);
    await assert.rejects(agent.send(a.id,{message:'שלום',screen:'http://evil.test',requestId:requestId()}),/INVALID_AGENT_MESSAGE/);
    const follow=await agent.send(b.id,{message:'נמשיך',screen:'home',requestId:requestId()});assert.ok(follow.reply);assert.ok((await require('../marketingStore').load(b.id)).journey);
   }finally{axios.get=get;axios.post=post;}
  });
  await t.test('deleting client cascades new workspace data and retry cache',async()=>{
   assert.ok((await h.db.query('SELECT id FROM workspace_items WHERE client_id=$1',[a.id])).rows.length);await h.db.query('DELETE FROM clients WHERE id=$1',[a.id]);assert.equal((await h.db.query('SELECT id FROM workspace_items WHERE client_id=$1',[a.id])).rows.length,0);assert.equal((await h.db.query('SELECT request_id FROM workspace_requests WHERE client_id=$1',[a.id])).rows.length,0);
  });
 }finally{await h.close();}
});
test('SCORPIO HTTP endpoints inherit authentication, CSRF and tenant identity',async()=>{
 const h=await openDatabase(),env={...process.env};delete require.cache[require.resolve('../clientStore')];process.env.APP_PUBLIC_URL='https://campaign.example';
 const app=require('../index'),server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.once('error',reject);}),root='http://127.0.0.1:'+server.address().port;
 const call=(path,body,cookie='',csrf='',method=body?'POST':'GET',origin='https://campaign.example')=>fetch(root+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf}:{})},body:body?JSON.stringify(body):undefined});
 try{
  for(const file of ['/app','/app/portal.js','/app/components.js','/app/dashboard.js','/app/portal.css'])assert.equal((await call(file)).status,200);
  assert.match(await(await call('/app')).text(),/SCORPIO AI/);
  assert.equal((await call('/app/api/integrations')).status,401);assert.equal((await call('/app/api/workspace/products')).status,401);assert.equal((await call('/app/api/agent')).status,401);
  const a=await require('../clientStore').getOrCreateClient('972509003333'),b=await require('../clientStore').getOrCreateClient('972509004444'),portal=require('../portalStore');
  const token=(await portal.createTicket(a.id)).split('#login=')[1],r=await call('/app/api/login',{token}),cookies=r.headers.getSetCookie(),cookie=cookies.map(x=>x.split(';')[0]).join('; '),csrf=cookies.find(x=>x.startsWith('cb_csrf=')).split(';')[0].split('=')[1];
  const connections=await call('/app/api/integrations',null,cookie);assert.equal(connections.status,200);assert.equal((await connections.json()).social.length,6);
  assert.equal((await call('/app/api/social/unknown/connect',{},cookie,csrf)).status,400);
  const body={payload:{name:'מוצר',clientId:b.id},requestId:requestId(),clientId:b.id};
  assert.equal((await call('/app/api/workspace/products',body,cookie,'bad')).status,403);
  assert.equal((await call('/app/api/workspace/products',body,cookie,csrf,'POST','https://evil.example')).status,403);
  const saved=await call('/app/api/workspace/products',body,cookie,csrf);assert.equal(saved.status,200);const item=await saved.json();assert.equal((await workspace.list(b.id,'products')).items.length,0);
  assert.equal((await call('/app/api/workspace/products/'+item.id,{payload:{name:'חדש'},version:999,requestId:requestId()},cookie,csrf,'PATCH')).status,409);
  assert.equal((await call('/app/api/workspace/content',{payload:{title:'x',body:'y',date:'2026-02-30'},requestId:requestId()},cookie,csrf)).status,400);
  assert.equal((await call('/app/api/agent',{message:'נמשיך',screen:'home',requestId:requestId(),clientId:b.id},cookie,csrf)).status,200);
  assert.equal((await require('../portalAgent').history(b.id)).messages.length,0);
  assert.equal((await call('/app/api/agent',{message:'x',screen:'../../other',requestId:requestId()},cookie,csrf)).status,400);
  assert.equal((await call('/app/api/dashboard',null,cookie)).status,200);
 }finally{await new Promise(resolve=>server.close(resolve));await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
