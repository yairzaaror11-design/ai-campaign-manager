'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const meta=require('../metaConnection'),ads=require('../metaAds');
test('campaign reports collect all cursor pages within the same tenant and never follow provider URLs',async()=>{
 const before=meta.tenantRead;const requests=[];
 try {
 meta.tenantRead=async(path,params)=>{requests.push({path,after:params.after});return params.after?{data:[{campaign_id:'2',spend:'3.50'}]}:{data:[{campaign_id:'1',spend:'2.50'}],paging:{next:'https://untrusted.invalid/',cursors:{after:'cursor-2'}}};};
 const r=await meta.context.run('12',()=>ads.getCampaignPerformance('act_11','last_7d'));
 assert.equal(r.data.length,2);assert.deepEqual(requests,[{path:'/act_11/insights',after:undefined},{path:'/act_11/insights',after:'cursor-2'}]);
 meta.tenantRead=async()=>({data:[],paging:{next:'https://untrusted.invalid/'}});
 await assert.rejects(meta.context.run('12',()=>ads.getCampaignPerformance('act_11')),/INVALID_REPORT_CURSOR/);
 }finally{meta.tenantRead=before;}
});
