'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('./helpers/database');

test('full WhatsApp route starts discovery and accepts answers without requiring Meta or AI calls',async()=>{
  const h=await openDatabase();
  const prior={allowed:process.env.AUTHORIZED_PHONE_NUMBERS,enabled:process.env.MARKETING_DISCOVERY_ENABLED,send:process.env.WHATSAPP_SEND_ENABLED};
  const whatsapp=require('../whatsapp'),original=whatsapp.safeSend;
  const sent=[];
  whatsapp.safeSend=async(_phone,reply)=>{sent.push(reply);};
  // messageHandler captures safeSend on import; no external sends in this test.
  delete require.cache[require.resolve('../messageHandler')];
  process.env.AUTHORIZED_PHONE_NUMBERS='972501000333';process.env.MARKETING_DISCOVERY_ENABLED='true';process.env.WHATSAPP_SEND_ENABLED='false';
  try {
    const {handleIncomingMessage}=require('../messageHandler');
    await handleIncomingMessage({id:'wa-1',from:'972501000333',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'/start'}});
    assert.match(sent.at(-1),/מה הכי חשוב לשפר/);
    await handleIncomingMessage({id:'wa-2',from:'972501000333',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'פניות מתאימות'}});
    assert.match(sent.at(-1),/איך קוראים לעסק/);
    const client=await require('../clientStore').getOrCreateClient('972501000333');
    const profile=await require('../marketingStore').load(client.id);
    assert.equal(require('../marketingQuestions').answerFor(profile,'GOAL-001').value,'פניות מתאימות');
    assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM approvals')).rows[0].n,0);
    assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM campaign_local_drafts')).rows[0].n,0);
  } finally {
    whatsapp.safeSend=original;delete require.cache[require.resolve('../messageHandler')];
    for(const [key,value] of Object.entries({AUTHORIZED_PHONE_NUMBERS:prior.allowed,MARKETING_DISCOVERY_ENABLED:prior.enabled,WHATSAPP_SEND_ENABLED:prior.send}))if(value===undefined)delete process.env[key];else process.env[key]=value;
    await h.close();
  }
});
