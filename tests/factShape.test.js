'use strict';
const test=require('node:test'),assert=require('node:assert/strict');

test('fact shape: camelCase keys and numeric values are normalized, not rejected',async()=>{
 const crypto=require('node:crypto'),{openDatabase}=require('./helpers/database'),env={...process.env},h=await openDatabase();
 Object.assign(process.env,{TASK_AGENT_ENABLED:'true',META_TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),APPROVAL_HMAC_KEY:crypto.randomBytes(32).toString('hex')});
 try{
  const c=await require('../clientStore').getOrCreateClient('9725'+String(crypto.randomInt(10000000,99999999)));
  let saw;
  const planner=async x=>{
   if(!x.plan.length)return{plan:[{id:'brief',label:'פרטים',kind:'collect',dependsOn:[]},{id:'copy',label:'מודעה',kind:'draft',dependsOn:['brief']}],next:{op:'collect',stepId:'brief',facts:[{key:'targetCity',value:'חולון',evidence:'בחולון'},{key:'rooms',value:4,evidence:'4 חדרים'}]}};
   saw=x.facts;return{next:{op:'blocked',stepId:'copy',reason:'בדיקה'}};
  };
  const r=await require('../metaConnection').context.run(String(c.id),()=>require('../taskAgent').send(c.id,{message:'תכין לי נוסח מודעה לדירת 4 חדרים בחולון, בלי לפרסם',requestId:'s-1',channel:'WHATSAPP'},{planner}));
  assert.notEqual(r.task.status,'ERROR');assert.equal(saw.target_city.value,'חולון');assert.equal(saw.rooms.value,'4');
 }finally{await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
