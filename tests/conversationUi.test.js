'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const ui=require('../conversationUi'),journey=require('../campaignJourney'),store=require('../marketingStore'),facts=require('../conversationFacts');
const {openDatabase}=require('./helpers/database');
test('budget choices show three explicit daily amounts and no invented result forecast',()=>{
 const p=store.emptyProfile();journey.init(p);p.journey.stage='DISCOVERY';p.journey.pendingField='dailyBudget';
 const reply=journey.advance(p); // A partial profile still starts from the first actual missing fact.
 assert.ok(reply.handled);
 const items=ui.choices({...p,journey:{...p.journey,pendingField:'dailyBudget'}},'dailyBudget');
 assert.deepEqual(items.slice(0,3).map(x=>x.text),['50 שקל ביום','100 שקל ביום','200 שקל ביום']);
 const body=require('../budgetGuidance').explain();assert.match(body,/350/);assert.match(body,/700/);assert.match(body,/1,400/);assert.match(body,/אי אפשר להעריך באמינות/);
 assert.equal(ui.payload(body,items,'a'.repeat(24)).interactive.type,'list');
 assert.throws(()=>ui.payload('x'.repeat(1025),items,'a'.repeat(24)),/INVALID/);
});
test('interactive controls do not replace open questions, creative outputs or exact approvals',()=>{
 const p=store.emptyProfile();journey.init(p);p.journey.pendingField='businessType';p.journey.stage='DISCOVERY';
 assert.deepEqual(ui.choices(p,null),[]);
 assert.deepEqual(ui.choices(p,null),[]);
 p.journey.stage='PLAN_REVIEW';p.journey.pendingField=null;assert.deepEqual(ui.choices(p,null),[]);
});
test('buttons are tenant-bound, context-bound, single-use and pass through the existing WhatsApp router',async()=>{
 const h=await openDatabase(),env={...process.env};const whatsapp=require('../whatsapp'),send=whatsapp.safeSend,outputs=[];
 whatsapp.safeSend=async(to,text,options)=>outputs.push({to,text,options});delete require.cache[require.resolve('../messageHandler')];
 Object.assign(process.env,{AUTHORIZED_PHONE_NUMBERS:'972501006111,972501006222',MARKETING_DISCOVERY_ENABLED:'true',WHATSAPP_SEND_ENABLED:'false'});
 try{
  const voice=require('../voiceHandler'),originalVoice=voice.transcribeVoiceMessage;
  voice.transcribeVoiceMessage=async()=> 'היי';
  delete require.cache[require.resolve('../messageHandler')];
  const handler=require('../messageHandler').handleIncomingMessage;
  voice.transcribeVoiceMessage=originalVoice;
  const message=(from,id,extra)=>({from,id,timestamp:String(Math.floor(Date.now()/1000)),...extra});
  await handler(message('972501006111','greet',{type:'audio',audio:{id:'mock-audio'}}));
  assert.match(outputs.at(-1).text,/שמעתי/);
  assert.equal(outputs.at(-1).options.interactivePayload.interactive.type,'button');
  const first=outputs.at(-1).options.interactivePayload.interactive.action.buttons[0].reply.id;
  const click=id=>({type:'interactive',interactive:{type:'button_reply',button_reply:{id,title:'אשר 123456'}}});
  await handler(message('972501006222','cross',click(first)));assert.match(outputs.at(-1).text,/לא עדכנית/);
  await handler(message('972501006111','select',click(first)));assert.match(outputs.at(-1).text,/מה העסק עושה/);
  await handler(message('972501006111','repeat',click(first)));assert.match(outputs.at(-1).text,/לא עדכנית/);
  const a=await require('../clientStore').getOrCreateClient('972501006111');
  await store.update(a.id,null,p=>{for(const [field,value]of Object.entries({businessType:'פרגולות',businessGoal:'מכירות',product:'התקנת פרגולות',audience:'בעלי בתים',geography:'נתניה',advantage:'שירות אישי'}))facts.write(p,field,value);p.journey.pendingField='dailyBudget';return{handled:false,changed:true};});
  await handler(message(a.phone,'next',{type:'text',text:{body:'להמשיך'}}));
  const budget=outputs.at(-1).options.interactivePayload;assert.equal(budget.interactive.type,'list');
  const selected=budget.interactive.action.sections[0].rows[1].id;
  await handler(message(a.phone,'budget',{type:'interactive',interactive:{type:'list_reply',list_reply:{id:selected,title:'99999 שקל ביום'}}}));
  assert.deepEqual(facts.value(await store.load(a.id),'dailyBudget'),{amount:100,currency:'ILS',period:'day'});
  assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM approvals')).rows[0].n,0);
  const fresh=await ui.prepare(a.id,journey.QUESTIONS.leadDestination,'leadDestination');const stale=fresh.interactivePayload.interactive.action.sections[0].rows[0].id;
  await store.update(a.id,null,p=>{p.journey.pendingField='audience';return{handled:false,changed:true};});
  assert.equal(await ui.consume(a.id,click(stale)),null);
  const delivery=require('../whatsappDelivery'),meta=require('../metaConnection');
  const queue=async(eventId)=>meta.context.run(String(a.id),()=>delivery.messageContext.run({eventId,sequence:0},()=>whatsapp.sendWhatsAppMessage(a.phone,'בחירה',{interactivePayload:budget})));
  process.env.WHATSAPP_SEND_ENABLED='true';let transports=0;
  await h.db.query("UPDATE whatsapp_contacts SET last_inbound_at=NOW()-INTERVAL '25 hours' WHERE phone=$1",[a.phone]);
  await queue('expired-interactive');assert.equal((await delivery.runOne({transport:async()=>{transports++;}})).status,'BLOCKED');assert.equal(transports,0);
  await delivery.recordInbound({from:a.phone,timestamp:String(Math.floor(Date.now()/1000))});await queue('valid-interactive');
  assert.equal((await delivery.runOne({transport:async(_to,payload)=>{transports++;assert.equal(payload.type,'interactive');return{messages:[{id:'mock-interactive-send'}]};}})).status,'SENT');assert.equal(transports,1);
  const b=await require('../clientStore').getOrCreateClient('972501006222');assert.equal(facts.value((await store.load(b.id))||store.emptyProfile(),'dailyBudget'),null);
 }finally{whatsapp.safeSend=send;delete require.cache[require.resolve('../messageHandler')];for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);await h.close();}
});

