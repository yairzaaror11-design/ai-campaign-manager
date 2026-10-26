'use strict';
const express=require('express');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const db=require('./db');
const auth=require('./dashboardAuth');
const router=express.Router();
const statuses=['NEW','CONTACTED','IN_PROGRESS','MEETING','WON','LOST','IRRELEVANT'];
const periodDays={last_7d:7,last_30d:30,last_90d:90};
function period(value){if(!Object.hasOwn(periodDays,value))throw Object.assign(Error('INVALID_PERIOD'),{status:400});return value;}
function text(value,max,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw Object.assign(Error('INVALID_INPUT'),{status:400});return value.trim();}
function canWrite(req,res,next){if(req.dashboard.role!=='owner')return res.status(403).json({code:'PERMISSION_DENIED'});next();}
const route=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
async function overview(clientId,preset) {
 const days=periodDays[period(preset)];
 const queries=[
 ['SELECT id,display_name,meta_ad_account_id FROM clients WHERE id=$1',[clientId]],
 ['SELECT payload,created_at FROM performance_snapshots WHERE client_id=$1 AND date_preset=$2 AND account_id=(SELECT meta_ad_account_id FROM clients WHERE id=$1) ORDER BY created_at DESC LIMIT 1',[clientId,preset]],
 ["SELECT count(*)::int AS total FROM dashboard_leads WHERE client_id=$1 AND created_at>=NOW()-($2::int*INTERVAL '1 day')",[clientId,days]],
 ["SELECT a.id,p.intent,a.status,a.created_at,a.expires_at FROM approvals a JOIN action_plans p ON p.id=a.action_id AND p.client_id=a.client_id WHERE a.client_id=$1 AND a.status='PENDING' AND a.expires_at>NOW() ORDER BY a.created_at DESC LIMIT 50",[clientId]],
 ['SELECT id,status,revision,updated_at FROM campaign_lifecycles WHERE client_id=$1 ORDER BY updated_at DESC LIMIT 100',[clientId]],
 ['SELECT event,result,created_at FROM tenant_audit WHERE client_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50',[clientId]],
 ['SELECT EXISTS(SELECT 1 FROM meta_connections WHERE client_id=$1 AND expires_at>NOW()) AS connected',[clientId]]
 ];
 const [client,snap,leads,approvals,drafts,activity,connection]=await Promise.all(queries.map(([q,p])=>db.query(q,p)));
 if(!client.rows.length)throw Object.assign(Error('NOT_FOUND'),{status:404});
 const snapshot=snap.rows[0],payload=snapshot?.payload;
 return {business:{id:String(clientId),name:client.rows[0].display_name||'העסק שלי',accountId:client.rows[0].meta_ad_account_id},period:preset,currency:payload?.account?.currency||null,sync:{lastSyncedAt:snapshot?.created_at||null,status:snapshot?'cached':'empty',connected:connection.rows[0].connected},metrics:{spend:payload?.totals?.spend??null,impressions:payload?.totals?.impressions??null,clicks:payload?.totals?.clicks??null,leads:leads.rows[0].total,cpl:null,activeCampaigns:null,pendingApprovals:approvals.rows.length},campaigns:payload?.campaigns||[],approvals:approvals.rows,drafts:drafts.rows,activity:activity.rows};
}
router.use((req,res,next)=>{res.set({'Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'X-Frame-Options':'DENY'});next();});
router.use('/assets',express.static(path.join(__dirname,'dashboard-public'),{index:false}));
router.use('/api',auth.guardOrigin);
router.post('/api/login',route(auth.login));
router.use('/api',auth.authenticate);
router.post('/api/logout',route(auth.logout));
router.get('/api/me',(req,res)=>res.json({role:req.dashboard.role,clientId:req.dashboard.clientId}));
router.get('/api/overview',route(async(req,res)=>res.json(await overview(req.dashboard.clientId,period(req.query.period||'last_7d')))));
router.post('/api/sync',canWrite,route(async(req,res)=>{
 const preset=period(req.body.period||'last_7d');
 if(preset==='last_90d')throw Object.assign(Error('SYNC_PERIOD_UNSUPPORTED'),{status:400});
 const bucket='dashboard-sync:'+req.dashboard.clientId;
 const permitted=await db.query(`INSERT INTO api_rate_limits(bucket,attempts,expires_at) VALUES($1,1,NOW()+INTERVAL '1 minute') ON CONFLICT(bucket) DO UPDATE SET attempts=1,expires_at=EXCLUDED.expires_at WHERE api_rate_limits.expires_at<NOW() RETURNING bucket`,[bucket]);
 if(!permitted.rows.length)throw Object.assign(Error('SYNC_RATE_LIMITED'),{status:429});
 const meta=require('./metaConnection');
 await meta.context.run(req.dashboard.clientId,()=>require('./reportService').campaignReport(req.dashboard.clientId,preset));
 await db.query("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'DASHBOARD_REPORT_SYNC','SAVED')",[req.dashboard.clientId]);
 res.json({ok:true});
}));
router.get('/api/leads',route(async(req,res)=>{
 const p=[req.dashboard.clientId],where=['client_id=$1'];
 if(req.query.q){p.push('%'+text(req.query.q,120)+'%');where.push(`(name ILIKE $${p.length} OR phone ILIKE $${p.length} OR email ILIKE $${p.length})`);}
 if(req.query.status){if(!statuses.includes(req.query.status))throw Object.assign(Error('INVALID_STATUS'),{status:400});p.push(req.query.status);where.push(`status=$${p.length}`);}
 const offset=Number(req.query.offset||0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw Object.assign(Error('INVALID_OFFSET'),{status:400});
 p.push(offset);const result=await db.query(`SELECT id,name,phone,email,source,status,notes,created_at,updated_at FROM dashboard_leads WHERE ${where.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET $${p.length}`,p);
 res.json({items:result.rows.slice(0,50),hasMore:result.rows.length>50});
}));
router.post('/api/leads',canWrite,route(async(req,res)=>{
 const name=text(req.body.name,120,true),phone=text(req.body.phone||'',30),email=text(req.body.email||'',254),notes=text(req.body.notes||'',4000);
 if(phone&&!/^\+[1-9]\d{6,14}$/.test(phone)||email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Object.assign(Error('INVALID_CONTACT'),{status:400});
 const id=randomUUID();await db.transaction(async tx=>{await tx('INSERT INTO dashboard_leads(id,client_id,name,phone,email,notes) VALUES($1,$2,$3,$4,$5,$6)',[id,req.dashboard.clientId,name,phone,email,notes]);await tx("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'DASHBOARD_LEAD_CREATED',$2)",[req.dashboard.clientId,id]);});res.status(201).json({id});
}));
router.patch('/api/leads/:id',canWrite,route(async(req,res)=>{
 if(!/^[0-9a-f-]{36}$/.test(req.params.id)||!statuses.includes(req.body.status))throw Object.assign(Error('INVALID_INPUT'),{status:400});
 await db.transaction(async tx=>{const r=await tx('UPDATE dashboard_leads SET status=$3,updated_at=NOW() WHERE client_id=$1 AND id=$2 RETURNING id',[req.dashboard.clientId,req.params.id,req.body.status]);if(!r.rows.length)throw Object.assign(Error('NOT_FOUND'),{status:404});await tx("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'DASHBOARD_LEAD_STATUS',$2)",[req.dashboard.clientId,req.body.status]);});res.json({ok:true});
}));
router.get('/api/tasks',route(async(req,res)=>res.json({items:(await db.query('SELECT id,title,due_at,status FROM dashboard_tasks WHERE client_id=$1 ORDER BY created_at DESC LIMIT 100',[req.dashboard.clientId])).rows})));
router.post('/api/tasks',canWrite,route(async(req,res)=>{
 const title=text(req.body.title,200,true),due=req.body.due_at||null;
 if(due&&(!/^\d{4}-\d{2}-\d{2}$/.test(due)||!Number.isFinite(Date.parse(due))))throw Object.assign(Error('INVALID_DATE'),{status:400});
 const id=randomUUID();await db.transaction(async tx=>{await tx('INSERT INTO dashboard_tasks(id,client_id,title,due_at) VALUES($1,$2,$3,$4)',[id,req.dashboard.clientId,title,due]);await tx("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'DASHBOARD_TASK_CREATED',$2)",[req.dashboard.clientId,id]);});res.status(201).json({id});
}));
router.patch('/api/tasks/:id',canWrite,route(async(req,res)=>{
 if(!/^[0-9a-f-]{36}$/.test(req.params.id)||!['OPEN','DONE'].includes(req.body.status))throw Object.assign(Error('INVALID_INPUT'),{status:400});
 await db.transaction(async tx=>{const r=await tx('UPDATE dashboard_tasks SET status=$3 WHERE client_id=$1 AND id=$2 RETURNING id',[req.dashboard.clientId,req.params.id,req.body.status]);if(!r.rows.length)throw Object.assign(Error('NOT_FOUND'),{status:404});await tx("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'DASHBOARD_TASK_STATUS',$2)",[req.dashboard.clientId,req.body.status]);});res.json({ok:true});
}));
router.get('/api/conversation',route(async(req,res)=>{
 const id=req.dashboard.clientId;
 const [messages,profile]=await Promise.all([db.query('SELECT role,content,created_at FROM (SELECT id,role,content,created_at FROM conversation_messages WHERE client_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100) m ORDER BY created_at,id',[id]),db.query('SELECT payload,updated_at FROM marketing_profiles WHERE client_id=$1',[id])]);
 const p=profile.rows[0]?.payload;
 res.json({messages:messages.rows,profile:p?{answers:p.answers||{},stage:p.journey?.stage||null,updated_at:profile.rows[0].updated_at}:null});
}));
router.use('/api',require('./dashboardSettings').router);
router.get(['/', '/settings', '/demo', '/campaigns','/crm','/tasks','/chat','/activity','/integrations','/billing'],(req,res)=>res.sendFile(path.join(__dirname,'dashboard-public','index.html')));
router.use('/api',(req,res)=>res.status(404).json({code:'NOT_FOUND'}));
router.use((err,req,res,next)=>{if(res.headersSent)return next(err);res.status(err.status||503).json({code:err.status?err.message:'DASHBOARD_UNAVAILABLE'});});
module.exports={router,overview,statuses,period};
