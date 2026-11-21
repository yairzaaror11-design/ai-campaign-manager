'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const registry=require('../botCapabilities'),gemini=require('../gemini');
test('one registry exposes exactly the read tools available to the task planner and makes no false publication/import claims',()=>{
 const names=gemini.functionDeclarations.map(x=>x.name).filter(x=>x!=='propose_action');
 assert.deepEqual([...registry.READ_TOOLS].sort(),names.sort());
 assert.equal(new Set(names).size,names.length);
 assert.deepEqual(require('../taskPlanner').READ_TOOLS,registry.READ_TOOLS);
 assert.equal(registry.describe().leadImport.availableViaChat,false);
 assert.equal(registry.describe().landingPages.publishViaChat,false);
 assert.equal(registry.describe().verifiedLive,false);
});
test('WhatsApp can use knowledge, question answers, diagnosis and private landing drafts through repeated model plans without executing injected steps',async()=>{
 const env={...process.env},h=await require('./helpers/database').openDatabase(),wa=require('../whatsapp'),reports=require('../reportService');
 const before={send:wa.safeSend,diagnosis:reports.campaignDiagnosis};const sent=[];let diagnoses=0;
 Object.assign(process.env,{UNIFIED_CONVERSATION_ENABLED:'true',TASK_AGENT_ENABLED:'true',TASK_AGENT_REQUIRE_EVAL:'false',TASK_AGENT_PILOT_ONLY:'true',AUTHORIZED_PHONE_NUMBERS:'972500066115',AI_PROVIDER:'capability_fixture',WHATSAPP_SEND_ENABLED:'false',PUBLIC_ONBOARDING_ENABLED:'false'});
 wa.safeSend=async(_to,text)=>sent.push(text);
 const client=(await h.db.query("INSERT INTO clients(phone) VALUES('972500066115') RETURNING *")).rows[0];
 const other=(await h.db.query("INSERT INTO clients(phone) VALUES('972500066116') RETURNING *")).rows[0];
 await require('../landingDrafts').save(other.id,{requestId:crypto.randomUUID(),payload:{businessName:'Private other business',title:'Other private page',body:'Do not disclose',cta:'Contact',product:''}});
 reports.campaignDiagnosis=async(id,preset)=>{assert.equal(String(id),String(client.id));assert.equal(preset,'last_7d');diagnoses++;return require('../marketingBrain').analyze({account:{id:'act_11',currency:'ILS'},preset,campaigns:[{campaign_id:'1',spend:'100',clicks:'10',impressions:'1000',actions:[{action_type:'lead',value:'4'}]}]});};
 const qid=require('../data/marketing-questions.he.json').questions[0].id;
 const reads=[['knowledge','get_meta_ads_knowledge',{limit:1}],['questions','get_marketing_questions',{limit:2}],['answers','get_marketing_answers',{ids:[qid]}],['diagnosis','get_marketing_diagnosis',{date_preset:'last_7d'}],['pages','get_landing_drafts',{}]];
 const plan=[...reads.map(([id])=>({id,label:id,kind:'read',dependsOn:[]})),{id:'page',label:'טיוטת דף נחיתה',kind:'draft',dependsOn:reads.map(([id])=>id)}];
 const payload={businessName:'עסק בדיקה',title:'שירות בהתאמה אישית',body:'אפשר להשאיר פרטים ולבדוק התאמה.',cta:'השאירו פרטים',product:'שירות'};
 require('../aiService').registerProvider('capability_fixture',async raw=>{
  const c=JSON.parse(raw),s=id=>c.plan.find(x=>x.id===id);let next;
  const pending=reads.find(([id])=>s(id)?.status!=='DONE');
  if(pending)next={op:'read',stepId:pending[0],tool:pending[1],args:pending[2]};
  else if(s('page').status==='PENDING')next={op:'draft',stepId:'page',title:'טיוטת דף נחיתה',destination:'landing_page',content:JSON.stringify(payload)};
  else if(s('page').status==='PREPARED')next={op:'review'};
  else next={op:'finish'};
  return{text:JSON.stringify({plan:c.plan.length?[{id:'injected',label:'must not run',kind:'meta',intent:'CREATE_BUNDLE',dependsOn:[]}]:plan,next}),actionPlans:[]};
 });
 delete require.cache[require.resolve('../messageHandler')];
 const handler=require('../messageHandler').handleIncomingMessage;
 const send=(id,body)=>handler({id,from:client.phone,type:'text',text:{body},timestamp:String(Math.floor(Date.now()/1000))});
 try{
  await send('capabilities-1','תכין לי דף נחיתה על בסיס הידע והדוח');
  const task=await require('../taskAgent').current(client.id);
  assert.equal(task.status,'WAITING_REVIEW',JSON.stringify({error:task.state.lastError,reply:sent.at(-1)}));
  assert.equal(task.state.steps.length,plan.length);assert.equal(task.state.steps.some(s=>s.id==='injected'),false);
  assert.equal(task.state.steps[0].result.length,1);assert.equal(task.state.steps[1].result.length,2);assert.equal(task.state.steps[2].result[0].id,qid);
  assert.equal(task.state.steps[3].result.totals.leads,4);assert.equal(diagnoses,1);assert.deepEqual(task.state.steps[4].result.pages,[]);
  assert.equal((await h.db.query('SELECT id FROM landing_pages WHERE client_id=$1',[client.id])).rows.length,0);
  assert.doesNotMatch(sent.at(-1),/must not run|Private other business|Do not disclose/);
  await send('capabilities-2','מאשר את החבילה');
  const done=await require('../taskAgent').current(client.id);assert.equal(done.status,'COMPLETE',done.state.lastError);assert.match(sent.at(-1),/נשמרה בדשבורד שלך ולא פורסמה/);
  const pages=(await h.db.query('SELECT payload,status,published_at FROM landing_pages WHERE client_id=$1',[client.id])).rows;
  assert.equal(pages.length,1);assert.equal(pages[0].status,'DRAFT');assert.equal(pages[0].published_at,null);assert.equal(pages[0].payload.title,payload.title);
  await send('capabilities-2','מאשר את החבילה');assert.equal((await h.db.query('SELECT id FROM landing_pages WHERE client_id=$1',[client.id])).rows.length,1);
  assert.equal((await h.db.query('SELECT id FROM action_plans')).rows.length,0);assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM meta_execution_attempts')).rows[0].n,0);
  await assert.rejects(require('../landingDrafts').save(client.id,{requestId:crypto.randomUUID(),payload,taskBinding:{taskId:done.id,stepId:'page',lease:crypto.randomUUID(),artifactHash:done.state.steps.at(-1).artifact.hash}}),/TASK_DRAFT_CHANGED/);
 }finally{wa.safeSend=before.send;reports.campaignDiagnosis=before.diagnosis;delete require.cache[require.resolve('../messageHandler')];await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
