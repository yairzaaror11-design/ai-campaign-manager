'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),axios=require('axios');
const {openDatabase}=require('./helpers/database'),social=require('../socialConnections');
test('preserved dashboard social adapters work through the portal session model with mocked providers',async t=>{
 const env={...process.env},h=await openDatabase(),db=h.db;
 const a=(await db.query("INSERT INTO clients(phone) VALUES('972509005555') RETURNING id")).rows[0].id,b=(await db.query("INSERT INTO clients(phone) VALUES('972509006666') RETURNING id")).rows[0].id;
 const originalPost=axios.post,originalGet=axios.get;
 process.env.META_TOKEN_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');
 try{
 await t.test('unconfigured providers fail closed before any network call',async()=>{
  for(const p of Object.values(social.providers)){delete process.env['SOCIAL_'+p.prefix+'_CLIENT_ID'];delete process.env['SOCIAL_'+p.prefix+'_CLIENT_SECRET'];}
  let calls=0;axios.post=async()=>{calls++;throw Error('NO_NETWORK');};
  await assert.rejects(social.begin(a,'linkedin'),/PROVIDER_NOT_CONFIGURED/);
  await assert.rejects(social.begin(a,'unknown'),/INVALID_PROVIDER/);
  assert.equal(calls,0);
 });
 await t.test('all six OAuth adapters enforce one-use browser binding and encrypt tokens',async()=>{
 process.env.APP_PUBLIC_URL='https://app.example.com';process.env.DASHBOARD_ORIGIN=process.env.APP_PUBLIC_URL;
 for(const [name,p] of Object.entries(social.providers)){process.env['SOCIAL_'+p.prefix+'_CLIENT_ID']=name+'-app';process.env['SOCIAL_'+p.prefix+'_CLIENT_SECRET']='test-secret-'+name;}
 let calls=0;axios.post=async(url,params,options)=>{calls++;assert.equal(params.get('grant_type'),'authorization_code');if(url==='https://api.x.com/2/oauth2/token'){assert.ok(params.get('code_verifier'));assert.match(options.headers.Authorization,/^Basic /);}return {data:{access_token:'private-access-token',refresh_token:'private-refresh-token',expires_in:3600,scope:'read'}};};
 axios.get=async url=>{if(url.includes('facebook'))return {data:{data:[{id:'page-1',name:'Page A',instagram_business_account:{id:'ig-1',username:'studio'}}]}};if(url.includes('linkedin'))return {data:{sub:'li-1',name:'LinkedIn A'}};if(url.includes('tiktok'))return {data:{data:{user:{open_id:'tt-1',display_name:'TikTok A'}}}};if(url.includes('youtube'))return {data:{items:[{id:'yt-1',snippet:{title:'Channel A'}}]}};return {data:{data:{id:'x-1',name:'X A'}}};};
 for(const name of Object.keys(social.providers)){const start=await social.begin(String(a),name),u=new URL(start.url);assert.equal(u.searchParams.get('redirect_uri'),'https://app.example.com/auth/social/callback/'+name);if(name==='x')assert.equal(u.searchParams.get('code_challenge_method'),'S256');const before=calls;await assert.rejects(social.callback(name,u.searchParams.get('state'),'z'.repeat(43),'code'),/INVALID_SOCIAL_STATE/);assert.equal(calls,before);await social.callback(name,u.searchParams.get('state'),start.binding,'code');await assert.rejects(social.callback(name,u.searchParams.get('state'),start.binding,'code'),/INVALID_SOCIAL_STATE/);const row=(await db.query('SELECT token_ciphertext FROM social_connections WHERE client_id=$1 AND provider=$2',[a,name])).rows[0];assert.ok(!row.token_ciphertext.includes('private-access-token'));assert.ok((await social.list(String(a))).find(s=>s.id===name).connected);assert.ok(!(await social.list(String(b))).find(s=>s.id===name).connected);}
 const start=await social.begin(String(a),'x');await social.disconnect(String(a),'x');await assert.rejects(social.callback('x',new URL(start.url).searchParams.get('state'),start.binding,'code'),/INVALID_SOCIAL_STATE/);
 });
 await t.test('multiple Pages require explicit account selection and cannot cross tenants',async()=>{axios.get=async()=>({data:{data:[{id:'page-1',name:'One'},{id:'page-2',name:'Two'}]}});const s=await social.begin(String(a),'facebook');await social.callback('facebook',new URL(s.url).searchParams.get('state'),s.binding,'code');let row=(await social.list(String(a))).find(s=>s.id==='facebook');assert.equal(row.connected,false);assert.equal(row.selectionRequired,true);await assert.rejects(social.selectAccount(String(b),'facebook','page-1'),/INVALID_ACCOUNT/);await assert.rejects(social.selectAccount(String(a),'facebook','forged'),/INVALID_ACCOUNT/);await social.selectAccount(String(a),'facebook','page-2');row=(await social.list(String(a))).find(s=>s.id==='facebook');assert.equal(row.connected,true);assert.equal(row.displayName,'Two');});


 await t.test('revoked portal session and denied consent invalidate OAuth before token exchange',async()=>{
  const portal=require('../portalStore'),token=(await portal.createTicket(a)).split('#login=')[1],session=await portal.redeem(token);
  let calls=0;axios.post=async()=>{calls++;throw Error('UNEXPECTED_NETWORK');};
  const start=await social.begin(a,'linkedin',portal.hash(session.session));
  await db.query('DELETE FROM portal_sessions WHERE token_hash=$1',[portal.hash(session.session)]);
  await assert.rejects(social.callback('linkedin',new URL(start.url).searchParams.get('state'),start.binding,'code'),/SOCIAL_APPROVAL_CHANGED/);
  const denied=await social.begin(a,'linkedin');
  await assert.rejects(social.callback('linkedin',new URL(denied.url).searchParams.get('state'),denied.binding,null,true),/SOCIAL_CONSENT_DENIED/);
  assert.equal(calls,0);
 });
 }finally{axios.post=originalPost;axios.get=originalGet;await h.close();for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);}
});

