'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {openDatabase}=require('./helpers/database');
test('customer portal HTTP boundary enforces authentication, CSRF and tenant isolation across signup and leads',async()=>{
 const h=await openDatabase(),env={...process.env};Object.assign(process.env,{APP_PUBLIC_URL:'https://campaign.example',BUSINESS_LINK_ONBOARDING_ENABLED:'true'});
 const app=require('../index');const server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.once('error',reject);});
 const root='http://127.0.0.1:'+server.address().port;const call=(path,body,cookie='',csrf='',method=body?'POST':'GET')=>fetch(root+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{Origin:'https://campaign.example','Content-Type':'application/json','X-CSRF-Token':csrf}:{})},body:body?JSON.stringify(body):undefined});
 try{
  const client=await require('../clientStore').getOrCreateClient('972501004111'),other=await require('../clientStore').getOrCreateClient('972501004222'),portal=require('../portalStore');
  const publicPage=await call('/app');assert.equal(publicPage.status,200);assert.match(publicPage.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal((await call('/app/api/dashboard')).status,401);
  const token=(await portal.createTicket(client.id)).split('#login=')[1];const login=await call('/app/api/login',{token});assert.equal(login.status,200);
  const cookies=login.headers.getSetCookie();assert.ok(cookies[0].includes('HttpOnly'));assert.ok(cookies[0].includes('Secure'));assert.ok(cookies[0].includes('SameSite=Strict'));
  const cookie=cookies.map(s=>s.split(';')[0]).join('; '),csrf=cookies.find(s=>s.startsWith('cb_csrf=')).split(';')[0].split('=')[1];
  const before=await call('/app/api/dashboard',null,cookie);assert.equal(before.status,200);assert.equal((await before.json()).account,null);
  assert.equal((await call('/app/api/register',{name:'דנה',acceptPrivacy:true},cookie,'wrong')).status,403);
  const signup=await call('/app/api/register',{name:'דנה',acceptPrivacy:true,clientId:other.id},cookie,csrf);assert.equal(signup.status,200);
  assert.equal((await h.db.query('SELECT client_id FROM customer_accounts WHERE client_id=$1',[other.id])).rows.length,0);
  assert.equal((await call('/app/api/leads',{name:'לקוח',phone:'0501234567',clientId:other.id},cookie,csrf)).status,200);
  assert.equal((await require('../crmService').list(other.id)).length,0);assert.equal((await require('../crmService').list(client.id)).length,1);
  // Two independently authenticated businesses: neither can list or mutate the other's lead.
  const otherToken=(await portal.createTicket(other.id)).split('#login=')[1];
  const otherLogin=await call('/app/api/login',{token:otherToken});assert.equal(otherLogin.status,200);
  const otherCookies=otherLogin.headers.getSetCookie();
  const otherCookie=otherCookies.map(s=>s.split(';')[0]).join('; ');
  const otherCsrf=otherCookies.find(s=>s.startsWith('cb_csrf=')).split(';')[0].split('=')[1];
  assert.equal((await call('/app/api/register',{name:'עסק ב',acceptPrivacy:true},otherCookie,otherCsrf)).status,200);
  assert.equal((await call('/app/api/leads',{name:'פניית עסק ב',phone:'0509876543'},otherCookie,otherCsrf)).status,200);
  const aLeads=(await(await call('/app/api/leads',null,cookie)).json()).leads;
  const bLeads=(await(await call('/app/api/leads',null,otherCookie)).json()).leads;
  assert.equal(aLeads.length,1);assert.equal(bLeads.length,1);
  assert.notEqual(aLeads[0].id,bLeads[0].id);
  assert.equal(aLeads[0].client_id,client.id);assert.equal(bLeads[0].client_id,other.id);
  const crossUpdate=await call('/app/api/leads/'+bLeads[0].id,{status:'WON',version:bLeads[0].version},cookie,csrf,'PATCH');
  assert.notEqual(crossUpdate.status,200);
  assert.equal((await require('../crmService').list(other.id))[0].status,bLeads[0].status);
  // Tenant B's workspace records must not be exposed to tenant A's session.
  const requestId=require('node:crypto').randomUUID();
  assert.equal((await call('/app/api/workspace/tasks',{payload:{title:'משימה סודית של עסק ב'},requestId},otherCookie,otherCsrf)).status,200);
  const aTasks=await(await call('/app/api/workspace/tasks',null,cookie)).json();
  const bTasks=await(await call('/app/api/workspace/tasks',null,otherCookie)).json();
  assert.equal(aTasks.items.length,0);
  assert.equal(bTasks.items.length,1);
  const crossTask=await call('/app/api/workspace/tasks/'+bTasks.items[0].id,{payload:{title:'גניבת משימה'},version:bTasks.items[0].version,requestId:require('node:crypto').randomUUID()},cookie,csrf,'PATCH');
  assert.notEqual(crossTask.status,200);
  assert.equal((await(await call('/app/api/workspace/tasks',null,otherCookie)).json()).items[0].payload.title,'משימה סודית של עסק ב');
  // The portal agent's conversation history is also scoped to its authenticated session.
  const bHistory=await(await call('/app/api/agent',null,otherCookie)).json();
  const aHistory=await(await call('/app/api/agent',null,cookie)).json();
  assert.deepEqual(aHistory.messages,[]);assert.deepEqual(bHistory.messages,[]);
  await require('../marketingStore').update(other.id,null,p=>{p.portalChat={messages:[{role:'user',content:'שלום עסק ב',screen:'campaign',at:new Date().toISOString()}],requests:[]};return {handled:false,changed:true};});
  const bHistoryAfter=await(await call('/app/api/agent',null,otherCookie)).json();
  const aHistoryAfter=await(await call('/app/api/agent',null,cookie)).json();
  assert.ok(bHistoryAfter.messages.some(m=>m.content==='שלום עסק ב'));
  assert.ok(!aHistoryAfter.messages.some(m=>m.content==='שלום עסק ב'));
  const d=await(await call('/app/api/dashboard',null,cookie)).json();assert.equal(d.subscription.checkoutAvailable,false);assert.equal(d.crm.counts.NEW,1);
  assert.equal((await call('/app/api/logout',{},cookie,csrf)).status,200);assert.equal((await call('/app/api/dashboard',null,cookie)).status,401);
 }finally{await new Promise(resolve=>server.close(resolve));await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
