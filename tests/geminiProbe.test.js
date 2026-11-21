'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyError, inspectModels, listModelsOnce, summarizeGeneration } = require('../scripts/gemini-probe-core');
const reply = (data, status = 200) => ({ ok: status === 200, status, json: async () => data });
function mockRequest(data, status = 200) {
  let calls = 0;
  const request = async (url, options) => {
    calls++;
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers['x-goog-api-key'], 'test-key');
    assert.ok(options.signal);
    return reply(data, status);
  };
  return { request, count: () => calls };
}
test('403 is safely classified without exposing raw error', async () => {
  const m=mockRequest({},403);
  await assert.rejects(listModelsOnce('test-key',{request:m.request}),e=>{
    assert.deepEqual(classifyError(e),{result:'FAILED',category:'ACCESS_DENIED',httpStatus:403}); return true;
  });
  assert.equal(m.count(),1);
});
test('404 remains ambiguous and does not trigger a second request', async () => {
  const m=mockRequest({},404);
  await assert.rejects(listModelsOnce('test-key',{request:m.request}),e=>{
    assert.equal(classifyError(e).category,'MODEL_OR_API_VERSION_NOT_FOUND'); return true;
  });
  assert.equal(m.count(),1);
});
test('429 is rate or quota limited without retry', async () => {
  const m=mockRequest({},429);
  await assert.rejects(listModelsOnce('test-key',{request:m.request}),e=>{
    assert.equal(classifyError(e).category,'RATE_LIMIT_OR_QUOTA'); return true;
  });
  assert.equal(m.count(),1);
});
test('absent target and nextPageToken are reported as partial, never silently paginated',async()=>{
  const m=mockRequest({models:[{name:'models/other',supportedGenerationMethods:['generateContent']}],nextPageToken:'opaque'});
  const r=await listModelsOnce('test-key',{request:m.request});
  assert.equal(r.listed,false);assert.equal(r.complete,false);assert.equal(m.count(),1);
});
test('listed model without generateContent is rejected as unsupported',async()=>{
  const m=mockRequest({models:[{name:'models/gemini-2.5-flash',supportedGenerationMethods:['embedContent']}]});
  const r=await listModelsOnce('test-key',{request:m.request});
  assert.equal(r.listed,true);assert.equal(r.supportsGenerateContent,false);assert.equal(m.count(),1);
});
test('successful single GET returns model metadata and does not generate content',async()=>{
  const m=mockRequest({models:[{name:'models/gemini-2.5-flash',supportedGenerationMethods:['generateContent']}]});
  const r=await listModelsOnce('test-key',{request:m.request});
  assert.equal(r.listed,true);assert.equal(r.supportsGenerateContent,true);assert.equal(r.complete,true);
  assert.equal(m.count(),1);
  assert.equal(summarizeGeneration({text:'שלום',usageMetadata:{promptTokenCount:1,candidatesTokenCount:2}}).result,'SUCCESS');
});
