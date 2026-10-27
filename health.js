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
 const ready=database.connected&&configuration&&worker;
 res.status(ready?200:503).json({status:ready?'ready':'not_ready',database:database.connected,configuration,worker,readOnly:process.env.READ_ONLY!=='false',metaWritesEnabled:process.env.META_WRITES_ENABLED==='true',whatsappSendsEnabled:process.env.WHATSAPP_SEND_ENABLED==='true'});
});
module.exports=router;
