'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('./helpers/database');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('NOTICE_TEST_TIMEOUT')),5000);})]);}finally{clearTimeout(timer);}}

test('real worker delivers an interim reply while graphics and AI are still pending, then delivers each result once',async()=>{
 const h=await openDatabase();
 const previous={...process.env};
 const whatsapp=require('../whatsapp'),graphics=require('../graphicService');
 const before={transport:whatsapp.transport,createGraphic:graphics.createGraphic};
 const delivery=require('../whatsappDelivery');
 let stop;
 const graphicGate=deferred(),graphicStarted=deferred(),graphicNotice=deferred(),imageSent=deferred();
 const aiGate=deferred(),aiStarted=deferred(),aiNotice=deferred(),answerSent=deferred();
 const sent=[];
 let phase='graphic';
 whatsapp.transport=async(to,payload)=>{
  sent.push({to,payload});
  if(payload.type==='text'&&/מכין לך את הגרפיקה/.test(payload.text.body))graphicNotice.resolve();
  if(payload.type==='image')imageSent.resolve();
  if(phase==='ai'&&payload.type==='text'&&payload.text.body==='קיבלתי, בודק ומכין לך תשובה.')aiNotice.resolve();
  if(payload.type==='text'&&payload.text.body==='תשובה מוכנה')answerSent.resolve();
  return{messages:[{id:'wamid.notice-'+sent.length}]};
 };
 graphics.createGraphic=async()=>{graphicStarted.resolve();return graphicGate.promise;};
 process.env.AUTHORIZED_PHONE_NUMBERS='972501000444';process.env.WHATSAPP_SEND_ENABLED='true';process.env.AI_PROVIDER='notice_test';
 require('../aiService').registerProvider('notice_test',async()=>{aiStarted.resolve();await aiGate.promise;return{text:'תשובה מוכנה',actionPlans:[]};});
 const inbound=require('../whatsappInboundStore');
 const from='972501000444';
 const event=(id,text)=>({eventId:id,payload:{message:{id,from,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:text}},contact:{}}});
 try {
  await inbound.enqueueInboundEvents([event('progress-graphic','צור לי גרפיקה לבית קפה')]);
  stop=require('../backgroundJobs').startBackgroundJobs({intervalMs:10});
  await bounded(graphicStarted.promise);await bounded(graphicNotice.promise);
  assert.equal(sent.length,1,'notice arrives before resolving the image generator');
  assert.equal(sent[0].payload.type,'text');
  graphicGate.resolve({id:'local-image',whatsapp_media_id:'123456'});
  await bounded(imageSent.promise);
  assert.deepEqual(sent.map(x=>x.payload.type),['text','image']);
  phase='ai';
  await inbound.enqueueInboundEvents([event('progress-ai','איך אפשר לשפר את ההצעה העסקית?')]);
  await bounded(aiStarted.promise);await bounded(aiNotice.promise);
  assert.equal(sent.length,3,'AI notice is delivered before AI resolves');
  aiGate.resolve();await bounded(answerSent.promise);
  assert.equal(sent.length,4);
  assert.equal((await inbound.enqueueInboundEvents([event('progress-ai','איך אפשר לשפר את ההצעה העסקית?')])).inserted,0);
  await stop();stop=null;
  const rows=await h.db.query('SELECT status FROM whatsapp_outbox ORDER BY created_at');
  assert.equal(rows.rows.length,4);assert.ok(rows.rows.every(r=>r.status==='SENT'));
  assert.equal((await h.db.query('SELECT * FROM worker_heartbeats')).rows.length,0);
  assert.equal((await h.db.query('SELECT * FROM approvals')).rows.length,0);
 } finally {
  graphicGate.resolve({id:'local-image',whatsapp_media_id:'123456'});aiGate.resolve();
  if(stop)await stop();
  whatsapp.transport=before.transport;graphics.createGraphic=before.createGraphic;
  for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];
  Object.assign(process.env,previous);await h.close();
 }
});

test('a voice-to-AI chain only queues one notice per inbound context',async()=>{
 const delivery=require('../whatsappDelivery'),whatsapp=require('../whatsapp');
 const before=whatsapp.safeSend;const sent=[];whatsapp.safeSend=async(to,text)=>{sent.push(text);};
 try {
  await delivery.messageContext.run({eventId:'voice',sequence:0},async()=>{
   await require('../processingNotice').notifyProcessing('test','מקשיב');
   await require('../processingNotice').notifyProcessing('test','מכין תשובה');
  });
  assert.deepEqual(sent,['מקשיב']);
  await require('../processingNotice').notifyProcessing('test','ללא הקשר');assert.equal(sent.length,1);
 } finally {whatsapp.safeSend=before;}
});
