'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {openDatabase}=require('./helpers/database');
test('WhatsApp routes a natural task to the manager, preserves progress through a pause and accepts feedback before review',async()=>{
 const env={...process.env},h=await openDatabase(),whatsapp=require('../whatsapp'),before=whatsapp.safeSend,sent=[];
 whatsapp.safeSend=async(_to,text)=>sent.push(text);delete require.cache[require.resolve('../messageHandler')];
 Object.assign(process.env,{TASK_AGENT_ENABLED:'true',AI_PROVIDER:'task_bot_fixture',AUTHORIZED_PHONE_NUMBERS:'972500066111',PUBLIC_ONBOARDING_ENABLED:'false',MARKETING_DISCOVERY_ENABLED:'true',WHATSAPP_SEND_ENABLED:'false'});
 let decisions=0;
 require('../aiService').registerProvider('task_bot_fixture',async(raw,_history,options)=>{
  assert.equal(options.taskPlanning,true);assert.equal(options.planningOnly,true);decisions++;
  const c=JSON.parse(raw),by=id=>c.plan.find(s=>s.id===id);let decision;
  if(!c.plan.length)decision={plan:[{id:'details',label:'פרטי המשרה',kind:'collect',dependsOn:[]},{id:'copy',label:'מודעת דרושים',kind:'draft',dependsOn:['details']}],next:{op:'ask',stepId:'details',question:'לאיזו משרה ובאיזה אזור מגייסים?'}};
  else if(by('details').status!=='DONE')decision={next:{op:'collect',stepId:'details',facts:[{key:'role',value:'מחסנאי בחיפה',evidence:'מחסנאי בחיפה'}]}};
  else if(by('copy').status==='PENDING')decision={next:{op:'draft',stepId:'copy',title:'מודעה למשרה',content:'דרושים למחסן בחיפה. לפרטים ולהגשת מועמדות השאירו פרטים.'}};
  else if(by('copy').status==='PREPARED'&&c.messages.at(-1).content==='קצר את הנוסח'&&by('copy').artifact.content.length>50)decision={next:{op:'draft',stepId:'copy',title:'מודעה למשרה',content:'דרושים למחסן בחיפה. הגישו מועמדות.'}};
  else if(by('copy').status==='PREPARED')decision={next:{op:'review'}};
  else decision={next:{op:'finish'}};
  return{text:JSON.stringify(decision),actionPlans:[]};
 });
 const handler=require('../messageHandler').handleIncomingMessage,phone='972500066111';
 const send=(id,body)=>handler({id,from:phone,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body}});
 try{
  await send('bot-1','תכין לי מודעת דרושים');assert.match(sent.at(-1),/לאיזו משרה/);assert.doesNotMatch(sent.at(-1),/מה העסק עושה/);
  await send('bot-2','מחסנאי בחיפה');assert.match(sent.at(-1),/דרושים למחסן בחיפה/);assert.match(sent.at(-1),/מאשר את התוכן/);assert.doesNotMatch(sent.at(-1),/חבילה/);
  const c=await require('../clientStore').getOrCreateClient(phone),first=await require('../taskAgent').current(c.id);
  await send('bot-3','עצור');assert.match(sent.at(-1),/עצרתי/);const n=decisions;
  await send('bot-4','שלום');assert.equal(decisions,n);assert.match(sent.at(-1),/עצרתי/);
  await send('bot-5','המשך במשימה');assert.match(sent.at(-1),/מאשר את התוכן/);
  await send('bot-6','קצר את הנוסח');assert.match(sent.at(-1),/דרושים למחסן בחיפה\. הגישו/);
  const revised=await require('../taskAgent').current(c.id);assert.equal(revised.id,first.id);assert.notEqual(revised.state.steps[1].artifact.hash,first.state.steps[1].artifact.hash);
  await send('bot-7','מאשר את התוכן');assert.match(sent.at(-1),/לא בוצעה פעולה חיצונית/);assert.equal((await require('../taskAgent').current(c.id)).status,'COMPLETE');
  assert.equal((await h.db.query('SELECT id FROM crm_leads WHERE client_id=$1',[c.id])).rows.length,0);
 }finally{whatsapp.safeSend=before;delete require.cache[require.resolve('../messageHandler')];await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
