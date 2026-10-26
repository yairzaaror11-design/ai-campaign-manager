'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {openDatabase}=require('./helpers/database');
test('repair migration removes only contaminated facts and is repeatable',async()=>{
 const h=await openDatabase();
 try{
  const store=require('../marketingStore'),facts=require('../conversationFacts'),clients=require('../clientStore');
  const a=await clients.getOrCreateClient('972501009001'),b=await clients.getOrCreateClient('972501009002');
  for(const c of [a,b])await store.update(c.id,null,p=>{
   facts.write(p,'businessName','יאיר דיגיטל');facts.write(p,'advantage','שירות אישי');require('../campaignJourney').init(p);
   p.connection={status:'CONNECTED',account:{id:'act_123'}};p.ui={nonce:'old'};p.journey.draft={status:'LOCAL_DRAFT',creatives:[]};
   if(c.id===a.id)p.answers[facts.descriptor(p,'advantage').address].value='תמחק את השיחה אני רוצה להתחיל מחדש';
   return{handled:false,changed:true};
  });
  const unaffected=JSON.stringify(await store.load(b.id));
  const sql=fs.readFileSync(path.join(__dirname,'../migrations/008_remove_conversation_control_facts.sql'),'utf8');
  await h.db.query(sql);const fixed=await store.load(a.id);
  assert.equal(facts.value(fixed,'advantage'),null);assert.equal(facts.value(fixed,'businessName'),'יאיר דיגיטל');
  assert.equal(fixed.connection.account.id,'act_123');assert.equal(fixed.ui,undefined);assert.equal(fixed.journey.draft,null);
  assert.equal(JSON.stringify(await store.load(b.id)),unaffected);
  await h.db.query(sql);assert.equal(JSON.stringify(await store.load(a.id)),JSON.stringify(fixed));
 }finally{await h.close();}
});
test('Hebrew reset through the WhatsApp router clears facts and menus and does not reimport history',async()=>{
 const h=await openDatabase(),env={...process.env};const whatsapp=require('../whatsapp'),original=whatsapp.safeSend,outputs=[];
 whatsapp.safeSend=async(_to,text)=>outputs.push(text);delete require.cache[require.resolve('../messageHandler')];
 Object.assign(process.env,{AUTHORIZED_PHONE_NUMBERS:'972501009003',MARKETING_DISCOVERY_ENABLED:'true',WHATSAPP_SEND_ENABLED:'false'});
 try{
  const c=await require('../clientStore').getOrCreateClient('972501009003'),store=require('../marketingStore');
  await store.update(c.id,null,p=>{require('../conversationFacts').write(p,'businessName','ישן');p.ui={nonce:'old'};p.mediaContext={assetId:'old'};p.connection={status:'DISCONNECTED'};return{handled:false,changed:true};});
  await require('../sessionStore').appendMessages(c.phone,[{role:'user',content:'שם העסק: ישן'}]);
  const handle=require('../messageHandler').handleIncomingMessage;
  const message=(id,text)=>({from:c.phone,id,type:'text',timestamp:String(Math.floor(Date.now()/1000)),text:{body:text}});
  await handle(message('repair-reset','תמחק את השיחה אני רוצה להתחיל מחדש'));
  let p=await store.load(c.id);assert.deepEqual(p.answers,{});assert.equal(p.ui,undefined);assert.equal(p.mediaContext,undefined);
  assert.equal(p.connection.status,'DISCONNECTED');assert.equal(p.journey.historyImported,true);assert.equal(p.journey.pendingField,'businessType');
  assert.match(outputs.at(-1),/מה העסק עושה/);
  assert.equal((await require('../sessionStore').getHistory(c.phone)).length,0);
  await handle(message('repair-next','חנות פרחים'));p=await store.load(c.id);
  assert.equal(require('../conversationFacts').value(p,'businessName'),null);
  assert.equal(require('../conversationFacts').value(p,'businessType'),'חנות פרחים');
  assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM approvals')).rows[0].n,0);
 }finally{whatsapp.safeSend=original;delete require.cache[require.resolve('../messageHandler')];for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);await h.close();}
});
