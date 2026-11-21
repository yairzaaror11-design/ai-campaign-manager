'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('a full campaign expands an old preparation plan and returns copy, form, settings and one text-bearing image together',async()=>{
 const env={...process.env},h=await require('./helpers/isolatedDatabase').openDatabase();let client;
 Object.assign(process.env,{TASK_AGENT_ENABLED:'true',READ_ONLY:'true',META_WRITES_ENABLED:'false',GRAPHICS_ENABLED:'true',GEMINI_API_KEY:'fixture',GEMINI_IMAGE_MODEL:'gemini-image-fixture'});
 const agent=require('../taskAgent'),meta=require('../metaConnection'),packages=require('../campaignPackage');
 try{
  assert.equal(packages.required('מה מצב הקמפיין?'),false);assert.equal(packages.required('בדוק ביצועי קמפיין'),false);assert.equal(packages.required('תכין לי אסטרטגיה לקמפיין'),false);assert.equal(packages.required('תכין לי דוח לקמפיין'),false);assert.equal(packages.required('תכין רק טקסט לקמפיין'),false);
  client=await require('../clientStore').getOrCreateClient('972500078001');
  const request='תכין לי קמפיין דרושים עם מודעה וטופס מועמדות, בלי לפרסם';
  const plan=agent.validatePlan([{id:'copy',kind:'draft',label:'מודעה וטופס',dependsOn:[]},{id:'form',kind:'meta',intent:'CREATE_LEAD_FORM',label:'טופס ב־Meta',dependsOn:['copy']},{id:'campaign',kind:'meta',intent:'CREATE_BUNDLE',label:'קמפיין מושהה',dependsOn:['form']}],request);
  plan[0].status='PREPARED';plan[0].artifact={title:'מודעה',content:'מודעה קודמת',reviewed:false,hash:'old',formDraft:{title:'טופס',questions:['שם מלא','טלפון']}};
  const id=require('node:crypto').randomUUID();
  await h.db.query("INSERT INTO agent_tasks(id,client_id,request,status,state) VALUES($1,$2,$3,'ERROR',$4::jsonb)",[id,client.id,request,JSON.stringify({steps:plan,facts:{role:{value:'איש מכירות',evidence:'גיוס איש מכירות בכל הארץ'}},messages:[{role:'user',content:request},{role:'user',content:'גיוס איש מכירות בכל הארץ'}],reviewHash:'old',lastError:'TASK_STEP_FAILED'})]);
  const campaignDraft={objective:'לידים למועמדים',audience:'מועמדים לתפקיד מכירות, לא בעלי עסקים',geography:'בכל הארץ',placements:'הצעת מיקומים אוטומטיים לבדיקה',budgetNote:'לא נקבע; נדרש אישור נפרד',scheduleNote:'לא נקבע',headline:'דרוש איש מכירות',cta:'להגשת מועמדות',designBrief:'עיצוב עברי נקי ללא לוגו מומצא'};
  let planned=0,generated=0,uploaded=0,notices=0;const options={onProgress:async()=>{notices++;},planner:async c=>{
   planned++;assert.equal(c.request,request);assert.equal(c.plannerFeedback.code,'TASK_CAMPAIGN_DRAFT_REQUIRED');
   assert.deepEqual(c.plan.map(s=>s.id),['copy','campaign_package_image','form','campaign_package_upload','campaign']);
   return{next:{op:'draft',stepId:'copy',title:'מודעת דרושים',content:'מגייסים איש מכירות בכל הארץ. להגשת מועמדות מלאו את הטופס.',formDraft:{title:'טופס מועמדות',questions:['שם מלא','טלפון','מה הניסיון הרלוונטי שלך במכירות?']},campaignDraft}};
  },imageOptions:{generateImage:async prompt=>{generated++;assert.match(prompt,/דרוש איש מכירות/);assert.match(prompt,/להגשת מועמדות/);return{buffer:Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(32)]),mimeType:'image/png'};},uploadImage:async()=>{uploaded++;return'789';}}};
  const send=(message,requestId)=>meta.context.run(String(client.id),()=>agent.send(client.id,{message,requestId,channel:'WHATSAPP'},options));
  const result=await send('המשך במשימה','whole-package');
  assert.equal(result.task.id,id);assert.equal(result.task.status,'WAITING_REVIEW',JSON.stringify(result));assert.equal(planned,1);assert.equal(generated,1);assert.equal(uploaded,1);assert.equal(notices,1);assert.equal(result.mediaIds.length,1);
  assert.match(result.reply,/קהל מוצע: מועמדים/);assert.match(result.reply,/לא נקבע; נדרש אישור נפרד/);assert.match(result.reply,/מה הניסיון הרלוונטי/);
  const stored=await agent.current(client.id),image=stored.state.steps.find(s=>s.packageImage);
  assert.deepEqual(image.artifact.imageText,{headline:campaignDraft.headline,cta:campaignDraft.cta});assert.equal(image.status,'PREPARED');assert.equal(image.artifact.reviewed,false);assert.equal(stored.state.steps.find(s=>s.id==='form').status,'PENDING');
  assert.deepEqual(await send('המשך במשימה','whole-package'),result);assert.equal(generated,1);assert.equal(notices,1);
  assert.equal((await h.db.query('SELECT id FROM action_plans WHERE client_id=$1',[client.id])).rows.length,0);
  assert.equal((await h.db.query('SELECT action_id FROM meta_execution_attempts WHERE client_id=$1',[client.id])).rows.length,0);
 }finally{if(client)await h.db.query('DELETE FROM clients WHERE id=$1',[client.id]);await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
