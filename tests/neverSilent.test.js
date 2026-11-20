'use strict';
// The agent never answers with silence: waitlist, slow-down, progress and human-handover replies.
const test=require('node:test'),assert=require('node:assert/strict');
const {openDatabase}=require('./helpers/database');

function env(values){const before={...process.env};Object.assign(process.env,values);return()=>{for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);};}
const msg=(from,id,body)=>({from,id,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body}});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
// One database for the file: some modules keep the query function they were loaded with.
let h;test.before(async()=>{h=await openDatabase();});test.after(async()=>{await h.close();});

test('senders outside the pilot get one waitlist reply a day and are saved; nothing about other businesses',async()=>{
 const wa=require('../whatsapp'),transport=wa.transport,sent=[];
 const restore=env({AUTHORIZED_PHONE_NUMBERS:'972500000901',WHATSAPP_SEND_ENABLED:'true',PUBLIC_ONBOARDING_ENABLED:'false'});
 wa.transport=async(to,payload)=>{sent.push({to,payload});return{messages:[{id:'wamid.wait'+sent.length}]};};
 delete require.cache[require.resolve('../messageHandler')];
 try{
  const handle=require('../messageHandler').handleIncomingMessage,stranger='972500000771';
  for(const i of [1,2,3])await handle(msg(stranger,'wamid.s'+i,'היי, אפשר לשמוע על השירות?'),{profile:{name:'דנה'}});
  assert.equal(sent.length,1,'one reply per sender per day');
  assert.equal(sent[0].to,stranger);
  assert.equal(sent[0].payload.text.body,require('../inboundNotices').WAITLIST_TEXT);
  assert.match(sent[0].payload.text.body,/אנחנו בפיילוט כרגע\. שמרנו את הפרטים שלך ונחזור אליך בקרוב/);
  const row=(await h.db.query('SELECT * FROM pilot_waitlist WHERE phone=$1',[stranger])).rows[0];
  assert.equal(row.messages,3);assert.equal(row.display_name,'דנה');assert.equal(row.reason,'NOT_IN_PILOT');
  assert.equal((await h.db.query('SELECT count(*)::int AS n FROM clients WHERE phone=$1',[stranger])).rows[0].n,0,'no client account for a waitlisted sender');
  // Next day: one more reply.
  await h.db.query("UPDATE pilot_waitlist SET last_notice_on=CURRENT_DATE-1 WHERE phone=$1",[stranger]);
  await handle(msg(stranger,'wamid.s4','שוב שלום'),{});
  assert.equal(sent.length,2);
 }finally{wa.transport=transport;restore();delete require.cache[require.resolve('../messageHandler')];}
});

test('new customers past the daily cap get the waitlist reply instead of silence',async()=>{
 const wa=require('../whatsapp'),transport=wa.transport,sent=[];
 const restore=env({PUBLIC_ONBOARDING_ENABLED:'true',WHATSAPP_SEND_ENABLED:'true'});
 wa.transport=async(to,payload)=>{sent.push({to,payload});return{messages:[{id:'wamid.cap'+sent.length}]};};
 delete require.cache[require.resolve('../messageHandler')];
 try{
  const limit=require('../rateLimit');for(let i=0;i<50;i++)await limit.take('public-new-clients',50,86400);
  const handle=require('../messageHandler').handleIncomingMessage,late='972500000772';
  await handle(msg(late,'wamid.cap-1','שלום'),{});await handle(msg(late,'wamid.cap-2','שלום?'),{});
  assert.equal(sent.length,1);assert.equal(sent[0].to,late);assert.match(sent[0].payload.text.body,/בפיילוט/);
  assert.equal((await h.db.query('SELECT reason FROM pilot_waitlist WHERE phone=$1',[late])).rows[0].reason,'DAILY_CAP');
  assert.equal((await h.db.query('SELECT count(*)::int AS n FROM clients WHERE phone=$1',[late])).rows[0].n,0);
 }finally{wa.transport=transport;restore();delete require.cache[require.resolve('../messageHandler')];}
});

test('over the per-minute limit the owner gets one slow-down notice per window',async()=>{
 const wa=require('../whatsapp'),send=wa.safeSend,out=[];
 const restore=env({AUTHORIZED_PHONE_NUMBERS:'972500000773',WHATSAPP_SEND_ENABLED:'false'});
 wa.safeSend=async(to,text)=>{out.push({to,text,tenant:require('../metaConnection').context.getStore()});};
 delete require.cache[require.resolve('../messageHandler')];
 try{
  const client=await require('../clientStore').getOrCreateClient('972500000773'),limit=require('../rateLimit');
  for(let i=0;i<20;i++)await limit.take('chat:'+client.id,20);
  const handle=require('../messageHandler').handleIncomingMessage;
  for(const i of [1,2,3])await handle(msg('972500000773','wamid.fast'+i,'עוד הודעה'),{});
  assert.equal(out.length,1);assert.equal(out[0].text,require('../inboundNotices').SLOW_DOWN_TEXT);assert.equal(out[0].tenant,String(client.id));
 }finally{wa.safeSend=send;restore();delete require.cache[require.resolve('../messageHandler')];}
});

test('read + typing right away, one progress message only when the reply is slow',async()=>{
 const wa=require('../whatsapp'),send=wa.safeSend,status=wa.statusTransport,delivery=require('../whatsappDelivery');
 const restore=env({PROCESSING_NOTICE_DELAY_MS:'40',WHATSAPP_SEND_ENABLED:'true'});
 const out=[],statuses=[];
 wa.safeSend=async(to,text)=>{const c=delivery.messageContext.getStore();c.sequence++;out.push(text);};
 wa.statusTransport=async body=>{statuses.push(body);return{success:true};};
 const {withProgressNotice,SLOW_TEXT}=require('../processingNotice');
 const run=(id,work)=>delivery.messageContext.run({eventId:id,sequence:0},()=>withProgressNotice('972500000774',id,work));
 try{
  await run('wamid.quick',async()=>{await wait(5);await wa.safeSend('972500000774','תשובה מהירה');});
  assert.deepEqual(out,['תשובה מהירה'],'fast replies get no interim message');
  assert.deepEqual(statuses[0],{messaging_product:'whatsapp',status:'read',message_id:'wamid.quick',typing_indicator:{type:'text'}});
  out.length=0;
  await run('wamid.slow',async()=>{await wait(150);await wa.safeSend('972500000774','תשובה איטית');});
  assert.deepEqual(out,[SLOW_TEXT,'תשובה איטית'],'exactly one progress message, before the reply');
  out.length=0;
  // An earlier reply (or a specific notice) already went out: no extra generic notice.
  await run('wamid.partial',async()=>{await wa.safeSend('972500000774','חלק ראשון');await wait(120);});
  assert.deepEqual(out,['חלק ראשון']);
  out.length=0;
  await run('wamid.graphic',async()=>{await require('../processingNotice').notifyProcessing('972500000774','מכין לך את הגרפיקה');await wait(120);});
  assert.deepEqual(out,['מכין לך את הגרפיקה']);
  process.env.WHATSAPP_SEND_ENABLED='false';statuses.length=0;
  await run('wamid.off',async()=>{});assert.equal(statuses.length,0,'no status calls while sending is off');
 }finally{wa.safeSend=send;wa.statusTransport=status;restore();}
});

test('"נציג" and natural variants hand over, notify operators once, and state a response time',async()=>{
 const wa=require('../whatsapp'),send=wa.safeSend,out=[];
 const restore=env({AUTHORIZED_PHONE_NUMBERS:'972500000775,972500000776',WHATSAPP_SEND_ENABLED:'false'});
 wa.safeSend=async(to,text)=>{out.push({to,text});};
 delete require.cache[require.resolve('../messageHandler')];
 try{
  const support=require('../humanSupport');
  for(const t of ['נציג','נציג!','אפשר נציג?','אפשר לדבר עם בן אדם','אני רוצה לדבר עם נציג','תעביר אותי לנציג','נציג אנושי','speak to a human'])assert.equal(support.humanRequested(t),true,t);
  for(const t of ['מודעה לנציג מכירות','דרושים נציגי שירות','נציג עבודה','בן אדם צריך לאכול'])assert.equal(support.humanRequested(t),false,t);
  const operator=await require('../clientStore').getOrCreateClient('972500000776'),owner=await require('../clientStore').getOrCreateClient('972500000775');
  process.env.SUPPORT_OPERATOR_CLIENT_IDS=String(operator.id);
  const handle=require('../messageHandler').handleIncomingMessage;
  await handle(msg('972500000775','wamid.h1','נציג'),{});
  const toOwner=out.filter(x=>x.to==='972500000775'),toOperator=out.filter(x=>x.to==='972500000776');
  assert.equal(toOwner.length,1);assert.match(toOwner[0].text,/נציג יחזור אליך עד יום העסקים הבא/);assert.match(toOwner[0].text,/המשך עם הבוט/);
  assert.doesNotMatch(toOwner[0].text,/עדיין לא הוגדר זמן מענה/);
  assert.equal(toOperator.length,1);assert.match(toOperator[0].text,/נציג אנושי/);assert.match(toOperator[0].text,new RegExp('#'+owner.id));
  assert.equal((await support.current(owner.id)).bot_paused,true);
  // Asking again while waiting does not page the team twice.
  await handle(msg('972500000775','wamid.h2','אפשר לדבר עם בן אדם?'),{});
  assert.equal(out.filter(x=>x.to==='972500000776').length,1);
  await handle(msg('972500000775','wamid.h3','המשך עם הבוט'),{});
  assert.equal((await support.current(owner.id)),null);
  assert.match(out.at(-1).text,/המענה האוטומטי חודש/);
 }finally{wa.safeSend=send;restore();delete require.cache[require.resolve('../messageHandler')];}
});
