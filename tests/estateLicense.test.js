'use strict';
// Real-estate ads must carry the broker license: asked once before content approval, then added to the copy.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const agent=require('../taskAgent'),meta=require('../metaConnection'),{openDatabase}=require('./helpers/database');

test('real-estate drafts: license asked before approval, saved, added to the ad',async()=>{
 const env={...process.env},h=await openDatabase();
 Object.assign(process.env,{TASK_AGENT_ENABLED:'true',META_TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),APPROVAL_HMAC_KEY:crypto.randomBytes(32).toString('hex')});
 try{
  const c=await require('../clientStore').getOrCreateClient('9725'+String(crypto.randomInt(10000000,99999999)));
  await require('../marketingStore').update(c.id,null,p=>{require('../conversationFacts').write(p,'businessType','משרד תיווך בחולון');return{handled:false,changed:true};});
  const planner=async x=>{
   if(!x.plan.length)return{plan:[{id:'copy',label:'נוסח מודעה',kind:'draft',dependsOn:[]}],next:{op:'draft',stepId:'copy',title:'מודעה',content:'דירת 4 חדרים בחולון. השאירו פרטים.'}};
   if(x.plan.some(s=>s.status==='PREPARED'))return{next:{op:'review'}};
   return{next:{op:'finish'}};
  };
  const send=(message,requestId)=>meta.context.run(String(c.id),()=>agent.send(c.id,{message,requestId,channel:'WHATSAPP'},{planner}));
  const review=await send('תכין לי נוסח מודעה לדירה','lic-1');
  assert.equal(review.task.status,'WAITING_REVIEW');
  const ask=await send('מאשר את התוכן','lic-2');
  assert.match(ask.reply,/רישיון התיווך/);assert.equal(ask.task.status,'WAITING_REVIEW');
  const saved=await send('12345678','lic-3');
  assert.match(saved.reply,/שמרתי ✓ הוספתי למודעה/);assert.match(saved.reply,/12345678/);
  assert.equal((await require('../marketingStore').load(c.id)).brokerLicense,'12345678');
  const row=await agent.current(c.id);
  assert.match(row.state.steps.find(s=>s.id==='copy').artifact.content,/12345678/);
  const approved=await send('מאשר את התוכן','lic-4');
  assert.notEqual(approved.task.status,'WAITING_REVIEW');
 }finally{await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});

test('onboarding-confirmed budget reaches the planner as current, older history does not',()=>{
 const ctx=require('../taskPlanner').businessContext({facts:{
  businessType:{value:'משרד תיווך',status:'known',source:'user_explicit'},
  dailyBudget:{value:{amount:80,currency:'ILS',period:'day'},status:'known',source:'onboarding_user_confirmed',at:new Date().toISOString()},
  businessGoal:{value:'פניות',status:'known',source:'user_explicit',at:new Date().toISOString()}
 }});
 assert.equal(ctx.confirmedForFirstCampaign.dailyBudget.value.amount,80);
 assert.equal(ctx.confirmedForFirstCampaign.businessGoal,undefined);
 assert.equal(ctx.facts.dailyBudget,undefined);
 const old=require('../taskPlanner').businessContext({facts:{dailyBudget:{value:{amount:80},source:'onboarding_user_confirmed',at:new Date(Date.now()-30*864e5).toISOString()}}});
 assert.equal(old.confirmedForFirstCampaign,undefined);
});
