'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('./helpers/database');

test('marketing answers persist per tenant, replay safely, seed only known brief fields and cascade on deletion',async()=>{
  const h=await openDatabase();
  try {
    const {getOrCreateClient}=require('../clientStore');
    const store=require('../marketingStore');
    const {handleMarketingMessage}=require('../marketingConversation');
    const a=await getOrCreateClient('972501000111'),b=await getOrCreateClient('972501000222');
    const first=await handleMarketingMessage(a.id,'שלום','evt-1');
    await handleMarketingMessage(a.id,'מכירות','evt-2');
    const replay=await handleMarketingMessage(a.id,'מכירות','evt-2');
    assert.equal(replay.reply,(await store.load(a.id)).events.find(e=>e.id==='evt-2').result.reply);
    assert.equal((await store.load(a.id)).session.pendingId,'BUS-001');
    await handleMarketingMessage(a.id,'העסק הראשון','evt-3');
    await handleMarketingMessage(b.id,'שלום','b-evt-1');
    await handleMarketingMessage(b.id,'פניות','b-evt-2');
    await handleMarketingMessage(b.id,'העסק השני','b-evt-3');
    assert.equal((await store.briefSeeds(a.id)).businessName,'העסק הראשון');
    assert.equal((await store.briefSeeds(b.id)).businessName,'העסק השני');
    assert.equal((await store.answers(a.id,['BUS-001']))[0].answer.value,'העסק הראשון');
    await assert.rejects(store.update(a.id,'error',()=>{throw Error('TEST_ROLLBACK');}),/TEST_ROLLBACK/);
    assert.equal((await store.load(a.id)).events.some(e=>e.id==='error'),false);
    assert.ok(!('dailyBudget' in await store.briefSeeds(a.id)));
    await store.pause(a.id);assert.equal((await store.load(a.id)).session,null);
    assert.equal((await store.briefSeeds(a.id)).businessName,'העסק הראשון');
    const {context}=require('../metaConnection');
    const read=await context.run(String(b.id),()=>require('../gemini').runTool('get_marketing_answers',{ids:['BUS-001']}));
    assert.equal(read[0].answer.value,'העסק השני');
    await h.db.transaction(tx=>require('../metaDeletion').deleteClient(a.id,tx));
    assert.equal(await store.load(a.id),null);
    assert.ok(await store.load(b.id));
    await assert.rejects(handleMarketingMessage(a.id,'שלום','late'),/MARKETING_CLIENT_NOT_FOUND/);
    assert.match(first.reply,/מה הכי חשוב/);
  } finally {await h.close();}
});

