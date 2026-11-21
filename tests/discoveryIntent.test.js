'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const request='אני רוצה להביא לקוחות חדשים לעסק דרך פייסבוק ואינסטגרם. תעזור לי לבחור מה כדאי להציע ולמי לפנות. לפני שמכינים מודעה ועיצוב, בוא נדייק יחד את הכיוון. בלי לפרסם כרגע.';
test('discovery scope forbids image and account steps even when the message mentions campaign preparation',()=>{
 const intent=require('../planningIntent'),agent=require('../taskAgent');assert.equal(intent.directionOnly(request),true);
 assert.equal(intent.directionOnly('בוא נדייק את הקהל לקמפיין לפני שמכינים מודעה'),true);
 assert.equal(intent.directionOnly('תכין לי קמפיין עם מודעה וטופס, בלי לפרסם'),false);
 assert.equal(require('../campaignPackage').required('בוא נדייק את הקהל לקמפיין לפני שמכינים מודעה'),false);
 assert.deepEqual(agent.requiredOutcomes(request),[]);
 for(const p of [{id:'image',kind:'image',label:'תמונה',dependsOn:[]},{id:'create',kind:'meta',intent:'CREATE_CAMPAIGN',label:'קמפיין',dependsOn:[]}])assert.throws(()=>agent.validatePlan([p],request),/INVALID_TASK_PLAN/);
});
test('the actual discovery message replaces a review-ready old campaign and hands only advice context to later creation',async()=>{
 const env={...process.env},h=await require('./helpers/database').openDatabase();process.env.TASK_AGENT_ENABLED='true';
 const agent=require('../taskAgent'),meta=require('../metaConnection');
 try{
  const client=await require('../clientStore').getOrCreateClient('972500066129');
  await require('../marketingStore').update(client.id,null,p=>{require('../conversationFacts').write(p,'product','ניהול פרסום לעסקים',{evidence:'ניהול פרסום לעסקים'});return{changed:true};});
  const oldId=crypto.randomUUID(),draft={objective:'לידים',audience:'בעלי עסקים',geography:'ישראל',placements:'פיד',budgetNote:'לא נקבע',scheduleNote:'לא נקבע',headline:'לקוחות חדשים',cta:'לפרטים',designBrief:'עיצוב עסקי'};
  const steps=[{id:'copy',kind:'draft',label:'מודעה ישנה',dependsOn:[],status:'PREPARED',artifact:{title:'מודעה ישנה',content:'OLD_GENERIC_AD',campaignDraft:draft,hash:'old',reviewed:false}},{id:'image',kind:'image',label:'עיצוב',dependsOn:['copy'],status:'PREPARED',packageImage:true,artifact:{mediaId:crypto.randomUUID(),imageText:{headline:draft.headline,cta:draft.cta},title:'עיצוב',content:'ישן',reviewed:false,hash:'image'}},{id:'publish',kind:'meta',intent:'CREATE_BUNDLE',label:'קמפיין',dependsOn:['copy','image'],status:'PENDING'}];
  await h.db.query("INSERT INTO agent_tasks(id,client_id,request,status,state) VALUES($1,$2,$3,'WAITING_REVIEW',$4::jsonb)",[oldId,client.id,'תכין לי קמפיין לבעלי עסקים',JSON.stringify({steps,facts:{},messages:[],campaignPackageVersion:1})]);
  let calls=0;
  const planner=async c=>{
   calls++;assert.equal(c.request,request);assert.equal(c.planningMode,'DISCOVERY_BEFORE_CREATIVE');assert.equal(c.knownBusiness.facts.product.value,'ניהול פרסום לעסקים');assert.doesNotMatch(JSON.stringify(c.plan),/OLD_GENERIC_AD/);
   if(!c.plan.length)return{plan:[{id:'choose',kind:'collect',label:'בחירת קהל',dependsOn:[]},{id:'strategy',kind:'draft',label:'כיוון מוצע',dependsOn:['choose']}],next:{op:'ask',stepId:'choose',question:'אפשר להתמקד בתחום שיש לך בו ניסיון. באיזה סוג עסקים טיפלת עד היום?'}};
   if(c.plan[0].status!=='DONE')return{next:{op:'collect',stepId:'choose',facts:[{key:'industry',value:'מסעדות',evidence:'מסעדות'}]}};
   return{next:{op:'draft',stepId:'strategy',title:'כיוון לשיחה',content:'אפשר להתמקד במסעדות ולבדוק יחד מה ההצעה המתאימה.'}};
  };
  const send=(message,id,options={planner})=>meta.context.run(String(client.id),()=>agent.send(client.id,{message,requestId:id,channel:'WHATSAPP'},options));
  const result=await send(request,'discovery');assert.notEqual(result.task.id,oldId);assert.equal(result.task.status,'WAITING_INPUT');assert.match(result.reply,/באיזה סוג עסקים/);assert.doesNotMatch(result.reply,/OLD_GENERIC_AD|מאשר את התוכן/);assert.equal(calls,1);
  assert.deepEqual(await send(request,'discovery'),result);assert.equal(calls,1);
  assert.equal((await h.db.query('SELECT status FROM agent_tasks WHERE id=$1',[oldId])).rows[0].status,'CANCELLED');
  const discussed=await send('מסעדות','answer');assert.equal(discussed.task.id,result.task.id);assert.equal(discussed.task.status,'WAITING_REVIEW');
  const created=await send('תכין לי מודעה לפי הכיוון שבחרנו, בלי לפרסם','create-after-advice',{planner:async c=>{assert.equal(c.facts.industry.value,'מסעדות');assert.ok(c.messages.some(m=>m.role==='user'&&m.content==='מסעדות'));assert.equal(c.plan.length,0);return{plan:[{id:'copy',kind:'draft',label:'מודעה',dependsOn:[]}],next:{op:'draft',stepId:'copy',title:'מודעה למסעדות',content:'ניהול פרסום למסעדות. לפרטים כתבו לנו.'}};}});
  assert.notEqual(created.task.id,discussed.task.id);assert.match(created.reply,/ניהול פרסום למסעדות/);
  for(const table of ['action_plans','meta_execution_attempts','graphic_jobs'])assert.equal((await h.db.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n,0);
 }finally{await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
