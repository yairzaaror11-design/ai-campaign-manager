'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {openDatabase}=require('./helpers/database');
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}
async function until(check){const deadline=Date.now()+5000;while(Date.now()<deadline){if(await check())return;await new Promise(r=>setTimeout(r,10));}throw Error('WORKER_READINESS_TEST_TIMEOUT');}

test('worker readiness requires both message loops and recovers when a blocked loop completes',async t=>{
 const h=await openDatabase(),env={...process.env};
 const inbound=require('../whatsappWebhookWorker'),outbound=require('../whatsappDelivery'),maintenance=require('../maintenance');
 const saved={inbound:inbound.runOne,outbound:outbound.runOne,maintain:maintenance.maintain};
 const express=require('express'),app=express();app.use('/health',require('../health'));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const url='http://127.0.0.1:'+server.address().port+'/health';
 process.env.REQUIRE_WORKER_HEARTBEAT='true';process.env.NODE_ENV='test';
 let stop,gate;
 try{
  for(const blocked of ['inbound','outbound'])await t.test('a blocked '+blocked+' loop cannot be hidden by successful maintenance',async()=>{
   gate=deferred();let maintenanceCycles=0,inboundCycles=0,outboundCycles=0;
   inbound.runOne=async()=>{inboundCycles++;if(blocked==='inbound')await gate.promise;return{status:'IDLE'};};
   outbound.runOne=async()=>{outboundCycles++;if(blocked==='outbound')await gate.promise;return{status:'IDLE'};};
   maintenance.maintain=async()=>{maintenanceCycles++;};
   stop=require('../backgroundJobs').startBackgroundJobs({intervalMs:5});
   await until(()=>maintenanceCycles>=1&&inboundCycles>=1&&outboundCycles>=1);
   // Give maintenance multiple chances to run; it cannot claim readiness for a
   // loop which has never completed, even with a healthy database.
   await until(async()=>{
    const r=await h.db.query("SELECT COUNT(*)::int AS n FROM worker_heartbeats");
    assert.equal(r.rows[0].n,0);
    return blocked==='inbound'?outboundCycles>=3:inboundCycles>=3;
   });
   let response=await fetch(url);assert.equal(response.status,503);assert.equal((await response.json()).worker,false);
   gate.resolve();
   await until(async()=>{const r=await fetch(url);return r.status===200;});
   response=await fetch(url);assert.equal((await response.json()).worker,true);
   await stop();stop=null;
   assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM worker_heartbeats')).rows[0].n,0);
  });
 }finally{
  gate?.resolve();if(stop)await stop();
  inbound.runOne=saved.inbound;outbound.runOne=saved.outbound;maintenance.maintain=saved.maintain;
  await new Promise(resolve=>server.close(resolve));await h.close();
  for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);
 }
});
