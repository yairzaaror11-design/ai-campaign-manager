'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),axios=require('axios');
const {openDatabase}=require('./helpers/database');
test('one initial Meta authorization requests the configured full connection, without an extra send-link approval',async t=>{
 const env={...process.env},get=axios.get,post=axios.post,h=await openDatabase();delete require.cache[require.resolve('../clientStore')];
 Object.assign(process.env,{APP_PUBLIC_URL:'https://test.example',META_APP_ID:'123',META_APP_SECRET:'secret',META_LOGIN_CONFIG_ID:'456',META_MANAGEMENT_LOGIN_CONFIG_ID:'789',META_TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64')});
 const meta=require('../metaConnection'),guided=require('../metaConversation'),a=await require('../clientStore').getOrCreateClient('972500001441');
 let granted=['ads_read','ads_management','pages_read_engagement','pages_show_list'],accountAllowed=true;
 axios.get=async url=>url.endsWith('/me/permissions')?{data:{data:granted.map(permission=>({permission,status:'granted'}))}}:url.endsWith('/me/adaccounts')?{data:{data:accountAllowed?[{id:'act_11',name:'עסק',currency:'ILS',account_status:1}]:[]}}:url.endsWith('/act_11')?(accountAllowed?{data:{id:'act_11',account_status:1}}:Promise.reject(Error('revoked'))):{data:{id:'99'}};
 axios.post=async()=>({data:{access_token:'new-user-token',expires_in:3600}});
 try{
  await t.test('ordinary first connection immediately provides a single full-permission link',async()=>{
   const r=await guided.handle(a.id,'חבר חשבון מטא',{intent:'connect'},'one-connect');assert.match(r.reply,/חיבור חד־פעמי/);assert.doesNotMatch(r.reply,/לשלוח קישור/);assert.equal(r.decisionKey,undefined);
   const url=r.reply.match(/https:\/\/[^\s]+/)[0];assert.equal(new URL(url).searchParams.get('mode'),'manage');const login=await meta.begin(new URL(url).hash.slice(1));assert.equal(new URL(login.url).searchParams.get('config_id'),'789');await meta.callback(new URL(login.url).searchParams.get('state'),login.browser,'first');
  });
  await t.test('after the full grant, connecting again does not ask for another authorization',async()=>{
   await meta.selectAccount(a.id,'act_11');const r=await guided.handle(a.id,'חבר חשבון מטא',{intent:'connect'},'again');assert.match(r.reply,/אומת וחובר/);assert.doesNotMatch(r.reply,/connect\?/);assert.equal((await h.db.query("SELECT count(*)::int AS n FROM meta_login_secrets WHERE kind='INVITE'")).rows[0].n,0);
  });
  await t.test('a required token renewal preserves the selected account only after verifying the new token',async()=>{
   const login=await meta.begin((await meta.createInvite(a.id)).split('#')[1]);const before=(await meta.credentials(a.id)).meta_generation;await meta.callback(new URL(login.url).searchParams.get('state'),login.browser,'renew');const after=await meta.credentials(a.id);assert.equal(after.meta_ad_account_id,'act_11');assert.ok(Number(after.meta_generation)>Number(before));
   accountAllowed=false;const revoked=await meta.begin((await meta.createInvite(a.id)).split('#')[1]);await meta.callback(new URL(revoked.url).searchParams.get('state'),revoked.browser,'revoked');assert.equal((await meta.credentials(a.id)).meta_ad_account_id,null);accountAllowed=true;
  });
  await t.test('legacy read-only customers get the same full-permission link, not a false management success',async()=>{
   granted=['ads_read'];await meta.selectAccount(a.id,'act_11');const r=await guided.handle(a.id,'/meta-connect',{intent:'other'},'upgrade');assert.match(r.reply,/חיבור חד־פעמי/);assert.match(r.reply,/mode=manage/);assert.equal((await h.db.query('SELECT count(*)::int AS n FROM meta_execution_attempts')).rows[0].n,0);
  });
  await t.test('partial Meta consent cannot be presented or saved as a full management connection',async()=>{
   const before=(await meta.credentials(a.id)).meta_generation,login=await meta.begin((await meta.createInvite(a.id)).split('#')[1]);await assert.rejects(meta.callback(new URL(login.url).searchParams.get('state'),login.browser,'partial'),/ADS_MANAGEMENT_REQUIRED/);assert.equal((await meta.credentials(a.id)).meta_generation,before);assert.equal((await require('../marketingStore').load(a.id)).connection.lastError,'ADS_MANAGEMENT_REQUIRED');
  });
 }finally{axios.get=get;axios.post=post;await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
