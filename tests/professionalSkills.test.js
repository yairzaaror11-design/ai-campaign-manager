'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const skills=require('../professionalSkills'),registry=require('../botCapabilities');
test('all sixteen documented engines are discoverable as explicitly partial advice with source versions and no automatic external authority',()=>{
 assert.equal(skills.SKILLS.length,16);assert.equal(new Set(skills.SKILLS.map(s=>s.id)).size,16);
 for(let n=1;n<=16;n++){
  const id='MKT-'+String(n).padStart(2,'0'),r=skills.catalog({id});assert.equal(r.skills[0].id,id);assert.equal(r.skills[0].status,'PARTIAL');assert.equal(r.skills[0].automaticExternalActions,false);assert.ok(r.skills[0].checks.length);assert.ok(r.skills[0].cautions.length);assert.match(r.source,/specification 04/);assert.equal(JSON.stringify(r).includes('docs.google.com'),false);
  for(const op of r.skills[0].calculators)assert.ok(require('../businessCase').OPS[op]);
 }
 assert.equal(skills.catalog().skills.length,16);assert.throws(()=>skills.catalog({id:'RUN_ANYTHING'}),/INVALID/);
 assert.equal(registry.describe().professionalSkills.crmConnected,false);assert.equal(registry.describe().professionalSkills.billingEnabledByThisFeature,false);
 const declared=require('../gemini').functionDeclarations.map(t=>t.name).filter(n=>n!=='propose_action');assert.deepEqual([...registry.READ_TOOLS].sort(),declared.sort());
 assert.ok(JSON.stringify(skills.catalog()).length<4000);
});
test('WhatsApp professional analysis uses current-task evidence and deterministic output, with no bundle review or financial action',async()=>{
 const env={...process.env},h=await require('./helpers/database').openDatabase(),wa=require('../whatsapp'),old=wa.safeSend,sent=[];
 Object.assign(process.env,{UNIFIED_CONVERSATION_ENABLED:'true',TASK_AGENT_ENABLED:'true',TASK_AGENT_REQUIRE_EVAL:'false',TASK_AGENT_PILOT_ONLY:'true',AUTHORIZED_PHONE_NUMBERS:'972500066117',AI_PROVIDER:'professional_fixture',WHATSAPP_SEND_ENABLED:'false',PUBLIC_ONBOARDING_ENABLED:'false'});
 wa.safeSend=async(_to,text)=>sent.push(text);
 const source='תבדוק את הכדאיות: הוצאה קודמת 3000 ₪ עם 5 לקוחות, הוצאה חדשה 6000 ₪ עם 8 לקוחות, הנחת הכנסה לחיי לקוח אחרי עלויות 687.50 ₪.';
 const plan=[{id:'guide',label:'בדיקת כללי הרחבה',kind:'read',dependsOn:[]},{id:'economics',label:'חישוב כלכלה שולית',kind:'read',dependsOn:['guide']}];
 const values={oldAdSpend:'3000',newAdSpend:'6000',oldNewCustomers:'5',newNewCustomers:'8',expectedIncomePerCustomer:'687.50'};
 require('../aiService').registerProvider('professional_fixture',async raw=>{
  const c=JSON.parse(raw);let next;
  if(c.request==='חשב תפוסה'){
   const last=c.messages.at(-1).content,fields=last.includes('100')?[{key:'capacity',value:'100',evidence:last},{key:'occupied',value:'99',evidence:last}]:[];
   return{text:JSON.stringify({...(!c.plan.length?{plan:[{id:'capacity',label:'קיבולת',kind:'read',dependsOn:[]}]}:{}),next:c.plan[0]?.status==='DONE'?{op:'finish'}:{op:'read',stepId:'capacity',tool:'analyze_business_case',args:{operation:'capacity',fields}}}),actionPlans:[]};
  }
  if(!c.plan.length)next={op:'read',stepId:'guide',tool:'get_professional_skills',args:{id:'MKT-06'}};
  else if(c.plan[1].status!=='DONE')next={op:'read',stepId:'economics',tool:'analyze_business_case',args:{operation:'scaling',fields:Object.entries(values).map(([key,value])=>({key,value,evidence:source})),currency:{value:'ILS',evidence:'₪'}}};
  else next={op:'finish'};
  return{text:JSON.stringify({...(!c.plan.length?{plan}:{}),next}),actionPlans:[]};
 });
 delete require.cache[require.resolve('../messageHandler')];
 try{
  await require('../messageHandler').handleIncomingMessage({id:'professional-1',from:'972500066117',type:'text',text:{body:source},timestamp:String(Math.floor(Date.now()/1000))});
  assert.match(sent.at(-1),/1000\.00/);assert.match(sent.at(-1),/-937\.50/);assert.match(sent.at(-1),/אינה הוכחה סיבתית/);assert.doesNotMatch(sent.at(-1),/מאשר את החבילה|קוד אישור|הקמפיין הופעל/);
  const client=(await h.db.query("SELECT id FROM clients WHERE phone='972500066117'")).rows[0];
  const task=await require('../taskAgent').current(client.id);assert.equal(task.status,'COMPLETE');assert.equal(task.state.steps[1].result.metrics.marginalCac.value,'1000.00');assert.equal(task.state.steps[1].result.source,'OWNER_REPORTED_NOT_VERIFIED');
  assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM action_plans')).rows[0].n,0);assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM approvals')).rows[0].n,0);
  await require('../messageHandler').handleIncomingMessage({id:'professional-missing',from:'972500066117',type:'text',text:{body:'חשב תפוסה'},timestamp:String(Math.floor(Date.now()/1000))});
  const waiting=await require('../taskAgent').current(client.id);assert.equal(waiting.status,'WAITING_INPUT');assert.match(sent.at(-1),/קיבולת/);
  await require('../messageHandler').handleIncomingMessage({id:'professional-capacity',from:'972500066117',type:'text',text:{body:'קיבולת 100 ותפוסה 99'},timestamp:String(Math.floor(Date.now()/1000))});
  assert.equal((await require('../taskAgent').current(client.id)).id,waiting.id);assert.equal((await require('../taskAgent').current(client.id)).status,'COMPLETE');assert.match(sent.at(-1),/נותרו 1 מקומות/);
  process.env.AUTHORIZED_PHONE_NUMBERS+=',972500066118';
  await require('../messageHandler').handleIncomingMessage({id:'professional-other',from:'972500066118',type:'text',text:{body:'תבדוק את העסק שלי'},timestamp:String(Math.floor(Date.now()/1000))});
  const other=(await h.db.query("SELECT id FROM clients WHERE phone='972500066118'")).rows[0];
  assert.equal((await require('../taskAgent').current(other.id)).state.lastError,'BUSINESS_EVIDENCE_REQUIRED');assert.doesNotMatch(sent.at(-1),/1000|937|687/);
  await assert.rejects(require('../gemini').runTool('analyze_business_case',{operation:'capacity',fields:[]}),/CONTEXT_REQUIRED/);
 }finally{wa.safeSend=old;delete require.cache[require.resolve('../messageHandler')];await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
