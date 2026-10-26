'use strict';
const crypto=require('node:crypto');
const db=require('./db');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const COOKIE='bachat_session';
function accounts() {
 const values=JSON.parse(process.env.DASHBOARD_ACCOUNTS||'[]');
 if(!Array.isArray(values)||values.some(a=>!/^\d+$/.test(String(a.clientId))||!['owner','viewer'].includes(a.role)||!/^[a-f0-9]{64}$/.test(a.tokenHash||''))) throw Error('INVALID_DASHBOARD_ACCOUNTS');
 return values;
}
function cookie(req) {return String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';}
function setCookie(res,value,age) {res.setHeader('Set-Cookie',`${COOKIE}=${value}; Path=/app; HttpOnly; SameSite=Strict; Max-Age=${age}${process.env.NODE_ENV==='production'?'; Secure':''}`);}
function guardOrigin(req,res,next) {
 if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
 let expected;try{expected=new URL(process.env.DASHBOARD_ORIGIN||process.env.APP_PUBLIC_URL).origin;}catch{return res.status(503).json({code:'DASHBOARD_ORIGIN_REQUIRED'});}
 if(req.headers.origin!==expected||req.headers['x-dashboard-request']!=='1')return res.status(403).json({code:'INVALID_ORIGIN'});
 next();
}
async function authenticate(req,res,next) {
 try {
 const raw=cookie(req);if(!/^[a-f0-9]{64}$/.test(raw))return res.status(401).json({code:'LOGIN_REQUIRED'});
 const r=await db.query('SELECT client_id,account_hash FROM dashboard_sessions WHERE token_hash=$1 AND expires_at>NOW()',[hash(raw)]);
 const s=r.rows[0], account=s&&accounts().find(a=>String(a.clientId)===String(s.client_id)&&a.tokenHash===s.account_hash);
 if(!account)return res.status(401).json({code:'LOGIN_REQUIRED'});
 req.dashboard={clientId:String(account.clientId),role:account.role};next();
 }catch{res.status(503).json({code:'DASHBOARD_UNAVAILABLE'});}
}
async function login(req,res) {
 try {
 const token=String(req.body?.token||'');
 if(token.length<32||token.length>256)return res.status(401).json({code:'INVALID_LOGIN'});
 // A persistent bucket limits brute force across processes. Token contents are never stored or logged.
 const bucket='dashboard-login:'+hash(req.ip||'unknown');
 const attempt=await db.query(`INSERT INTO api_rate_limits(bucket,attempts,expires_at) VALUES($1,1,NOW()+INTERVAL '15 minutes') ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN api_rate_limits.expires_at<NOW() THEN 1 ELSE api_rate_limits.attempts+1 END,expires_at=CASE WHEN api_rate_limits.expires_at<NOW() THEN NOW()+INTERVAL '15 minutes' ELSE api_rate_limits.expires_at END RETURNING attempts`,[bucket]);
 if(attempt.rows[0].attempts>15)return res.status(429).json({code:'RATE_LIMITED'});
 const digest=hash(token),account=accounts().find(a=>crypto.timingSafeEqual(Buffer.from(a.tokenHash),Buffer.from(digest)));
 if(!account)return res.status(401).json({code:'INVALID_LOGIN'});
 const exists=await db.query('SELECT id FROM clients WHERE id=$1',[account.clientId]);
 if(!exists.rows.length)return res.status(401).json({code:'INVALID_LOGIN'});
 const raw=crypto.randomBytes(32).toString('hex');
 await db.transaction(async tx=>{await tx('DELETE FROM dashboard_sessions WHERE expires_at<NOW()');await tx("INSERT INTO dashboard_sessions(token_hash,client_id,account_hash,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '8 hours')",[hash(raw),account.clientId,account.tokenHash]);});
 setCookie(res,raw,28800);res.json({ok:true});
 }catch{res.status(503).json({code:'DASHBOARD_UNAVAILABLE'});}
}
async function logout(req,res) {await db.query('DELETE FROM dashboard_sessions WHERE token_hash=$1',[hash(cookie(req))]);setCookie(res,'',0);res.json({ok:true});}
module.exports={hash,accounts,authenticate,guardOrigin,login,logout};
