'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {errorSummary}=require('../scripts/live-readiness');
test('live readiness reports classify failures without leaking provider bodies or credentials',()=>{
 const error={message:'secret-token',config:{headers:{Authorization:'Bearer secret-token'}},response:{status:401,data:{error:{code:190,error_subcode:463,message:'secret-token'}}}};
 const summary=errorSummary(error);
 assert.equal(summary.httpStatus,401);assert.equal(summary.providerCode,190);assert.equal(summary.providerSubcode,463);
 assert.equal(JSON.stringify(summary).includes('secret-token'),false);
});
