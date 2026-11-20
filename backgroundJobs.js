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
 // Each job records its last success/failure (job_runs) for the self-check;
 // one failing job no longer stops the others in the same cycle.
 const track=require('./selfCheck').track;
 startLoop(async()=>{
  if(cycles++%60===0) await track('maintenance',()=>require('./maintenance').maintain());
  if(cycles%300===1) await track('reports',()=>require('./scheduledReports').runDue());
  if(cycles%120===2) await track('leadCheckins',()=>require('./leadCheckins').runDue());
  if(cycles%600===5) await track('campaignGuard',()=>require('./campaignGuard').runDue());
  if(cycles%600===7) await track('seasonal',()=>require('./seasonalPrompts').runDue());
  if(cycles%120===13) await track('dailyAdvice',()=>require('./dailyAdvice').runDue());
  if(cycles%60===9) await track('crmFeedback',()=>require('./metaCrmFeedback').runDue());
  if(cycles%60===11) await track('organic',()=>require('./organicContent').runDue());
  if(cycles%600===13) await track('subscriptions',()=>require('./subscriptionService').runDue());
  if(cycles%600===17) await track('audiences',()=>require('./buyerAudiences').runDue());
  if(cycles%3600===19) await track('retentionNotices',()=>require('./dataRetention').warnDue());
  if(cycles%60===23&&require('./leadConcierge').enabled()) await track('leadConcierge',()=>require('./leadConcierge').runDue());
  if(cycles%600===31&&require('./onboarding').enabled()) await track('onboardingFollowups',()=>require('./onboarding').runDue());
  await require('./db').query("INSERT INTO worker_heartbeats(worker_id,role,last_success_at) VALUES($1,'MESSAGES',NOW()) ON CONFLICT(worker_id) DO UPDATE SET last_success_at=NOW()",[workerId]);
  if(cycles%300===29&&process.env.SELF_CHECK_ENABLED!=='false') await track('selfCheck',()=>require('./selfCheck').run());
 },'maintenance');
 return async()=>{
  stopped=true;for(const loop of loops)clearTimeout(loop.timer);
  await Promise.all(loops.map(loop=>loop.active));
  await require('./db').query('DELETE FROM worker_heartbeats WHERE worker_id=$1',[workerId]);
 };
}
// Where background jobs run: 'web' (default, inside the web service) or
// 'worker' (a separate Render background worker running messageWorker.js).
function jobsRunIn() {return process.env.RUN_BACKGROUND_JOBS_IN==='worker'||process.env.WHATSAPP_WORKER_IN_WEB==='false'?'worker':'web';}
module.exports={startBackgroundJobs,jobsRunIn};
