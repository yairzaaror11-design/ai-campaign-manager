'use strict';
const test=require('node:test'),assert=require('node:assert/strict');

test('facts the owner confirmed earlier (business facts, onboarding budget) are valid grounding',async()=>{
 const crypto=require('node:crypto'),{openDatabase}=require('./helpers/database'),env={...process.env},h=await openDatabase();
 Object.assign(process.env,{TASK_AGENT_ENABLED:'true',META_TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),APPROVAL_HMAC_KEY:crypto.randomBytes(32).toString('hex')});
 try{
  const c=await require('../clientStore').getOrCreateClient('9725'+String(crypto.randomInt(10000000,99999999)));
  await require('../marketingStore').update(c.id,null,p=>{const f=require('../conversationFacts');f.write(p,'businessType','משרד תיווך בחולון');f.write(p,'dailyBudget',{amount:80,currency:'ILS',period:'day'},{source:'onboarding_user_confirmed',evidence:'80 ₪ ליום'});return{handled:false,changed:true};});
  let saw;
  const planner=async x=>{
   if(!x.plan.length)return{plan:[{id:'brief',label:'פרטים',kind:'collect',dependsOn:[]},{id:'copy',label:'מודעה',kind:'draft',dependsOn:['brief']}],next:{op:'collect',stepId:'brief',facts:[{key:'business',value:'משרד תיווך בחולון',evidence:'משרד תיווך בחולון'}],knownFields:['dailyBudget']}};
   saw=x.facts;return{next:{op:'blocked',stepId:'copy',reason:'בדיקה'}};
  };
  const r=await require('../metaConnection').context.run(String(c.id),()=>require('../taskAgent').send(c.id,{message:'תכין לי נוסח מודעה לגיוס בעלי דירות, בלי לפרסם',requestId:'g-1',channel:'WHATSAPP'},{planner}));
  const row=await require('../taskAgent').current(c.id);assert.notEqual(r.task.status,'ERROR',JSON.stringify(row.state.lastError));assert.equal(saw.dailyBudget.value.amount,80);assert.equal(saw.business.value,'משרד תיווך בחולון');
 }finally{await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
