'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyError, inspectModels, listModels, summarizeGeneration } = require('../scripts/gemini-probe-core');

test('403 is access denied and never exposes secrets or raw messages', () => {
  const result = classifyError({ status:403, message:'secret-api-key-in-error', headers:{authorization:'secret'} });
  assert.deepEqual(result,{result:'FAILED',category:'ACCESS_DENIED',httpStatus:403});
  assert.doesNotMatch(JSON.stringify(result),/secret/);
});
test('404 is ambiguous model or API version error, not proof of missing model', () => {
  assert.deepEqual(classifyError({ status:404, message:'sensitive-url' }),{result:'FAILED',category:'MODEL_OR_API_VERSION_NOT_FOUND',httpStatus:404});
});
test('429 is rate or quota limit', () => {
  assert.deepEqual(classifyError({ code:429 }),{result:'FAILED',category:'RATE_LIMIT_OR_QUOTA',httpStatus:429});
});
test('ListModels absent target after all pages', async () => {
  const client={models:{list:async()=>({async *[Symbol.asyncIterator](){yield {name:'models/other',supportedActions:['generateContent']};}})}};
  assert.deepEqual(await listModels(client),{result:'SUCCESS',model:'gemini-2.5-flash',listed:false,supportsGenerateContent:false});
});
test('ListModels target exists but does not support generateContent', () => {
  assert.deepEqual(inspectModels([{name:'models/gemini-2.5-flash',supportedActions:['embedContent']}]),{result:'SUCCESS',model:'gemini-2.5-flash',listed:true,supportsGenerateContent:false});
});
test('successful response and supported model are recognized without network', async () => {
  const client={models:{list:async()=>({async *[Symbol.asyncIterator](){yield {name:'models/gemini-2.5-flash',supportedActions:['generateContent']};}})}};
  assert.equal((await listModels(client)).supportsGenerateContent,true);
  assert.deepEqual(summarizeGeneration({text:'  שלום, מה התקציב?  ',usageMetadata:{promptTokenCount:15,candidatesTokenCount:8}}),{result:'SUCCESS',model:'gemini-2.5-flash',response:'שלום, מה התקציב?',inputTokens:15,outputTokens:8});
});
