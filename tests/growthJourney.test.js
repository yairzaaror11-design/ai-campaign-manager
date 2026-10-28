'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const analysis=require('../conversationAnalysis'),store=require('../marketingStore');
const facts=require('../conversationFacts'),marketing=require('../marketingConversation');

for(const [message,goal] of [
 ['אני רוצה עוד לקוחות','לקוחות חדשים'],
 ['אני צריכה יותר פניות','פניות מתאימות'],
 ['אנחנו רוצים להביא יותר לקוחות','לקוחות חדשים'],
 ['אני צריך יותר לידים','פניות מתאימות'],
 ['אנחנו רוצות יותר מכירות','מכירות']
])test('a business growth request starts discovery: '+message,()=>{
 const p=store.emptyProfile(),result=marketing.transition(p,message);
 assert.equal(analysis.localAnalysis(message).intent,'build');
 assert.equal(facts.value(p,'businessGoal'),goal);
 assert.equal(p.journey.stage,'DISCOVERY');
 assert.equal(p.journey.pendingField,'businessType');
 assert.match(result.reply,/מה העסק עושה/);
 assert.equal(p.journey.draft,null);
});

test('questions, hypotheticals and negations do not start a growth campaign',()=>{
 for(const text of ['איך משיגים עוד לקוחות?','מה אם אני רוצה עוד לקוחות?','אני לא רוצה עוד לקוחות','אני רוצה עוד לקוחות?']){
  assert.notEqual(analysis.localAnalysis(text).intent,'build',text);
 }
});

test('growth requests progress through WhatsApp text, voice and authenticated portal without a live AI or Meta call',async t=>{
 const h=await require('./helpers/database').openDatabase(),env={...process.env};
 const ai=require('../aiService'),whatsapp=require('../whatsapp'),voice=require('../voiceHandler');
 const send=whatsapp.safeSend,transcribe=voice.transcribeVoiceMessage;
 const sent=[];let providerCalls=0,server;
 Object.assign(process.env,{APP_PUBLIC_URL:'https://campaign.example',AUTHORIZED_PHONE_NUMBERS:'972501008111,972501008222',AI_PROVIDER:'growth_offline_test',READ_ONLY:'true',META_WRITES_ENABLED:'false',WHATSAPP_SEND_ENABLED:'false',GRAPHICS_ENABLED:'false',BUSINESS_LINK_ONBOARDING_ENABLED:'false'});
 ai.registerProvider('growth_offline_test',async()=>{providerCalls++;throw Error('PROVIDER_UNAVAILABLE');});
 whatsapp.safeSend=async(phone,text)=>sent.push({phone,text});
 voice.transcribeVoiceMessage=async()=>'אני רוצה עוד לקוחות';
 delete require.cache[require.resolve('../messageHandler')];
 try{
  const handler=require('../messageHandler').handleIncomingMessage;
  const clients=require('../clientStore');
  const textMessage=(phone,id,body)=>({id,from:phone,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body}});
  await t.test('text starts with the stated goal and asks only for missing business details',async()=>{
   await handler(textMessage('972501008111','growth-text','אני רוצה עוד לקוחות'));
   assert.match(sent.at(-1).text,/מה העסק עושה/);
   const client=await clients.getOrCreateClient('972501008111');
   const p=await store.load(client.id);assert.equal(facts.value(p,'businessGoal'),'לקוחות חדשים');
   assert.equal(p.journey.pendingField,'businessType');
   await handler(textMessage('972501008111','growth-business','אני מתקין פרגולות באזור נתניה'));
   const updated=await store.load(client.id);
   assert.equal(facts.value(updated,'businessType'),'פרגולות');
   assert.equal(facts.value(updated,'geography'),'נתניה');
   assert.equal(facts.value(updated,'businessGoal'),'לקוחות חדשים');
   assert.equal(updated.journey.pendingField,'audience');
   assert.match(sent.at(-1).text,/מי הלקוחות/);
  });
  await t.test('transcribed voice follows the same route and retains the transcription in history',async()=>{
   await handler({id:'growth-voice',from:'972501008222',timestamp:String(Math.floor(Date.now()/1000)),type:'audio',audio:{id:'fixture-only'}});
   assert.match(sent.at(-1).text,/מה העסק עושה/);
   const client=await clients.getOrCreateClient('972501008222'),p=await store.load(client.id);
   assert.equal(facts.value(p,'businessGoal'),'לקוחות חדשים');assert.equal(facts.value(p,'businessType'),null);
   assert.ok((await require('../sessionStore').getHistory(client.phone)).some(m=>m.role==='user'&&m.content==='אני רוצה עוד לקוחות'));
  });
  await t.test('WhatsApp alone reaches strategy, creative and plan review without registering or opening a dashboard',async()=>{
   const phone='972501008111',client=await clients.getOrCreateClient(phone);
   const steps=[['בעלי בתים פרטיים','advantage'],['שירות אישי ומחיר נגיש','dailyBudget'],['100 שקל ביום','leadDestination']];
   let sequence=0;
   for(const [answer,pending] of steps){
    await handler(textMessage(phone,'growth-answer-'+sequence++,answer));
    assert.equal((await store.load(client.id)).journey.pendingField,pending);
   }
   await handler(textMessage(phone,'growth-destination','פניות בוואטסאפ'));
   let p=await store.load(client.id);assert.equal(p.journey.stage,'STRATEGY_REVIEW');
   assert.equal(facts.value(p,'businessGoal'),'לקוחות חדשים');
   assert.match(sent.at(-1).text,/הכיוון המוצע/);
   await handler(textMessage(phone,'growth-strategy-approval','כן'));
   assert.equal((await store.load(client.id)).journey.stage,'CREATIVE_REVIEW');
   assert.match(sent.at(-1).text,/מודעה 1/);
   await handler(textMessage(phone,'growth-creative-approval','כן'));
   p=await store.load(client.id);assert.equal(p.journey.stage,'PLAN_REVIEW');
   assert.equal(p.journey.draft.status,'LOCAL_DRAFT');assert.equal(p.journey.draft.requiresApproval,true);
   assert.deepEqual(p.journey.draft.dailyBudget,{amount:100,currency:'ILS',period:'day'});
   await handler(textMessage(phone,'growth-plan-yes','כן'));
   assert.match(sent.at(-1).text,/אינו אישור להוצאה/);
   assert.equal((await store.load(client.id)).journey.stage,'PLAN_REVIEW');
   assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM customer_accounts WHERE client_id=$1',[client.id])).rows[0].n,0);
  });
  await t.test('portal persists the reply, deduplicates retries and isolates two businesses',async()=>{
   const app=require('../index');server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
   const base='http://127.0.0.1:'+server.address().port;
   const a=await clients.getOrCreateClient('972501008333'),b=await clients.getOrCreateClient('972501008444');
   const login=async client=>{
    const token=(await require('../portalStore').createTicket(client.id)).split('#login=')[1];
    const r=await fetch(base+'/app/api/login',{method:'POST',headers:{Origin:'https://campaign.example','Content-Type':'application/json'},body:JSON.stringify({token})});assert.equal(r.status,200);
    const cookies=r.headers.getSetCookie();return{cookie:cookies.map(c=>c.split(';')[0]).join('; '),csrf:cookies.find(c=>c.startsWith('cb_csrf=')).split(';')[0].split('=')[1]};
   };
   const sa=await login(a),sb=await login(b);
   const body={message:'אני רוצה עוד לקוחות',screen:'agent',requestId:require('node:crypto').randomUUID(),clientId:b.id};
   const post=async()=>fetch(base+'/app/api/agent',{method:'POST',headers:{Cookie:sa.cookie,Origin:'https://campaign.example','Content-Type':'application/json','X-CSRF-Token':sa.csrf},body:JSON.stringify(body)});
   let response=await post();assert.equal(response.status,200);const first=await response.json();assert.match(first.reply,/מה העסק עושה/);assert.equal(first.externalActionsExecuted,false);
   response=await post();assert.equal(response.status,200);const retry=await response.json();assert.equal(retry.reply,first.reply);
   const p=await store.load(a.id);assert.equal(p.portalChat.messages.length,2);assert.equal(p.journey.pendingField,'businessType');assert.equal(facts.value(p,'businessGoal'),'לקוחות חדשים');
   const other=await fetch(base+'/app/api/agent',{headers:{Cookie:sb.cookie}});assert.deepEqual((await other.json()).messages,[]);
   assert.equal(await store.load(b.id),null);
   const denied=await fetch(base+'/app/api/agent',{method:'POST',headers:{Cookie:sa.cookie,Origin:'https://campaign.example','Content-Type':'application/json','X-CSRF-Token':'wrong'},body:JSON.stringify({...body,requestId:require('node:crypto').randomUUID()})});assert.equal(denied.status,403);
   assert.equal((await store.load(a.id)).portalChat.messages.length,2);
  });
  await t.test('growth discovery creates no approval, queue job or external campaign',async()=>{
   for(const table of ['approvals','campaign_local_drafts','workflow_jobs'])assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM '+table)).rows[0].n,0,table);
   // This exercises provider failure during later free-form answers/creative
   // drafting. The deterministic journey must still preserve the known facts.
   assert.ok(providerCalls>0);
  });
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  whatsapp.safeSend=send;voice.transcribeVoiceMessage=transcribe;delete require.cache[require.resolve('../messageHandler')];
  await h.close();for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);
 }
});
