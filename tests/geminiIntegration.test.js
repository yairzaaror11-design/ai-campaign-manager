const test = require('node:test');
const assert = require('node:assert/strict');
const { processWithGemini, toGeminiHistory } = require('../gemini');

test('Gemini mock receives Hebrew message and returns reply without network', async () => {
  let captured;
  const ai = { chats: { create: config => {
    captured = config;
    return { sendMessage: async ({ message }) => {
      assert.equal(message, 'אני רוצה קמפיין לידים');
      return { text: 'מה התקציב היומי שלך?', functionCalls: [] };
    } };
  } } };
  const result = await processWithGemini('אני רוצה קמפיין לידים', [{ role:'user',content:'אני מפרסם באילת' },{ role:'assistant',content:'איזה שירות?' }], { ai });
  assert.equal(result.text, 'מה התקציב היומי שלך?');
  assert.deepEqual(result.actionPlans, []);
  assert.equal(captured.history.length,2);
  assert.equal(captured.history[1].role,'model');
  assert.equal(captured.model,process.env.GEMINI_MODEL || 'gemini-2.5-flash');
  assert.ok(captured.config.maxOutputTokens <= 2048);
});

test('Gemini API failure propagates without falsely reporting success', async () => {
  const ai = { chats:{ create: () => ({ sendMessage: async () => { throw Error('429 rate limit'); } }) } };
  await assert.rejects(processWithGemini('שלום',[],{ai}),/429 rate limit/);
});

test('Gemini read-only tool calling returns tool output to model', async () => {
  let n=0;
  const ai = { chats:{ create: () => ({ sendMessage: async ({message}) => {
    n++;
    if (n===1) return { functionCalls:[{name:'unrecognized_tool',args:{}}] };
    assert.equal(message[0].functionResponse.name,'unrecognized_tool');
    assert.equal(message[0].functionResponse.response.result.error,'Unknown tool');
    return { text:'אין כלי כזה.',functionCalls:[] };
  } }) } };
  const result=await processWithGemini('בדוק',[],{ai});
  assert.equal(result.text,'אין כלי כזה.');
  assert.equal(n,2);
});

test('Gemini history bounds previous turns to twelve messages',()=>{
  const history=Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',content:String(i)}));
  assert.equal(toGeminiHistory(history).length,12);
  assert.equal(toGeminiHistory(history)[0].parts[0].text,'8');
});
