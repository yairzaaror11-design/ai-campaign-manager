'use strict';
// Content approval runs the ad-compliance check: blocking problems stop it with one short message and an
// offer to fix automatically; warnings are mentioned in one line and do not block.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const agent=require('../taskAgent'),meta=require('../metaConnection'),{openDatabase}=require('./helpers/database');

async function setup(businessType){
 const c=await require('../clientStore').getOrCreateClient('9725'+String(crypto.randomInt(10000000,99999999)));
 await require('../marketingStore').update(c.id,null,p=>{require('../conversationFacts').write(p,'businessType',businessType);return{handled:false,changed:true};});
 return c;
}
// One database per file (the helper is not re-openable in the same process).
const env={...process.env};let h;
test.before(async()=>{h=await openDatabase();Object.assign(process.env,{TASK_AGENT_ENABLED:'true',META_TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),APPROVAL_HMAC_KEY:crypto.randomBytes(32).toString('hex')});});
test.after(async()=>{await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);});

test('blocking findings stop approval, "לתקן לבד" sends a fix to the planner, warnings do not block',async()=>{
 const c=await setup('סטודיו לפילאטיס בגבעתיים');
 const feedback=[];
 const planner=async x=>{
  if(!x.plan.length)return{plan:[{id:'copy',label:'נוסח מודעה',kind:'draft',dependsOn:[]}],next:{op:'draft',stepId:'copy',title:'מודעה',content:'סובלים מכאבי גב? שיעור פילאטיס ראשון ב־50 ₪ +מע״מ.'}};
  if(x.plannerFeedback?.code==='AD_COMPLIANCE'){feedback.push(x.plannerFeedback.instruction);return{next:{op:'draft',stepId:'copy',title:'מודעה',content:'פילאטיס לחיזוק הגב בגבעתיים. שיעור ראשון ב־50 ₪. הסטודיו הכי זול בעיר.'}};}
  if(x.plan.some(s=>s.status==='PREPARED'))return{next:{op:'review'}};
  return{next:{op:'finish'}};
 };
 const send=(message,requestId)=>meta.context.run(String(c.id),()=>agent.send(c.id,{message,requestId,channel:'WHATSAPP'},{planner}));
 const review=await send('תכין לי נוסח מודעה לפילאטיס, שיעור ראשון 50 ₪','ac-1');
 assert.equal(review.task.status,'WAITING_REVIEW');

 const blocked=await send('מאשר את התוכן','ac-2');
 assert.equal(blocked.task.status,'WAITING_REVIEW');
 assert.equal(blocked.notice,true);
 assert.match(blocked.reply,/^לפני שמאשרים, צריך לתקן במודעה:/);
 assert.match(blocked.reply,/Meta אוסרת/);
 assert.match(blocked.reply,/כולל מע״מ/);
 assert.match(blocked.reply,/לתקן לבד\?/);
 assert.deepEqual(blocked.choices.map(x=>x.text),['לתקן לבד','אני רוצה לשנות את נוסח המודעה']);
 let row=await agent.current(c.id);
 assert.equal(row.state.steps.find(s=>s.id==='copy').status,'PREPARED','nothing approved');
 assert.deepEqual(row.state.complianceFix.map(f=>f.code).sort(),['PERSONAL_HEALTH','PRICE_WITHOUT_VAT']);

 const fixed=await send('לתקן לבד','ac-3');
 assert.equal(feedback.length,1);assert.match(feedback[0],/PERSONAL_HEALTH/);assert.match(feedback[0],/PRICE_WITHOUT_VAT/);
 assert.equal(fixed.task.status,'WAITING_REVIEW');
 assert.match(fixed.reply,/פילאטיס לחיזוק הגב/);
 row=await agent.current(c.id);
 assert.equal(row.state.complianceFix,undefined);assert.equal(row.state.complianceFeedback,undefined);

 const approved=await send('מאשר את התוכן','ac-4');
 assert.notEqual(approved.task.status,'WAITING_REVIEW');
 assert.match(approved.reply,/^כדאי לבדוק: .*הכי זול/,'the warning is mentioned once, in one line');
 assert.doesNotMatch(approved.reply,/לפני שמאשרים/);
 row=await agent.current(c.id);
 assert.equal(row.state.steps.find(s=>s.id==='copy').status,'DONE');
});

test('clinic ads: a treatment price or a promised result blocks approval',async()=>{
 const c=await setup('מרפאה לרפואה אסתטית בהרצליה');
 const planner=async x=>{
  if(!x.plan.length)return{plan:[{id:'copy',label:'נוסח מודעה',kind:'draft',dependsOn:[]}],next:{op:'draft',stepId:'copy',title:'מודעה',content:'הזרקת בוטוקס ב־900 ₪ בלבד. תוצאות מובטחות.'}};
  if(x.plan.some(s=>s.status==='PREPARED'))return{next:{op:'review'}};
  return{next:{op:'finish'}};
 };
 const send=(message,requestId)=>meta.context.run(String(c.id),()=>agent.send(c.id,{message,requestId,channel:'PORTAL'},{planner}));
 await send('תכין לי נוסח מודעה לבוטוקס','cl-1');
 const blocked=await send('מאשר את התוכן','cl-2');
 assert.equal(blocked.task.status,'WAITING_REVIEW');
 assert.match(blocked.reply,/בפרסום רפואי אסור לציין מחיר/);
 assert.match(blocked.reply,/להבטיח תוצאה/);
 // Any other reply keeps the review open; nothing is approved behind the owner's back.
 const other=await send('כן','cl-3');
 assert.equal(other.task.status,'WAITING_REVIEW');
 assert.equal((await agent.current(c.id)).state.steps.find(s=>s.id==='copy').status,'PREPARED');
});
