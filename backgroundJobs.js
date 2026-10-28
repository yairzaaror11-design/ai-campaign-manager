'use strict';
const {logger}=require('./logger');
function startBackgroundJobs({intervalMs=1000}={}) {
 const workerId=require('crypto').randomUUID();
 let stopped=false,cycles=0;
 const progress={inbound:null,outbound:null};
 const loops=[];
 function startLoop(work,label) {
  const loop={timer:null,active:Promise.resolve()};loops.push(loop);
  const tick=()=>{
   if(stopped) return;
   loop.active=Promise.resolve().then(work).then(()=>{if(label in progress)progress[label]=new Date();}).catch(()=>{logger.error('Background iteration failed',{job:label});})
    .finally(()=>{if(!stopped){loop.timer=setTimeout(tick,intervalMs);loop.timer.unref?.();}});
  };
  tick();
 }
 // Outbound delivery must keep running while an image/model request is pending.
 // Each loop remains serial; a slow transport is never automatically retried.
 startLoop(async()=>{
  await require('./whatsappInboundStore').markExpiredInboundForReview();
  await require('./whatsappWebhookWorker').runOne();
 },'inbound');
 startLoop(()=>require('./whatsappDelivery').runOne(),'outbound');
 startLoop(async()=>{
  if(cycles++%60===0) await require('./maintenance').maintain();
  // Maintenance alone does not prove that messages can be processed or sent.
  // Retain the older loop's actual completion time so a hung/failing loop
  // becomes unhealthy even while the other loops keep running.
  if(progress.inbound&&progress.outbound){
   const lastSuccess=new Date(Math.min(progress.inbound.getTime(),progress.outbound.getTime()));
   await require('./db').query("INSERT INTO worker_heartbeats(worker_id,role,last_success_at) VALUES($1,'MESSAGES',$2) ON CONFLICT(worker_id) DO UPDATE SET last_success_at=EXCLUDED.last_success_at",[workerId,lastSuccess]);
  }
 },'maintenance');
 return async()=>{
  stopped=true;for(const loop of loops)clearTimeout(loop.timer);
  await Promise.all(loops.map(loop=>loop.active));
  await require('./db').query('DELETE FROM worker_heartbeats WHERE worker_id=$1',[workerId]);
 };
}
module.exports={startBackgroundJobs};
