'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {openDatabase}=require('./helpers/database');
const rid=()=>crypto.randomUUID();
test('marketing pages persist research and private landing drafts with reviewed revision and tenant isolation',async()=>{
 const env={...process.env},h=await openDatabase(),db=h.db;
 Object.assign(process.env,{APP_PUBLIC_URL:'https://campaign.example'});
 try{
  const a=(await db.query("INSERT INTO clients(phone) VALUES('972508881111') RETURNING id")).rows[0].id,b=(await db.query("INSERT INTO clients(phone) VALUES('972508882222') RETURNING id")).rows[0].id;
  const workspace=require('../workspaceService'),drafts=require('../landingDrafts'),landing=require('../landingService');
  const persona=await workspace.save(a,'personas',{name:'בעל עסק',audience:'עסקים קטנים',pains:'חוסר זמן',desires:'יותר פניות'},{requestId:rid()});
  assert.equal((await workspace.list(a,'personas')).items[0].payload.name,'בעל עסק');assert.equal((await workspace.list(b,'personas')).items.length,0);
  await assert.rejects(workspace.save(b,'personas',persona.payload,{id:persona.id,version:persona.version,requestId:rid()}),/WORKSPACE_STALE/);
  assert.throws(()=>workspace.validate('research',{title:'x',question:'y',sourceUrl:'javascript:alert(1)'}));
  const research=await workspace.save(a,'research',{title:'בדיקת הצעה',question:'מה חשוב לקהל?',findings:'שירות אישי',status:'IN_PROGRESS'},{requestId:rid()});assert.equal(research.payload.status,'IN_PROGRESS');
  const payload={businessName:'עסק בדיקה',title:'עמוד בדיקה',body:'תוכן פרטי לבדיקה',cta:'השאירו פרטים'},requestId=rid();
  const page=await drafts.save(a,{payload,requestId});assert.equal(page.status,'DRAFT');assert.equal((await drafts.save(a,{payload,requestId})).id,page.id);
  const row=(await db.query('SELECT slug FROM landing_pages WHERE id=$1',[page.id])).rows[0];await assert.rejects(landing.get(row.slug),/LANDING_NOT_FOUND/);
  await assert.rejects(drafts.save(b,{payload,revision:page.revision,requestId:rid()},page.id),/WORKSPACE_STALE/);
  const updated=await drafts.save(a,{payload:{...payload,title:'נוסח עדכני'},revision:page.revision,requestId:rid()},page.id);assert.equal(updated.revision,2);
  await assert.rejects(drafts.publish(a,page.id,{revision:2,requestId:rid()}),/CONFIRMATION/);
  await require('../portalStore').register(a,{name:'בדיקה',acceptPrivacy:true});
  await assert.rejects(drafts.publish(a,page.id,{revision:1,confirmPublish:true,requestId:rid()}),/WORKSPACE_STALE/);
  const publish={revision:2,confirmPublish:true,requestId:rid()};const published=await drafts.publish(a,page.id,publish);assert.equal(published.status,'PUBLISHED');assert.equal((await drafts.publish(a,page.id,publish)).url,published.url);assert.equal((await landing.get(row.slug)).payload.title,'נוסח עדכני');
  await assert.rejects(drafts.save(a,{payload,revision:published.revision,requestId:rid()},page.id),/WORKSPACE_STALE/);
 }finally{await h.close();for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);}
});
test('all marketing and system pages have independently reloadable authenticated-shell routes',async()=>{
 const app=require('../index'),server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.once('error',reject);});
 try{const base='http://127.0.0.1:'+server.address().port;for(const name of ['home','pages','brand','products','creative','content','campaign','landing','research','integrations','users','help','account']){const r=await fetch(base+'/app/'+name);assert.equal(r.status,200,name);assert.match(await r.text(),/SCORPIO AI/);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);}assert.equal((await fetch(base+'/app/not-a-page')).status,404);}finally{await new Promise(resolve=>server.close(resolve));}
});
