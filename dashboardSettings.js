'use strict';
const express=require('express');
const {randomUUID,randomBytes}=require('node:crypto');
const db=require('./db');
const {hash}=require('./dashboardAuth');
const router=express.Router();
const locales=['he','en','es','de','fr','pt'];
const scopes=['overview:read','leads:read'];
const error=(code,status=400)=>Object.assign(Error(code),{status});
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
const owner=(req,res,next)=>req.dashboard.role==='owner'?next():res.status(403).json({code:'PERMISSION_DENIED'});
async function audit(tx,id,event,result){await tx('INSERT INTO tenant_audit(client_id,event,result) VALUES($1,$2,$3)',[id,event,result]);}
async function profile(clientId,email=null){
 const r=await db.query('SELECT c.display_name AS default_name,p.display_name,p.locale,p.revision,p.updated_at,(p.avatar_png IS NOT NULL) AS has_avatar FROM clients c LEFT JOIN dashboard_profiles p ON p.client_id=c.id WHERE c.id=$1',[clientId]);
 if(!r.rows.length)throw error('NOT_FOUND',404);
 const p=r.rows[0];
 return {displayName:p.display_name||p.default_name||'העסק שלי',email,locale:p.locale||'he',revision:p.revision||0,hasAvatar:!!p.has_avatar,updatedAt:p.updated_at||null};
}
router.get('/settings',wrap(async(req,res)=>{
 const meta=require('./metaConnection'),social=require('./socialConnections');
 const [p,connection,keys,connections]=await Promise.all([profile(req.dashboard.clientId,req.dashboard.email),db.query('SELECT c.meta_ad_account_id,m.expires_at,m.app_id FROM clients c LEFT JOIN meta_connections m ON m.client_id=c.id WHERE c.id=$1',[req.dashboard.clientId]),db.query('SELECT id,name,prefix,scopes,created_at,expires_at,last_used_at,revoked_at FROM dashboard_api_keys WHERE client_id=$1 ORDER BY created_at DESC LIMIT 100',[req.dashboard.clientId]),social.list(req.dashboard.clientId)]);
 let metaConfigured=false;try{meta.config();metaConfigured=true;}catch{}
 const m=connection.rows[0];
 const support=process.env.SUPPORT_CONTACT_EMAIL||process.env.PRIVACY_CONTACT_EMAIL||'';
 res.json({profile:p,meta:{configured:metaConfigured,connected:!!(m?.app_id===process.env.META_APP_ID&&m?.expires_at&&new Date(m.expires_at)>new Date()),accountId:m?.meta_ad_account_id||null,expiresAt:m?.expires_at||null},apiKeys:keys.rows,social:connections,supportEmail:/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(support)?support:null});
}));
router.patch('/settings/profile',owner,wrap(async(req,res)=>{
 const {displayName,locale,revision}=req.body||{};
 if(typeof displayName!=='string'||!displayName.trim()||displayName.trim().length>120||!locales.includes(locale)||!Number.isSafeInteger(revision)||revision<0||Object.keys(req.body).some(k=>!['displayName','locale','revision'].includes(k)))throw error('INVALID_PROFILE');
 await db.transaction(async tx=>{
 const r=await tx(`INSERT INTO dashboard_profiles(client_id,display_name,locale) SELECT $1,$2,$3 WHERE $4::int=0 ON CONFLICT(client_id) DO UPDATE SET display_name=$2,locale=$3,revision=dashboard_profiles.revision+1,updated_at=NOW() WHERE dashboard_profiles.revision=$4 RETURNING revision`,[req.dashboard.clientId,displayName.trim(),locale,revision]);
 if(!r.rows.length){const update=await tx('UPDATE dashboard_profiles SET display_name=$2,locale=$3,revision=revision+1,updated_at=NOW() WHERE client_id=$1 AND revision=$4 RETURNING revision',[req.dashboard.clientId,displayName.trim(),locale,revision]);if(!update.rows.length)throw error('PROFILE_CONFLICT',409);}
 await audit(tx,req.dashboard.clientId,'DASHBOARD_PROFILE_UPDATED','SAVED');
 });res.json(await profile(req.dashboard.clientId,req.dashboard.email));
}));
router.post('/settings/avatar',owner,express.raw({type:['image/png','image/jpeg','image/gif'],limit:'5mb'}),wrap(async(req,res)=>{
 if(!Buffer.isBuffer(req.body)||!req.body.length)throw error('INVALID_IMAGE');
 let png;try{const sharp=require('sharp'),image=sharp(req.body,{limitInputPixels:16777216,failOn:'warning',animated:false});const info=await image.metadata();if(!['png','jpeg','gif'].includes(info.format))throw Error();png=await image.rotate().resize(512,512,{fit:'inside',withoutEnlargement:true}).png().toBuffer();if(png.length>1048576)throw Error();}catch{throw error('INVALID_IMAGE');}
 await db.transaction(async tx=>{await tx(`INSERT INTO dashboard_profiles(client_id,display_name,avatar_png) SELECT id,COALESCE(NULLIF(display_name,''),'העסק שלי'),$2 FROM clients WHERE id=$1 ON CONFLICT(client_id) DO UPDATE SET avatar_png=$2,revision=dashboard_profiles.revision+1,updated_at=NOW()`,[req.dashboard.clientId,png]);await audit(tx,req.dashboard.clientId,'DASHBOARD_AVATAR_UPDATED','SAVED');});res.json(await profile(req.dashboard.clientId,req.dashboard.email));
}));
router.get('/settings/avatar',wrap(async(req,res)=>{const r=await db.query('SELECT avatar_png FROM dashboard_profiles WHERE client_id=$1',[req.dashboard.clientId]);if(!r.rows[0]?.avatar_png)return res.sendStatus(404);res.set({'Content-Type':'image/png','X-Content-Type-Options':'nosniff'}).send(Buffer.from(r.rows[0].avatar_png));}));
router.post('/settings/api-keys',owner,wrap(async(req,res)=>{
 const name=req.body?.name,requested=req.body?.scopes;
 if(typeof name!=='string'||!name.trim()||name.length>80||!Array.isArray(requested)||!requested.length||new Set(requested).size!==requested.length||requested.some(s=>!scopes.includes(s)))throw error('INVALID_KEY');
 const token='cb_live_'+randomBytes(32).toString('base64url'),id=randomUUID();
 await db.transaction(async tx=>{await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[req.dashboard.clientId]);const count=await tx('SELECT count(*)::int AS n FROM dashboard_api_keys WHERE client_id=$1 AND revoked_at IS NULL AND expires_at>NOW()',[req.dashboard.clientId]);if(count.rows[0].n>=10)throw error('KEY_LIMIT',409);await tx("INSERT INTO dashboard_api_keys(id,client_id,token_hash,prefix,name,scopes,expires_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,NOW()+INTERVAL '90 days')",[id,req.dashboard.clientId,hash(token),token.slice(0,16),name.trim(),JSON.stringify(requested)]);await audit(tx,req.dashboard.clientId,'DASHBOARD_API_KEY_CREATED',id);});
 res.status(201).json({id,token});
}));
router.post('/settings/api-keys/:id/revoke',owner,wrap(async(req,res)=>{
 if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(req.params.id))throw error('INVALID_KEY');
 await db.transaction(async tx=>{const r=await tx('UPDATE dashboard_api_keys SET revoked_at=COALESCE(revoked_at,NOW()) WHERE client_id=$1 AND id=$2 RETURNING id',[req.dashboard.clientId,req.params.id]);if(!r.rows.length)throw error('NOT_FOUND',404);await audit(tx,req.dashboard.clientId,'DASHBOARD_API_KEY_REVOKED',req.params.id);});res.json({ok:true});
}));
router.post('/settings/meta/connect',owner,wrap(async(req,res)=>{const url=await require('./metaConnection').createInvite(req.dashboard.clientId);res.json({url});}));
router.get('/settings/meta/accounts',owner,wrap(async(req,res)=>{const r=await require('./metaConnection').accounts(req.dashboard.clientId);res.json({items:(r.data||[]).map(a=>({id:a.id,name:a.name,currency:a.currency}))});}));
router.post('/settings/meta/account',owner,wrap(async(req,res)=>{if(!/^act_\d+$/.test(req.body?.accountId))throw error('INVALID_ACCOUNT');await require('./metaConnection').selectAccount(req.dashboard.clientId,req.body.accountId);res.json({ok:true});}));
router.post('/settings/social/:provider/connect',owner,wrap(async(req,res)=>{const start=await require('./socialConnections').begin(req.dashboard.clientId,req.params.provider,req.dashboard.actorHash);require('./socialConnections').setBinding(res,req.params.provider,start.binding);res.json({url:start.url});}));
router.post('/settings/social/:provider/account',owner,wrap(async(req,res)=>{await require('./socialConnections').selectAccount(req.dashboard.clientId,req.params.provider,req.body?.accountId);res.json({ok:true});}));
router.post('/settings/social/:provider/disconnect',owner,wrap(async(req,res)=>{await require('./socialConnections').disconnect(req.dashboard.clientId,req.params.provider);res.json({ok:true});}));
module.exports={router,profile,locales};
