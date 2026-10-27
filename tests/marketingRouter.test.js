'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('./helpers/database');

test('full WhatsApp route starts discovery and accepts answers without requiring Meta or AI calls',async()=>{
  const h=await openDatabase();
  const prior={allowed:process.env.AUTHORIZED_PHONE_NUMBERS,enabled:process.env.MARKETING_DISCOVERY_ENABLED,send:process.env.WHATSAPP_SEND_ENABLED};
  const whatsapp=require('../whatsapp'),original=whatsapp.safeSend;
  const voice=require('../voiceHandler'),originalVoice=voice.transcribeVoiceMessage;
  let voiceFails=false;voice.transcribeVoiceMessage=async()=>{if(voiceFails)throw Error('mock transcription failure');return 'אני מתקין פרגולות באזור נתניה ורוצה עוד לקוחות בתקציב של 100 שקל ביום';};
  const sent=[];
  whatsapp.safeSend=async(_phone,reply)=>{sent.push(reply);};
  // messageHandler captures safeSend on import; no external sends in this test.
  delete require.cache[require.resolve('../messageHandler')];
  process.env.AUTHORIZED_PHONE_NUMBERS='972501000333';process.env.MARKETING_DISCOVERY_ENABLED='true';process.env.WHATSAPP_SEND_ENABLED='false';
  try {
    const {handleIncomingMessage}=require('../messageHandler');
    await handleIncomingMessage({id:'wa-1',from:'972501000333',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'/start'}});
    assert.match(sent.at(-1),/מה נרצה לעשות היום/);
    await handleIncomingMessage({id:'wa-2',from:'972501000333',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'אני רוצה קמפיין, המטרה מכירות'}});
    assert.match(sent.at(-1),/מה העסק עושה/);
    const client=await require('../clientStore').getOrCreateClient('972501000333');
    const profile=await require('../marketingStore').load(client.id);
    assert.equal(require('../conversationFacts').value(profile,'businessGoal'),'מכירות');
    await handleIncomingMessage({id:'wa-voice',from:'972501000333',timestamp:String(Math.floor(Date.now()/1000)),type:'audio',audio:{id:'mock-media'}});
    const voiced=await require('../marketingStore').load(client.id);
    assert.equal(require('../conversationFacts').value(voiced,'geography'),'נתניה');
    assert.equal(require('../conversationFacts').value(voiced,'dailyBudget').amount,100);
    const preserved=JSON.stringify(voiced.answers);voiceFails=true;
    await handleIncomingMessage({id:'wa-voice-fail',from:'972501000333',timestamp:String(Math.floor(Date.now()/1000)),type:'audio',audio:{id:'mock-media-fail'}});
    assert.match(sent.at(-1),/לא הצלחתי לתמלל/);assert.equal(JSON.stringify((await require('../marketingStore').load(client.id)).answers),preserved);
    assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM approvals')).rows[0].n,0);
    assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM campaign_local_drafts')).rows[0].n,0);
  } finally {
    voice.transcribeVoiceMessage=originalVoice;whatsapp.safeSend=original;delete require.cache[require.resolve('../messageHandler')];
    for(const [key,value] of Object.entries({AUTHORIZED_PHONE_NUMBERS:prior.allowed,MARKETING_DISCOVERY_ENABLED:prior.enabled,WHATSAPP_SEND_ENABLED:prior.send}))if(value===undefined)delete process.env[key];else process.env[key]=value;
    await h.close();
  }
});
