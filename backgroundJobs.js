'use strict';
const {logger}=require('./logger');
function startBackgroundJobs({intervalMs=1000}={}) {
 const workerId=require('crypto').randomUUID();
 let stopped=false,timer,active=Promise.resolve(),cycles=0;
 const tick=()=>{
  if(stopped) return;
  active=(async()=>{
   try {
    await require('./whatsappInboundStore').markExpiredInboundForReview();
    await require('./whatsappWebhookWorker').runOne();
    await require('./whatsappDelivery').runOne();
    if(cycles++%60===0) await require('./maintenance').maintain();
    await require('./db').query("INSERT INTO worker_heartbeats(worker_id,role,last_success_at) VALUES($1,'MESSAGES',NOW()) ON CONFLICT(worker_id) DO UPDATE SET last_success_at=NOW()",[workerId]);
   } catch {logger.error('Background iteration failed');}
  })().finally(()=>{if(!stopped) {timer=setTimeout(tick,intervalMs);timer.unref?.();}});
 };
 tick();
 return async()=>{stopped=true;clearTimeout(timer);await active;await require('./db').query('DELETE FROM worker_heartbeats WHERE worker_id=$1',[workerId]);};
}
module.exports={startBackgroundJobs};
