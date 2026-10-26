'use strict';
const express=require('express'),db=require('./db');
const {hash}=require('./dashboardAuth');
const router=express.Router();
router.use(async(req,res,next)=>{
 res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 try{
 const token=String(req.headers.authorization||'').match(/^Bearer (cb_live_[A-Za-z0-9_-]{43})$/)?.[1];
 if(!token)return res.status(401).json({code:'API_KEY_REQUIRED'});
 const r=await db.query('SELECT id,client_id,scopes FROM dashboard_api_keys WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>NOW()',[hash(token)]);
 if(!r.rows.length)return res.status(401).json({code:'API_KEY_INVALID'});
 const key=r.rows[0];const rate=await db.query(`INSERT INTO api_rate_limits(bucket,attempts,expires_at) VALUES($1,1,NOW()+INTERVAL '1 minute') ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN api_rate_limits.expires_at<NOW() THEN 1 ELSE api_rate_limits.attempts+1 END,expires_at=CASE WHEN api_rate_limits.expires_at<NOW() THEN NOW()+INTERVAL '1 minute' ELSE api_rate_limits.expires_at END RETURNING attempts`,['public-api:'+key.id]);
 if(rate.rows[0].attempts>60)return res.status(429).json({code:'RATE_LIMITED'});
 await db.query('UPDATE dashboard_api_keys SET last_used_at=NOW() WHERE id=$1',[key.id]);req.apiKey=key;next();
 }catch{res.status(503).json({code:'API_UNAVAILABLE'});}
});
const scope=name=>(req,res,next)=>req.apiKey.scopes.includes(name)?next():res.status(403).json({code:'SCOPE_REQUIRED'});
router.get('/overview',scope('overview:read'),async(req,res)=>{try{const d=await require('./dashboard').overview(String(req.apiKey.client_id),req.query.period||'last_7d');res.json({period:d.period,currency:d.currency,sync:d.sync,metrics:d.metrics,campaigns:d.campaigns});}catch(e){res.status(e.status||503).json({code:e.status?e.message:'API_UNAVAILABLE'});}});
router.get('/leads',scope('leads:read'),async(req,res)=>{try{const offset=Number(req.query.offset||0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)return res.status(400).json({code:'INVALID_OFFSET'});const r=await db.query('SELECT id,name,phone,email,status,source,created_at,updated_at FROM dashboard_leads WHERE client_id=$1 ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET $2',[req.apiKey.client_id,offset]);res.json({items:r.rows.slice(0,50),hasMore:r.rows.length>50});}catch{res.status(503).json({code:'API_UNAVAILABLE'});}});
router.use((req,res)=>res.status(404).json({code:'NOT_FOUND'}));
module.exports=router;
