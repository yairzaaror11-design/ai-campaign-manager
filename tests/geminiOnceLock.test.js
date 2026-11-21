'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { claimOnce, LOCK_REF } = require('../scripts/gemini-once-lock');
const { main } = require('../scripts/run-gemini-listmodels-once');
const env={ GEMINI_API_KEY:'fake-key', GITHUB_TOKEN:'fake-token', GITHUB_REPOSITORY:'owner/repo', GITHUB_SHA:'a'.repeat(40) };
function atomicMock() {
  let consumed=false, attempts=0;
  return { count:()=>attempts, request:async (_url,opts)=>{
    attempts++;
    assert.equal(opts.method,'POST');assert.equal(opts.redirect,'manual');
    assert.equal(JSON.parse(opts.body).ref,LOCK_REF);
    if (consumed) return {status:422};
    consumed=true;return {status:201};
  }};
}
test('duplicate execution cannot invoke Google twice',async()=>{
  const mock=atomicMock();let calls=0;
  const run=()=>main({env,claim:args=>claimOnce({...args,request:mock.request}),list:async()=>{calls++;return {result:'SUCCESS'};},log:()=>{},errorLog:()=>{}});
  assert.equal(await run(),0);assert.equal(await run(),2);assert.equal(calls,1);
});
test('parallel executions cannot both invoke Google',async()=>{
  const mock=atomicMock();let calls=0;
  const run=()=>main({env,claim:args=>claimOnce({...args,request:mock.request}),list:async()=>{calls++;return {result:'SUCCESS'};},log:()=>{},errorLog:()=>{}});
  const codes=await Promise.all([run(),run(),run(),run()]);
  assert.deepEqual(codes.sort(),[0,2,2,2]);assert.equal(calls,1);
});
test('failure after claim consumes attempt and prevents retry',async()=>{
  const mock=atomicMock();let calls=0;
  const run=()=>main({env,claim:args=>claimOnce({...args,request:mock.request}),list:async()=>{calls++;throw Object.assign(new Error('secret'),{status:404});},log:()=>{},errorLog:()=>{}});
  assert.equal(await run(),1);assert.equal(await run(),2);assert.equal(calls,1);
});
test('uncertain lock response fails closed without calling Google',async()=>{
  let calls=0;
  const code=await main({env,claim:()=>claimOnce({token:'x',repository:'owner/repo',sha:'a'.repeat(40),request:async()=>{throw Error('network');}}),list:async()=>{calls++;},errorLog:()=>{}});
  assert.equal(code,2);assert.equal(calls,0);
});
test('missing configuration fails before claim',async()=>{
  let claims=0;
  const code=await main({env:{},claim:async()=>{claims++;},list:async()=>{throw Error('must not run');},errorLog:()=>{}});
  assert.equal(code,2);assert.equal(claims,0);
});
