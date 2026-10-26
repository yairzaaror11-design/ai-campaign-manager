'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {openDatabase}=require('./helpers/database');
test('media receipt is short, proposes actions separately and never leaks validation details',async()=>{
 const h=await openDatabase(),env={...process.env};
 const whatsapp=require('../whatsapp'),media=require('../mediaHandler'),graphics=require('../graphicService');
 const before={send:whatsapp.safeSend,receive:media.receiveWhatsAppMedia,create:graphics.createGraphic};const sent=[];
 whatsapp.safeSend=async(to,text,options)=>sent.push({to,text,options});
 media.receiveWhatsAppMedia=async message=>({type:message.type,mediaId:'test-wa-media',mimeType:message.type==='image'?'image/png':'video/mp4',caption:'',buffer:Buffer.from('reference'),fileSize:9});
 delete require.cache[require.resolve('../messageHandler')];
 Object.assign(process.env,{AUTHORIZED_PHONE_NUMBERS:'972501008111',MARKETING_DISCOVERY_ENABLED:'true',WHATSAPP_SEND_ENABLED:'false'});
 const from='972501008111',handler=require('../messageHandler').handleIncomingMessage;
 const send=(id,extra)=>handler({id,from,timestamp:String(Math.floor(Date.now()/1000)),...extra});
 try{
  await send('video',{type:'video',video:{id:'123'}});
  assert.equal(sent.length,2);assert.equal(sent[0].text,'קיבלתי את הסרטון.');assert.equal(sent[1].text,'מה נעשה עם הסרטון?');
  assert.equal(sent[1].options.interactivePayload.interactive.action.buttons.length,3);
  assert.doesNotMatch(JSON.stringify(sent),/בדיקת סוג|גודל|מזהה מדיה|עיון בלבד|לא פורסם|CREATE_BUNDLE/);
  const old=sent[1].options.interactivePayload.interactive.action.buttons[0].reply.id;
  await send('image',{type:'image',image:{id:'456'}});assert.equal(sent.length,4);assert.match(sent[3].text,/מה נעשה עם התמונה/);assert.match(sent[3].text,/אישור נפרד/);
  const client=await require('../clientStore').getOrCreateClient(from),ui=require('../conversationUi');
  assert.equal(await ui.consume(client.id,{interactive:{type:'button_reply',button_reply:{id:old}}}),null);
  const button=sent[3].options.interactivePayload.interactive.action.buttons[0].reply.id;
  await send('copy',{type:'interactive',interactive:{type:'button_reply',button_reply:{id:button,title:'פרסם עכשיו'}}});assert.match(sent.at(-1).text,/מה העסק עושה/);
  let generated=0,referenceInputs=[];
  graphics.createGraphic=async(_client,prompt,options)=>{generated++;referenceInputs.push(options.referenceImage);return{id:'test',whatsapp_media_id:String(generated)};};
  // The batch passes the actual tenant-owned source image to each generated variant.
  const results=[];await require('../metaConnection').context.run(String(client.id),()=>require('../whatsappDelivery').messageContext.run({eventId:'variants',sequence:0},()=>graphics.createVariants(client.id,graphics.graphicRequest('תיצור לי 3 תמונות של הצמיד ששלחתי'),(asset,index)=>results.push({asset,index}))));
  assert.equal(generated,3);assert.equal(results.length,3);assert.ok(referenceInputs.every(x=>x.type==='image'&&x.buffer.toString()==='reference'));
  graphics.createGraphic=async(_client,prompt,options)=>{
    assert.ok(options.referenceImage);const id=await require('../mediaStore').saveMedia(_client,{mediaId:'123456',type:'image',mimeType:'image/png',caption:prompt});
    return{id,whatsapp_media_id:'123456'};
  };
  await send('native-variants',{type:'text',text:{body:'תיצור לי 3 תמונות של הצמיד ששלחתי ותכין אותם לפרסום בעלות של 220 שח'}});
  assert.match(sent.at(-1).text,/ליום, לכל הקמפיין או מחיר המוצר/);
  const store=require('../marketingStore'),facts=require('../conversationFacts');
  assert.equal(facts.value(await store.load(client.id),'dailyBudget'),null);
  assert.equal((await h.db.query("SELECT COUNT(*)::int AS n FROM whatsapp_outbox WHERE payload->>'type'='image'")).rows[0].n,3);
  const budgetButton=sent.at(-1).options.interactivePayload.interactive.action.buttons[1].reply.id;
  await send('budget-period',{type:'interactive',interactive:{type:'button_reply',button_reply:{id:budgetButton}}});assert.match(sent.at(-1).text,/לכמה ימים/);
  await send('duration',{type:'text',text:{body:'7 ימים'}});assert.equal((await store.load(client.id)).mediaBudgetPlan.total,220);
  assert.equal(facts.value(await store.load(client.id),'dailyBudget'),null);
  const variantButton=sent.at(-1).options.interactivePayload.interactive.action.buttons[0].reply.id;
  await send('select-variant',{type:'interactive',interactive:{type:'button_reply',button_reply:{id:variantButton}}});
  const selected=await store.load(client.id);assert.equal(selected.mediaVariants,undefined);assert.equal(selected.mediaContext.type,'image');
  assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM approvals')).rows[0].n,0);
 }finally{whatsapp.safeSend=before.send;media.receiveWhatsAppMedia=before.receive;graphics.createGraphic=before.create;delete require.cache[require.resolve('../messageHandler')];for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);await h.close();}
});
test('the screenshots business message saves facts without asking for technical IDs',()=>{
 const p=require('../marketingStore').emptyProfile(),transition=require('../marketingConversation').transition,facts=require('../conversationFacts');
 assert.match(transition(p,'למה אתה בנוי?').reply,/תמונות ומודעות/);
 transition(p,'אני רוצה להעלות קמפיין של העסק שלי לפייסבוק');
 const r=transition(p,'העסק מוכר תכשיטים מיוחדים מחרוזים של אבני חן.\nמטרת הקמפיין היא מכירות באתר וקבלת פניות לעיצובים אישיים וגם הגדלת חשיפה לעסק.\nהתקציב היומי הוא 100 שח.\nקהל היעד שלי הוא נוער ועד גיל 60.');
 assert.match(facts.value(p,'businessType'),/תכשיטים/);assert.match(facts.value(p,'audience'),/גיל 60/);
 assert.equal(facts.value(p,'dailyBudget').amount,100);assert.equal(facts.value(p,'businessGoal'),'מכירות');
 assert.equal((r.reply.match(/\?/g)||[]).length,1);assert.doesNotMatch(r.reply,/CREATE_BUNDLE|Pixel|Page ID|מזהה דף/);
});
test('plural image requests are recognized, bounded and distinguish reference edits',()=>{
 const g=require('../graphicService');const r=g.graphicRequest('תיצור לי 3 תמונות של הצמיד ששלחתי ותכין אותם לפרסום בעלות של 220 שח');
 assert.equal(r.count,3);assert.equal(r.usesReference,true);assert.equal(r.ambiguousBudget,220);assert.doesNotMatch(r.prompt,/220/);assert.equal(g.graphicRequest('תיצור לי שלוש תמונות לפרסום').count,3);
 assert.equal(g.graphicRequest('תיצור לי 20 תמונות').count,20);assert.equal(g.graphicRequest('אני רוצה לפרסם'),null);
});
test('image generation sends the actual reference image in the provider request',async()=>{
 const axios=require('axios'),post=axios.post,env={...process.env};let body;
 Object.assign(process.env,{GEMINI_API_KEY:'mock-key',GEMINI_IMAGE_MODEL:'gemini-test-image'});
 const image=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(20)]);
 axios.post=async(_url,input)=>{body=input;return{data:{candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:image.toString('base64')}}]}}]}};};
 try{
  const reference={buffer:Buffer.from('original-product-bytes'),mimeType:'image/jpeg'};
  await require('../graphicService').generate('keep the bracelet',{referenceImage:reference});
  assert.equal(body.contents[0].parts[1].inlineData.data,reference.buffer.toString('base64'));
  assert.equal(body.contents[0].parts[1].inlineData.mimeType,'image/jpeg');
  assert.match(body.contents[0].parts[0].text,/preserve its actual product/);
 }finally{axios.post=post;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
