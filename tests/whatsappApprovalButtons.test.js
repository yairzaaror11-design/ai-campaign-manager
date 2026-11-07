'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),axios=require('axios');
const {openDatabase}=require('./helpers/database');
test('WhatsApp approval buttons bind the exact tenant plan, require separate activation and resist forged text',async()=>{
 const env={...process.env},get=axios.get,post=axios.post,wa=require('../whatsapp'),send=wa.safeSend,outputs=[];
 const h=await openDatabase();
 Object.assign(process.env,{APP_PUBLIC_URL:'https://test.example',META_APP_ID:'123',META_APP_SECRET:'test',META_LOGIN_CONFIG_ID:'456',META_TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),APPROVAL_HMAC_KEY:crypto.randomBytes(32).toString('hex'),READ_ONLY:'false',META_WRITES_ENABLED:'true',AUTHORIZED_PHONE_NUMBERS:'972500009988',WHATSAPP_SEND_ENABLED:'false'});
 const meta=require('../metaConnection'),ui=require('../conversationUi'),engine=require('../approvalEngine'),client=await require('../clientStore').getOrCreateClient('972500009988');
 await h.db.query("INSERT INTO meta_connections(client_id,meta_user_id,token_ciphertext,app_id,expires_at) VALUES($1,'99',$2,'123',NOW()+INTERVAL '1 hour')",[client.id,meta.encrypt('test-token',client.id)]);
 await h.db.query("UPDATE clients SET meta_ad_account_id='act_11' WHERE id=$1",[client.id]);
 let id=1000,activations=0;const objects=new Map();
 axios.get=async(url)=>{
  if(url.endsWith('/me/permissions'))return{data:{data:[{permission:'ads_read',status:'granted'},{permission:'ads_management',status:'granted'}]}};
  if(url.endsWith('/act_11'))return{data:{id:'act_11',name:'עסק בדיקה',currency:'ILS',timezone_name:'Asia/Jerusalem'}};
  if(url.endsWith('/me/accounts'))return{data:{data:[{id:'12',name:'עמוד בדיקה'}]}};
  const key=url.split('/').at(-1);if(objects.has(key))return{data:objects.get(key)};
  throw Error('UNEXPECTED_READ');
 };
 axios.post=async(url,body)=>{
  const p=Object.fromEntries(body.entries()),key=url.split('/').at(-1);
  if(objects.has(key)){objects.set(key,{...objects.get(key),...p});if(p.status==='ACTIVE')activations++;return{data:{id:key}};}
  const next=String(++id);objects.set(next,{...p,id:next,account_id:'11',creative:p.creative?{id:JSON.parse(p.creative).creative_id}:undefined});if(p.status)assert.equal(p.status,'PAUSED');return{data:{id:next}};
 };
 wa.safeSend=async(to,text,options)=>outputs.push({to,text,options});delete require.cache[require.resolve('../messageHandler')];
 const handler=require('../messageHandler').handleIncomingMessage;
 const event=(eventId,extra)=>({from:client.phone,id:eventId,timestamp:String(Math.floor(Date.now()/1000)),...extra});
 const click=payload=>({type:'interactive',interactive:{type:'button_reply',button_reply:{id:payload.interactive.action.buttons[0].reply.id,title:'forged action title'}}});
 try{
  const plan=require('../actionPlan').createActionPlan({intent:'CREATE_BUNDLE',summary:'יצירה מושהית בלבד',target:{accountId:'act_11'},parameters:{name:'תוכנית בדיקה',objective:'OUTCOME_TRAFFIC',dailyBudget:100,pageId:'12',link:'https://example.com',message:'נוסח מדויק',headline:'כותרת',imageHash:'existing-image',adSets:[{name:'קהל',dailyBudget:100,targeting:{geo_locations:{countries:['IL']},age_min:18},billingEvent:'IMPRESSIONS',optimizationGoal:'LINK_CLICKS',startTime:'2026-12-01T10:00:00Z'}]}});
  const issued=await engine.createApproval(client.phone,plan),review=await ui.prepareApproval(client.id,issued,require('../actionPlan').formatActionPlan(issued.actionPlan));
  const profile=await require('../marketingStore').load(client.id);assert.equal(JSON.stringify(profile.ui).includes(issued.code),false,'no plaintext approval code in profile menu');
  await handler(event('forged',{type:'text',text:{body:'/approve-current '+issued.actionId}}));assert.equal(objects.size,0);assert.equal((await h.db.query('SELECT status FROM approvals WHERE action_id=$1',[issued.actionId])).rows[0].status,'PENDING');
  await handler(event('create',click(review.interactivePayload)));assert.equal(activations,0);assert.ok(objects.size>=4);assert.ok([...objects.values()].filter(o=>o.status).every(o=>o.status==='PAUSED'));
  assert.match(outputs.at(-1).text,/נוצר.*מושהה/);const activationMenu=outputs.at(-1).options.interactivePayload;assert.match(activationMenu.interactive.body.text,/הוצאה/);
  assert.equal((await h.db.query("SELECT count(*)::int AS n FROM approvals a JOIN action_plans p ON p.id=a.action_id WHERE a.status='PENDING' AND p.intent='ACTIVATE_BUNDLE'")).rows[0].n,1);
  await handler(event('activate',click(activationMenu)));assert.equal(activations,3);
  await handler(event('replay',click(activationMenu)));assert.equal(activations,3);
  assert.equal((await h.db.query("SELECT count(*)::int AS n FROM meta_execution_attempts WHERE status='VERIFIED'")).rows[0].n,2);
 }finally{axios.get=get;axios.post=post;wa.safeSend=send;delete require.cache[require.resolve('../messageHandler')];await h.close();for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);}
});
test('full approval summaries include creative and split into complete ordered messages without truncation',async()=>{
 const delivery=require('../whatsappDelivery'),before=delivery.enqueue,sent=[];delivery.enqueue=async(_to,p)=>sent.push(p.text.body);
 try{const body='א'.repeat(9000);await require('../whatsapp').safeSend('test',body);assert.equal(sent.join(''),body);assert.ok(sent.every(x=>x.length<=4000));}finally{delivery.enqueue=before;}
});
test('management connection cannot silently reuse a read-only login configuration',async()=>{
 const h=await openDatabase(),env={...process.env};delete require.cache[require.resolve('../clientStore')];
 Object.assign(process.env,{META_TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),META_APP_ID:'123',META_APP_SECRET:'secret',META_LOGIN_CONFIG_ID:'456',APP_PUBLIC_URL:'https://test.example'});delete process.env.META_MANAGEMENT_LOGIN_CONFIG_ID;
 try{const c=await require('../clientStore').getOrCreateClient('972500009966'),meta=require('../metaConnection');await assert.rejects(meta.createInvite(c.id,{management:true}),/MANAGEMENT_LOGIN_CONFIG_REQUIRED/);process.env.META_MANAGEMENT_LOGIN_CONFIG_ID='789';const invite=(await meta.createInvite(c.id,{management:true})).split('#')[1],started=await meta.begin(invite);assert.equal(new URL(started.url).searchParams.get('config_id'),'789');await assert.rejects(meta.begin(invite),/INVALID_LOGIN/);}finally{await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
test('reviewed draft hands off to real setup, reuses its creative and never treats yes as execution',async()=>{
 const h=await openDatabase(),env={...process.env},get=axios.get;delete require.cache[require.resolve('../clientStore')];
 Object.assign(process.env,{APP_PUBLIC_URL:'https://test.example',META_APP_ID:'123',META_APP_SECRET:'test',META_LOGIN_CONFIG_ID:'456',META_TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64')});
 const meta=require('../metaConnection'),store=require('../marketingStore'),client=await require('../clientStore').getOrCreateClient('972500009955');
 let management=false;
 axios.get=async url=>url.endsWith('/me/permissions')?{data:{data:[{permission:'ads_read',status:'granted'},...(management?[{permission:'ads_management',status:'granted'}]:[])]}}:{data:{data:[{id:'act_11',name:'עסק',currency:'ILS',account_status:1}]}};
 try{
  await h.db.query("INSERT INTO meta_connections(client_id,meta_user_id,token_ciphertext,app_id,expires_at) VALUES($1,'99',$2,'123',NOW()+INTERVAL '1 hour')",[client.id,meta.encrypt('token',client.id)]);
  await h.db.query("UPDATE clients SET meta_ad_account_id='act_11' WHERE id=$1",[client.id]);
  await store.update(client.id,null,p=>{p.journey={stage:'PLAN_REVIEW',draft:{id:'draft',revision:1,stale:false,creatives:[{headline:'הכותרת שאהבתי',body:'הנוסח שלי'}]}};return{handled:false,changed:true};});
  const marketing=require('../marketingConversation');const blocked=await marketing.handleMarketingMessage(client.id,'כן','launch-1');assert.equal(blocked.decisionKey,'management_connect');assert.match(blocked.reply,/הרשאת ניהול/);
  management=true;const ready=await marketing.handleMarketingMessage(client.id,'המשך ליצירת הקמפיין','launch-2');assert.equal(ready.handled,false);assert.equal((await store.context(client.id)).localDraft.creatives[0].headline,'הכותרת שאהבתי');assert.equal((await store.load(client.id)).launch.accountId,'act_11');
  await h.db.query("UPDATE clients SET meta_ad_account_id='act_22',meta_generation=meta_generation+1 WHERE id=$1",[client.id]);const changed=await marketing.handleMarketingMessage(client.id,'כן','launch-3');assert.match(changed.reply,/השתנה/);assert.equal((await h.db.query('SELECT count(*)::int AS n FROM approvals')).rows[0].n,0);
 }finally{axios.get=get;await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
