'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {openDatabase}=require('./helpers/database');
test('repair migration removes only contaminated facts and is repeatable',async()=>{
 const h=await openDatabase();
 try{
  const store=require('../marketingStore'),facts=require('../conversationFacts'),clients=require('../clientStore');
  const a=await clients.getOrCreateClient('972501009001'),b=await clients.getOrCreateClient('972501009002');
  for(const c of [a,b])await store.update(c.id,null,p=>{
   facts.write(p,'businessName','יאיר דיגיטל');facts.write(p,'advantage','שירות אישי');require('../campaignJourney').init(p);
   p.connection={status:'CONNECTED',account:{id:'act_123'}};p.ui={nonce:'old'};p.journey.draft={status:'LOCAL_DRAFT',creatives:[]};
   if(c.id===a.id)p.answers[facts.descriptor(p,'advantage').address].value='תמחק את השיחה אני רוצה להתחיל מחדש';
   return{handled:false,changed:true};
  });
  const unaffected=JSON.stringify(await store.load(b.id));
  const sql=fs.readFileSync(path.join(__dirname,'../migrations/008_remove_conversation_control_facts.sql'),'utf8');
  await h.db.query(sql);const fixed=await store.load(a.id);
  assert.equal(facts.value(fixed,'advantage'),null);assert.equal(facts.value(fixed,'businessName'),'יאיר דיגיטל');
  assert.equal(fixed.connection.account.id,'act_123');assert.equal(fixed.ui,undefined);assert.equal(fixed.journey.draft,null);
  assert.equal(JSON.stringify(await store.load(b.id)),unaffected);
  await h.db.query(sql);assert.equal(JSON.stringify(await store.load(a.id)),JSON.stringify(fixed));
 }finally{await h.close();}
});
