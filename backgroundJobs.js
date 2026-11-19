'use strict';
const {logger}=require('./logger');
function startBackgroundJobs({intervalMs=1000}={}) {
 const workerId=require('crypto').randomUUID();
 let stopped=false,cycles=0;
 const loops=[];
 function startLoop(work,label) {
  const loop={timer:null,active:Promise.resolve()};loops.push(loop);
  const tick=()=>{
   if(stopped) return;
   loop.active=Promise.resolve().then(work).catch(()=>{logger.error('Background iteration failed',{job:label});})
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
 const leadImport=require('./metaLeadImport');
 if(leadImport.enabled()) startLoop(()=>leadImport.runOne(),'meta-leads');
 startLoop(()=>require('./whatsappDelivery').runOne(),'outbound');
 // Video jobs poll the provider without blocking message handling.
 if(require('./videoService').enabled()) startLoop(()=>require('./videoService').runOne(),'videos');
 startLoop(async()=>{
  if(cycles++%60===0) await require('./maintenance').maintain();
  if(cycles%300===1) await require('./scheduledReports').runDue();
  if(cycles%120===2) await require('./leadCheckins').runDue();
  if(cycles%600===5) await require('./campaignGuard').runDue();
  if(cycles%600===7) await require('./seasonalPrompts').runDue();
  if(cycles%120===13) await require('./dailyAdvice').runDue();
  if(cycles%60===9) await require('./metaCrmFeedback').runDue();
  if(cycles%60===11) await require('./organicContent').runDue();
  await require('./db').query("INSERT INTO worker_heartbeats(worker_id,role,last_success_at) VALUES($1,'MESSAGES',NOW()) ON CONFLICT(worker_id) DO UPDATE SET last_success_at=NOW()",[workerId]);
 },'maintenance');
 return async()=>{
  stopped=true;for(const loop of loops)clearTimeout(loop.timer);
  await Promise.all(loops.map(loop=>loop.active));
  await require('./db').query('DELETE FROM worker_heartbeats WHERE worker_id=$1',[workerId]);
 };
}
module.exports={startBackgroundJobs};
