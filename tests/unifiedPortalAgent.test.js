'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),axios=require('axios');
const {openDatabase}=require('./helpers/isolatedDatabase');
test('voice WhatsApp task continues through authenticated app chat with shared history, exact approval, replay and media isolation',async()=>{
 const env={...process.env},h=await openDatabase(),wa=require('../whatsapp'),voice=require('../voiceHandler'),media=require('../mediaHandler'),meta=require('../metaConnection');
 const before={send:wa.safeSend,voice:voice.transcribeVoiceMessage,get:axios.get,post:axios.post,media:media.receiveWhatsAppMedia};
 const phone='972500077101',sent=[];
 Object.assign(process.env,{APP_PUBLIC_URL:'https://scorpio.example',META_APP_ID:'123',META_APP_SECRET:'fixture',META_LOGIN_CONFIG_ID:'456',META_TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),APPROVAL_HMAC_KEY:crypto.randomBytes(32).toString('hex'),UNIFIED_CONVERSATION_ENABLED:'true',UNIFIED_PORTAL_AGENT_ENABLED:'true',SCOPED_AUTOMATION_ENABLED:'false',TASK_AGENT_ENABLED:'true',TASK_AGENT_REQUIRE_EVAL:'false',TASK_AGENT_PILOT_ONLY:'true',AUTHORIZED_PHONE_NUMBERS:phone,READ_ONLY:'false',META_WRITES_ENABLED:'true',WHATSAPP_SEND_ENABLED:'false',PUBLIC_ONBOARDING_ENABLED:'false',AI_PROVIDER:'unified_portal_fixture'});
 const a=await require('../clientStore').getOrCreateClient(phone),b=await require('../clientStore').getOrCreateClient('972500077102');
 await h.db.query("INSERT INTO meta_connections(client_id,meta_user_id,token_ciphertext,app_id,expires_at) VALUES($1,'fixture',$2,'123',NOW()+INTERVAL '1 hour')",[a.id,meta.encrypt('fixture-token',a.id)]);await h.db.query("UPDATE clients SET meta_ad_account_id='act_11' WHERE id=$1",[a.id]);
 const parameters={name:'משרת מחסנאי בחיפה',pageId:'555',locale:'HE_IL',privacyPolicyUrl:'https://business.example/privacy',questions:[{type:'FULL_NAME'},{type:'PHONE'}]};
 let writes=0,calls=0;
 axios.get=async url=>{
  if(url.endsWith('/act_11'))return{data:{id:'act_11',name:'Fixture',currency:'ILS',timezone_name:'Asia/Jerusalem'}};
  if(url.endsWith('/me/permissions'))return{data:{data:[{permission:'ads_management',status:'granted'}]}};
  if(url.endsWith('/me/accounts'))return{data:{data:[{id:'555',access_token:'fixture-page'}]}};
  if(url.endsWith('/778'))return{data:{id:'778',page_id:'555',name:parameters.name,locale:parameters.locale,privacy_policy_url:parameters.privacyPolicyUrl,questions:parameters.questions,status:'ACTIVE'}};
  throw Error('UNEXPECTED_PROVIDER_READ');
 };
 axios.post=async url=>{assert.ok(url.endsWith('/555/leadgen_forms'));writes++;return{data:{id:'778'}};};
 const plan=[{id:'details',label:'פרטי המשרה',kind:'collect',dependsOn:[]},{id:'copy',label:'הטופס לבדיקה',kind:'draft',dependsOn:['details']},{id:'form',label:'טופס ב־Meta',kind:'meta',intent:'CREATE_LEAD_FORM',dependsOn:['copy']}];
 require('../aiService').registerProvider('unified_portal_fixture',async raw=>{
  calls++;const c=JSON.parse(raw);let next;
  if(!c.plan.length)next={op:'ask',stepId:'details',question:'לאיזו משרה ובאיזה אזור מגייסים?'};
  else if(c.plan[0].status!=='DONE')next={op:'collect',stepId:'details',facts:[{key:'role',value:'מחסנאי בחיפה',evidence:'מחסנאי בחיפה'}]};
  else if(c.plan[1].status==='PENDING')next={op:'draft',stepId:'copy',title:'טופס מועמדות',content:JSON.stringify(parameters)};
  else if(c.plan[1].status==='PREPARED')next={op:'review'};
  else if(c.plan[2].status!=='DONE')next={op:'meta',stepId:'form',proposal:{intent:'CREATE_LEAD_FORM',summary:'יצירת טופס מועמדות',target:{accountId:'act_11'},parameters}};
  else next={op:'finish'};
  return{text:JSON.stringify({...(!c.plan.length?{plan}:{}),next}),actionPlans:[]};
 });
 voice.transcribeVoiceMessage=async()=> 'תכין מודעה וטופס מועמדות לעובד';wa.safeSend=async(_to,text)=>sent.push(text);
 delete require.cache[require.resolve('../messageHandler')];const incoming=require('../messageHandler').handleIncomingMessage;
 const app=require('../index'),server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));}),root='http://127.0.0.1:'+server.address().port;
 const call=(path,body,session)=>fetch(root+path,{method:body?'POST':'GET',headers:{...(session?{Cookie:session.cookie}:{}),...(body?{Origin:'https://scorpio.example','Content-Type':'application/json','X-CSRF-Token':session?.csrf||''}:{})},body:body?JSON.stringify(body):undefined});
 async function login(c){const token=(await require('../portalStore').createTicket(c.id)).split('#login=')[1],r=await call('/app/api/login',{token});const cookies=r.headers.getSetCookie().map(s=>s.split(';')[0]);return{cookie:cookies.join('; '),csrf:cookies.find(s=>s.startsWith('cb_csrf=')).split('=')[1]};}
 const chat=async(session,message,requestId=crypto.randomUUID())=>{const body={message,requestId,screen:'agent',clientId:b.id};const r=await call('/app/api/agent',body,session);assert.equal(r.status,200);return{body,result:await r.json()};};
 try{
  await incoming({id:'voice-start',from:phone,type:'audio',audio:{id:'fixture-audio'},timestamp:String(Math.floor(Date.now()/1000))});assert.match(sent.at(-1),/לאיזו משרה/);const original=await require('../taskAgent').current(a.id),waReplies=sent.length;
  const sa=await login(a),sb=await login(b),history=await(await call('/app/api/agent',null,sa)).json();assert.equal(history.conversationMode,'unified');assert.ok(history.messages.some(m=>m.channel==='WHATSAPP'&&m.role==='user'));assert.ok(history.messages.some(m=>m.content.includes('לאיזו משרה')));
  const details=await chat(sa,'מחסנאי בחיפה');assert.equal(details.result.task.id,original.id);assert.equal(details.result.task.status,'WAITING_REVIEW');assert.equal(sent.length,waReplies);assert.equal(writes,0);
  const n=calls,replay=await(await call('/app/api/agent',details.body,sa)).json();assert.deepEqual(replay,details.result);assert.equal(calls,n);
  const pending=await chat(sa,'מאשר את החבילה');assert.equal(pending.result.task.status,'WAITING_APPROVAL');const code=pending.result.reply.match(/אשר (\d{6})/)[1];assert.equal(writes,0);
  const profile=await require('../marketingStore').load(a.id),saved=profile.portalChat.requests.find(r=>r.id===pending.body.requestId).result;assert.equal(saved.reply,undefined);assert.equal(typeof saved.replyCiphertext,'string');assert.equal(JSON.stringify(profile.portalChat.messages).includes(code),false);
  assert.deepEqual(await(await call('/app/api/agent',pending.body,sa)).json(),pending.result);
  const safeHistory=await(await call('/app/api/agent',null,sa)).json();assert.equal(JSON.stringify(safeHistory).includes(code),false);assert.equal(safeHistory.messages.filter(m=>m.content==='מחסנאי בחיפה').length,1);
  const done=await chat(sa,'אשר '+code);assert.equal(done.result.task.id,original.id);assert.equal(done.result.task.status,'COMPLETE');assert.equal(done.result.externalActionsExecuted,true);assert.equal(writes,1);assert.equal(sent.length,waReplies);
  assert.equal((await require('../taskAgent').current(b.id)),null);assert.doesNotMatch(JSON.stringify(await(await call('/app/api/agent',null,sb)).json()),/מחסנאי בחיפה/);
  const id=await require('../mediaStore').saveMedia(a.id,{mediaId:'fixture-image',type:'image',mimeType:'image/png',caption:'fixture'});media.receiveWhatsAppMedia=async()=>({buffer:Buffer.from('fixture-image'),mimeType:'image/png'});
  assert.equal((await call('/app/api/agent/media/'+id,null,sa)).status,200);assert.notEqual((await call('/app/api/agent/media/'+id,null,sb)).status,200);
  const handover=await chat(sa,'נציג בבקשה');assert.match(handover.result.reply,/מענה אנושי/);assert.equal((await require('../humanSupport').current(a.id)).bot_paused,true);const beforePause=calls;await chat(sa,'תיצור קמפיין');assert.equal(calls,beforePause);
  const resumed=await chat(sa,'המשך עם הבוט');assert.match(resumed.result.reply,/חודש/);
  const controls=await(await call('/app/api/agent',null,sa)).json();assert.ok(controls.messages.some(m=>m.content==='נציג בבקשה'));
 }finally{axios.get=before.get;axios.post=before.post;wa.safeSend=before.send;voice.transcribeVoiceMessage=before.voice;media.receiveWhatsAppMedia=before.media;delete require.cache[require.resolve('../messageHandler')];await new Promise(resolve=>server.close(resolve));if(h.native)await h.db.query('DELETE FROM clients WHERE id=ANY($1::bigint[])',[[a.id,b.id]]);await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
