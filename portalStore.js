'use strict';
const crypto=require('node:crypto'),db=require('./db');
const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
function origin(){const u=new URL(process.env.APP_PUBLIC_URL||'');if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('PUBLIC_ORIGIN_REQUIRED');return u.origin;}
async function createTicket(clientId){
 const token=crypto.randomBytes(32).toString('hex');
 await db.transaction(async tx=>{
  const c=await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[clientId]);if(!c.rows.length)throw Error('CLIENT_NOT_FOUND');
  await tx('DELETE FROM portal_login_tickets WHERE client_id=$1',[clientId]);
  await tx("INSERT INTO portal_login_tickets(token_hash,client_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '10 minutes')",[hash(token),clientId]);
  await tx("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'PORTAL_LINK','ISSUED')",[clientId]);
 });return origin()+'/app#login='+token;
}
async function redeem(token){
 if(typeof token!=='string'||!(/^[a-f0-9]{64}$/).test(token))throw Error('INVALID_PORTAL_LINK');
 const session=crypto.randomBytes(32).toString('hex'),csrf=crypto.randomBytes(24).toString('hex');
 const result=await db.transaction(async tx=>{
  // Atomic single-use redemption; the client FK and lock prevent resurrection after deletion.
  const r=await tx('SELECT client_id FROM portal_login_tickets WHERE token_hash=$1',[hash(token)]);if(!r.rows.length)throw Error('INVALID_PORTAL_LINK');
  const c=await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[r.rows[0].client_id]);if(!c.rows.length)throw Error('INVALID_PORTAL_LINK');
  const consumed=await tx('UPDATE portal_login_tickets SET used_at=NOW() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW() RETURNING client_id',[hash(token)]);
  if(!consumed.rows.length)throw Error('INVALID_PORTAL_LINK');
  const clientId=consumed.rows[0].client_id;
  await tx("INSERT INTO portal_sessions(token_hash,client_id,csrf_hash,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '7 days')",[hash(session),clientId,hash(csrf)]);
  await tx("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'PORTAL_LOGIN','SUCCESS')",[clientId]);
  return{clientId};
 });return{...result,session,csrf};
}
function cookies(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(s=>s.trim().split('=')).filter(a=>a.length===2));}
async function authenticate(req,{write=false}={}){
 const token=cookies(req).cb_session;if(!/^[a-f0-9]{64}$/.test(token||''))throw Error('PORTAL_AUTH_REQUIRED');
 const result=await db.query('SELECT client_id,csrf_hash FROM portal_sessions WHERE token_hash=$1 AND expires_at>NOW()',[hash(token)]);
 if(!result.rows.length)throw Error('PORTAL_AUTH_REQUIRED');
 if(write){
  if(req.headers.origin!==origin()||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw Error('PORTAL_CSRF');
  const supplied=hash(req.headers['x-csrf-token']||'');const expected=result.rows[0].csrf_hash;
  if(!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))throw Error('PORTAL_CSRF');
 }
 return{clientId:result.rows[0].client_id,tokenHash:hash(token)};
}
async function register(clientId,{name,email,acceptPrivacy}={}){
 if(typeof name!=='string'||!name.trim()||name.length>120||email&&(typeof email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)||acceptPrivacy!==true)throw Error('INVALID_REGISTRATION');
 await db.transaction(async tx=>{
  await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[clientId]);
  await tx(`INSERT INTO customer_accounts(client_id,display_name,email,consent_version) VALUES($1,$2,$3,'2026-10-26') ON CONFLICT(client_id) DO UPDATE SET display_name=EXCLUDED.display_name,email=EXCLUDED.email,updated_at=NOW()`,[clientId,name.trim(),email||null]);
  await tx("INSERT INTO customer_subscriptions(client_id) VALUES($1) ON CONFLICT DO NOTHING",[clientId]);
  await tx("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'CUSTOMER_REGISTERED','SAME_WHATSAPP_CLIENT')",[clientId]);
 });
 return{registered:true,clientId};
}
module.exports={hash,origin,createTicket,redeem,cookies,authenticate,register};
