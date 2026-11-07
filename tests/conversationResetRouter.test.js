'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {openDatabase}=require('./helpers/database');
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
