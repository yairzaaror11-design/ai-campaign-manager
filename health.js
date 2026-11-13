'use strict';
const router=require('express').Router();
router.get('/live',(req,res)=>res.json({status:'alive'}));
router.get('/',async(req,res)=>{
 const database=await require('./db').databaseStatus();
 let configuration=true;
 try{require('./runtimeConfig').validateRuntime();}catch{configuration=false;}
 let worker=true;
 if(process.env.REQUIRE_WORKER_HEARTBEAT==='true') {
  try{const r=await require('./db').query("SELECT worker_id FROM worker_heartbeats WHERE role='MESSAGES' AND last_success_at>NOW()-INTERVAL '90 seconds' LIMIT 1");worker=r.rows.length>0;}catch{worker=false;}
 }
 const skillCheck=require('./skillStatus').check();
 const ready=database.connected&&configuration&&worker&&skillCheck.ok;
 res.status(ready?200:503).json({graphics:require('./botCapabilities').describe().graphics,skillCheck,features:{dynamicUnderstanding:process.env.DYNAMIC_CONVERSATION_ENABLED==='true',scopedAutomation:require('./scopedAuthority').enabled(),unifiedPortalAgent:require('./unifiedPortalAgent').enabled(),modelEvaluationRequired:process.env.TASK_AGENT_REQUIRE_EVAL==='true',modelEvaluationOnStart:process.env.TASK_AGENT_EVALUATE_ON_START==='true'},release:process.env.RENDER_GIT_COMMIT||null,status:ready?'ready':'not_ready',database:database.connected,configuration,worker,conversation:{controller:process.env.UNIFIED_CONVERSATION_ENABLED==='true'?'unified':'legacy',planningReady:require('./taskAgent').enabled()},taskAgent:{configured:process.env.TASK_AGENT_ENABLED==='true',enabled:require('./taskAgent').enabled(),pilotOnly:process.env.TASK_AGENT_PILOT_ONLY==='true',evaluation:require('./taskEvaluation').status()},readOnly:process.env.READ_ONLY!=='false',metaWritesEnabled:process.env.META_WRITES_ENABLED==='true',whatsappSendsEnabled:process.env.WHATSAPP_SEND_ENABLED==='true'});
});
module.exports=router;
