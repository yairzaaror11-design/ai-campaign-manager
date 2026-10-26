'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {openDatabase}=require('./helpers/database');
const fixture=`<!doctype html><html><head><title>תכשיטי דנה</title><meta name="description" content="צמידים מאבני חן בעיצוב אישי"><meta name="theme-color" content="#246b57"><meta name="og:image" content="/bracelet.jpg"><meta name="viewport" content="width=device-width"><script type="application/ld+json">{"@type":"Store","name":"תכשיטי דנה","description":"צמידים מאבני חן","address":{"addressLocality":"נתניה"},"logo":"/logo.png"}</script></head><body><h1>צמידים בעבודת יד</h1><a href="tel:0550000000">דברו איתנו</a><form></form></body></html>`;
test('public website import blocks private networks and extracts only reviewable candidates',async()=>{
 const website=require('../publicWebsite');
 for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','::1','fc00::1','::ffff:127.0.0.1','224.0.0.1'])assert.equal(website.publicAddress(address),false,address);
 assert.equal(website.publicAddress('8.8.8.8'),true);
 for(const address of ['http://example.com','https://127.0.0.1','https://example.com:444','https://user:password@example.com'])assert.throws(()=>website.url(address));
 let calls=0;
 await assert.rejects(website.fetchPublic('https://example.com',{resolve:async()=>[{address:'127.0.0.1',family:4}],request:async()=>{calls++;}}),/PRIVATE/);assert.equal(calls,0);
 await assert.rejects(website.fetchPublic('https://example.com',{resolve:async(host)=>[{address:host==='private.example'?'10.0.0.1':'8.8.8.8',family:4}],request:async()=>({status:302,headers:{location:'https://private.example'}})}),/PRIVATE/);
 const p=website.extract(Buffer.from(fixture),'https://example.com/');assert.equal(p.facts.businessName,'תכשיטי דנה');assert.equal(p.status,'PENDING_CONFIRMATION');assert.deepEqual(p.brand.colors,['#246b57']);assert.equal(p.brand.images[0],'https://example.com/bracelet.jpg');assert.equal(p.checks.verifiedConversions,false);
});
test('WhatsApp → confirmed business → preview → registration → CRM retains one tenant and blocks replay',async t=>{
 const h=await openDatabase(),env={...process.env};
 Object.assign(process.env,{APP_PUBLIC_URL:'https://campaign.example',BUSINESS_LINK_ONBOARDING_ENABLED:'true'});
 const entry=require('../businessEntry'),store=require('../marketingStore'),facts=require('../conversationFacts'),portal=require('../portalStore'),crm=require('../crmService');
 let a,b,link,candidate,session,lead;
 try{
  a=await require('../clientStore').getOrCreateClient('972501007111');b=await require('../clientStore').getOrCreateClient('972501007222');
  await t.test('new user is invited to send a business link or describe the business',async()=>{
   const r=await entry.handle(a.id,'היי','intro');assert.equal(r.decisionKey,'business_entry');assert.match(r.reply,/קישור לאתר/);assert.equal(Object.keys((await store.load(a.id)).answers).length,0);
  });
  await t.test('facts and brand are proposals until the customer confirms',async()=>{
   const r=await entry.handle(a.id,'https://example.com','site',{inspect:async()=>require('../publicWebsite').extract(Buffer.from(fixture),'https://example.com/')});assert.equal(r.decisionKey,'business_import');
   assert.equal(facts.value(await store.load(a.id),'businessName'),null);
   await entry.handle(a.id,'הפרטים נכונים','confirm');const p=await store.load(a.id);assert.equal(facts.value(p,'businessName'),'תכשיטי דנה');assert.equal(p.brand.status,'USER_CONFIRMED');candidate=p;
   assert.equal(facts.value((await store.load(b.id))||store.emptyProfile(),'businessName'),null);
  });
  await t.test('a local plan is prepared before registration or Meta connection',async()=>{
   await store.update(a.id,null,p=>{for(const [f,v]of Object.entries({businessGoal:'מכירות',product:'צמידים',audience:'מחפשי מתנות',geography:'כל הארץ',advantage:'התאמה אישית',dailyBudget:{amount:100,currency:'ILS',period:'day'},leadDestination:'אתר העסק'}))facts.write(p,f,v);const r=require('../campaignJourney').transition(p,'תכין תוכנית קמפיין');assert.equal(r.decisionKey,'plan_review');return r;});
   assert.equal((await store.load(a.id)).journey.draft.status,'LOCAL_DRAFT');
  });
  await t.test('WhatsApp login link is single-use and never accepts an arbitrary client ID',async()=>{
   link=await portal.createTicket(a.id);const token=link.split('#login=')[1];session=await portal.redeem(token);assert.equal(String(session.clientId),String(a.id));
   await assert.rejects(portal.redeem(token),/INVALID/);await assert.rejects(portal.redeem(String(b.id)),/INVALID/);
   const request={headers:{cookie:'cb_session='+session.session,origin:'https://campaign.example','content-type':'application/json','x-csrf-token':session.csrf}};
   assert.equal(String((await portal.authenticate(request,{write:true})).clientId),String(a.id));
   await assert.rejects(portal.authenticate({headers:{...request.headers,origin:'https://attacker.example'}},{write:true}),/CSRF/);
   await assert.rejects(portal.authenticate({headers:{...request.headers,'x-csrf-token':'wrong'}},{write:true}),/CSRF/);
  });
  await t.test('registration preserves the entire conversation profile instead of copying into a new tenant',async()=>{
   const before=await store.load(a.id);await portal.register(a.id,{name:'דנה',email:'dana@example.com',acceptPrivacy:true});const after=await store.load(a.id);assert.deepEqual(after,before);
   assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM clients')).rows[0].n,2);
   await assert.rejects(portal.register(b.id,{name:'אחר',acceptPrivacy:false}),/INVALID/);
  });
  await t.test('manual lead state and revenue are isolated and use optimistic revisions',async()=>{
   lead=await crm.create(a.id,{name:'לקוח א',phone:'0501234567',source:'manual'});assert.equal((await crm.list(b.id)).length,0);
   await assert.rejects(crm.update(b.id,lead.id,{status:'WON',version:1}),/NOT_FOUND/);
   const won=await crm.update(a.id,lead.id,{status:'WON',version:1,revenueMinor:25000,currency:'ILS'});assert.equal(won.version,2);
   await assert.rejects(crm.update(a.id,lead.id,{status:'LOST',version:1}),/STALE/);
   const s=await crm.summary(a.id);assert.equal(s.counts.WON,1);assert.equal(s.revenue[0].amount,'25000');
  });
  await t.test('a published landing page requires explicit intent and sends deduplicated leads to the same CRM',async()=>{
   const landing=require('../landingService');await assert.rejects(landing.create(a.id,{}),/CONFIRMATION/);
   const published=await landing.create(a.id,{confirmPublish:true}),slug=published.url.split('/').at(-1);
   const input={name:'לקוח מהאתר',phone:'0507654321',consent:true,eventId:'abcdef00-1234-4567-8901-abcdef123456'};
   await landing.submit(slug,input);assert.equal((await landing.submit(slug,input)).duplicate,true);
   assert.equal((await crm.list(a.id)).length,2);assert.equal((await crm.list(b.id)).length,0);
   assert.equal(landing.html({payload:{businessName:'<script>alert(1)</script>',title:'x',body:'y'}}).includes('<script>alert(1)</script>'),false);
  });
  await t.test('lead follow-up works through contextual WhatsApp choices without accepting another tenant',async()=>{
   const chat=require('../crmConversation'),ui=require('../conversationUi');
   const menu=await chat.handle(a.id,'הפניות שלי');assert.equal(menu.decisionKey,'crm_leads');
   const prepared=await ui.prepare(a.id,menu.reply,menu.decisionKey);
   const id=prepared.interactivePayload.interactive.action.buttons[0].reply.id;
   assert.equal(await ui.consume(b.id,{interactive:{type:'button_reply',button_reply:{id}}}),null);
   const selected=await ui.consume(a.id,{interactive:{type:'button_reply',button_reply:{id}}});
   const focused=await chat.handle(a.id,selected);assert.equal(focused.decisionKey,'crm_status');
   const result=await chat.handle(a.id,'סמן פנייה בטיפול');assert.match(result.reply,/עודכן/);
  });
  await t.test('expired and superseded links fail and account deletion revokes sessions by FK',async()=>{
   const old=(await portal.createTicket(a.id)).split('#login=')[1];await portal.createTicket(a.id);await assert.rejects(portal.redeem(old),/INVALID/);
   const current=(await portal.createTicket(b.id)).split('#login=')[1];await h.db.query("UPDATE portal_login_tickets SET expires_at=NOW()-INTERVAL '1 minute' WHERE client_id=$1",[b.id]);await assert.rejects(portal.redeem(current),/INVALID/);
   await require('./../metaDeletion').deleteClient(a.id,h.db.query);await assert.rejects(portal.authenticate({headers:{cookie:'cb_session='+session.session}}),/AUTH_REQUIRED/);
  });
 }finally{for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);await h.close();}
});
test('a legacy manual brief cannot consume business import and portal commands',()=>{
 const old=process.env.BUSINESS_LINK_ONBOARDING_ENABLED;process.env.BUSINESS_LINK_ONBOARDING_ENABLED='true';
 try{const owner=require('../conversationOwner').owner;
  assert.equal(owner({text:'https://example.com',hasOpenBrief:true,profile:null}),'marketing');
  assert.equal(owner({text:'תצוגה מקדימה',hasOpenBrief:true,profile:null}),'marketing');
  assert.equal(owner({text:'כן',hasOpenBrief:true,profile:{businessEntry:{awaitingConfirmation:true}}}),'marketing');
  assert.equal(owner({text:'/brief TRAFFIC',hasOpenBrief:true,profile:null}),'brief');
 }finally{if(old===undefined)delete process.env.BUSINESS_LINK_ONBOARDING_ENABLED;else process.env.BUSINESS_LINK_ONBOARDING_ENABLED=old;}
});
