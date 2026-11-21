'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('WhatsApp skill diagnostics stay available during a model outage without replacing or advancing the active task',async()=>{
 const env={...process.env},h=await require('./helpers/isolatedDatabase').openDatabase();
 const status=require('../skillStatus'),evaluation=require('../taskEvaluation'),oldStatus=evaluation.status,oldReady=evaluation.ready;
 const declarations=require('../gemini').functionDeclarations;
 let client;
 Object.assign(process.env,{UNIFIED_CONVERSATION_ENABLED:'true',TASK_AGENT_ENABLED:'true',TASK_AGENT_REQUIRE_EVAL:'true',TASK_AGENT_PILOT_ONLY:'true',AUTHORIZED_PHONE_NUMBERS:'972500077881',WHATSAPP_SEND_ENABLED:'false',READ_ONLY:'true',META_WRITES_ENABLED:'false'});
 evaluation.status=()=>({status:'FAILED'});evaluation.ready=()=>false;
 try{
  client=await require('../clientStore').getOrCreateClient('972500077881');
  const tasks=require('../taskAgent'),controller=require('../conversationController');
  await require('../metaConnection').context.run(client.id,()=>tasks.send(client.id,{message:'תכין מודעה לבית קפה',requestId:'skill-original',channel:'WHATSAPP'},{deferPlanning:true}));
  const before=await tasks.current(client.id);
  assert.equal(status.check().ok,true);assert.equal(status.check().guides,16);
  assert.equal(status.requested('מה מצב הסקילים?'),true);assert.equal(status.requested('/skills-check'),true);
  assert.equal(status.requested('תכין מודעה על בדיקת סקילים לעסק'),false);
  const response=await controller.handle(client.id,{message:'בדיקת סקילים',requestId:'skill-check',channel:'WHATSAPP'});
  assert.equal(response.externalActionsExecuted,false);assert.match(response.reply,/16 מדריכי שיווק/);assert.match(response.reply,/טרם עברה/);assert.match(response.reply,/טרם מחוברים/);assert.match(response.reply,/אינה מאמתת הרשאות/);
  assert.deepEqual(await tasks.current(client.id),before);
  assert.equal((await h.db.query('SELECT id FROM action_plans WHERE client_id=$1',[client.id])).rows.length,0);
  const index=declarations.findIndex(d=>d.name==='get_professional_skills'),[removed]=declarations.splice(index,1);
  try{
   assert.deepEqual(status.check().missing,['get_professional_skills']);
   const blocked=await controller.handle(client.id,{message:'המשך במשימה',requestId:'skill-blocked',channel:'WHATSAPP'});
   assert.match(blocked.reply,/בדיקת החיבור של היכולות נכשלה/);assert.deepEqual(await tasks.current(client.id),before);
  }finally{declarations.splice(index,0,removed);}
  const outsider=await require('../clientStore').getOrCreateClient('972500077882');
  try{assert.equal(await controller.handle(outsider.id,{message:'/skills',requestId:'foreign',channel:'WHATSAPP'}),null);}finally{await h.db.query('DELETE FROM clients WHERE id=$1',[outsider.id]);}
 }finally{
  evaluation.status=oldStatus;evaluation.ready=oldReady;
  if(client)await h.db.query('DELETE FROM clients WHERE id=$1',[client.id]);await h.close();
  for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);
 }
});
