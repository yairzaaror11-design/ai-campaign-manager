'use strict';
const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const axios = require('axios');
const db = require('./db');
const context = new AsyncLocalStorage();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const random = () => crypto.randomBytes(32).toString('base64url');
function key() {
  const value = Buffer.from(process.env.META_TOKEN_ENCRYPTION_KEY || '', 'base64');
  if (value.length !== 32) throw Error('META_ENCRYPTION_KEY_REQUIRED');
  return value;
}
function encrypt(token, clientId) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(String(clientId)));
  const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}
function decrypt(value, clientId) {
  const bytes = Buffer.from(value, 'base64');
  const cipher = crypto.createDecipheriv('aes-256-gcm', key(), bytes.subarray(0,12));
  cipher.setAAD(Buffer.from(String(clientId)));
  cipher.setAuthTag(bytes.subarray(12,28));
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
}
function config() {
  key();
  const origin = new URL(process.env.APP_PUBLIC_URL);
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw Error('HTTPS_APP_ORIGIN_REQUIRED');
  if (!/^\d+$/.test(process.env.META_APP_ID || '') || !process.env.META_APP_SECRET || !/^\d+$/.test(process.env.META_LOGIN_CONFIG_ID || '')) throw Error('META_LOGIN_CONFIG_REQUIRED');
  return { origin: origin.origin, redirect: origin.origin + '/auth/meta/callback', version: process.env.META_GRAPH_VERSION || 'v26.0' };
}
async function graph(path, token, params = {}) {
  const proof = crypto.createHmac('sha256', process.env.META_APP_SECRET).update(token).digest('hex');
  try {
    return (await axios.get('https://graph.facebook.com/' + config().version + path, {
      headers: { Authorization: 'Bearer ' + token }, params: {...params, appsecret_proof: proof}, timeout:15000, maxRedirects:0
    })).data;
  } catch { throw Error('META_REQUEST_FAILED'); }
}
async function createInvite(clientId) {
  config();
  const value = random();
  await db.query(`INSERT INTO meta_login_secrets(secret_hash,client_id,kind,generation,expires_at) SELECT $1,id,'INVITE',meta_generation,NOW()+INTERVAL '10 minutes' FROM clients WHERE id=$2`,[hash(value),clientId]);
  // Fragment keeps the bearer invite out of request URLs and proxy logs.
  return config().origin + '/auth/meta/connect#' + value;
}
async function consume(value, kind, binding = null) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(value))) throw Error('INVALID_LOGIN');
  const result = await db.query(`DELETE FROM meta_login_secrets WHERE secret_hash=$1 AND kind=$2 AND expires_at>NOW() AND ($3::text IS NULL OR binding_hash=$3) RETURNING client_id,generation`,[hash(value),kind,binding && hash(binding)]);
  if (!result.rows.length) throw Error('INVALID_LOGIN');
  return result.rows[0];
}
async function begin(invite) {
  const cfg = config();
  const {client_id:clientId,generation} = await consume(invite,'INVITE');
  const state = random(), browser = random();
  await db.query(`INSERT INTO meta_login_secrets(secret_hash,client_id,kind,binding_hash,generation,expires_at) VALUES($1,$2,'STATE',$3,$4,NOW()+INTERVAL '10 minutes')`,[hash(state),clientId,hash(browser),generation]);
  const params = new URLSearchParams({client_id:process.env.META_APP_ID,redirect_uri:cfg.redirect,response_type:'code',state,config_id:process.env.META_LOGIN_CONFIG_ID});
  return {url:'https://www.facebook.com/'+cfg.version+'/dialog/oauth?'+params,browser};
}
async function callback(state, browser, code) {
  if (!browser) throw Error('INVALID_LOGIN');
  const {client_id:clientId,generation} = await consume(state,'STATE',browser);
  if (typeof code !== 'string' || !code || code.length>4096) throw Error('INVALID_CODE');
  let data;
  try {
    data = (await axios.post('https://graph.facebook.com/'+config().version+'/oauth/access_token',new URLSearchParams({client_id:process.env.META_APP_ID,client_secret:process.env.META_APP_SECRET,redirect_uri:config().redirect,code}),{timeout:15000,maxRedirects:0})).data;
  } catch { throw Error('META_LOGIN_FAILED'); }
  if (!data.access_token || !Number.isFinite(data.expires_in) || data.expires_in<=0) throw Error('EXPIRING_USER_TOKEN_REQUIRED');
  const user = await graph('/me',data.access_token,{fields:'id'});
  const permissions = await graph('/me/permissions',data.access_token);
  if (!permissions.data?.some(p=>p.permission==='ads_read' && p.status==='granted')) throw Error('ADS_READ_REQUIRED');
  const encrypted = encrypt(data.access_token,clientId);
  await db.transaction(async tx => {
    const locked = await tx('SELECT meta_generation FROM clients WHERE id=$1 FOR UPDATE',[clientId]);
    if (String(locked.rows[0]?.meta_generation)!==String(generation)) throw Error('CONNECTION_REVOKED');
    await tx(`INSERT INTO meta_connections(client_id,meta_user_id,token_ciphertext,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(client_id) DO UPDATE SET meta_user_id=$2,token_ciphertext=$3,expires_at=$4`,[clientId,user.id,encrypted,new Date(Date.now()+data.expires_in*1000)]);
    await tx('UPDATE clients SET meta_ad_account_id=NULL WHERE id=$1',[clientId]);
  });
  return clientId;
}
async function credentials(clientId) {
  const r = await db.query('SELECT m.*,c.meta_ad_account_id FROM meta_connections m JOIN clients c ON c.id=m.client_id WHERE m.client_id=$1 AND m.expires_at>NOW()',[clientId]);
  if (!r.rows.length) throw Error('META_CONNECTION_REQUIRED');
  return {...r.rows[0],token:decrypt(r.rows[0].token_ciphertext,clientId)};
}
async function accounts(clientId) {
  const c = await credentials(clientId);
  return graph('/me/adaccounts',c.token,{fields:'id,name,currency,account_status',limit:100});
}
async function selectAccount(clientId,accountId) {
  if (!/^act_\d+$/.test(accountId)) throw Error('INVALID_ACCOUNT');
  await db.transaction(async tx => {
    await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[clientId]);
    const list = await accounts(clientId);
    if (!list.data?.some(a=>a.id===accountId && a.account_status===1)) throw Error('ACCOUNT_NOT_GRANTED');
    await tx('UPDATE clients SET meta_ad_account_id=$2 WHERE id=$1',[clientId,accountId]);
  });
}
async function disconnect(clientId) {
  await db.transaction(async tx => {
    await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[clientId]);
    await tx('DELETE FROM meta_connections WHERE client_id=$1',[clientId]);
    await tx('DELETE FROM meta_login_secrets WHERE client_id=$1',[clientId]);
    await tx('UPDATE clients SET meta_ad_account_id=NULL,meta_generation=meta_generation+1 WHERE id=$1',[clientId]);
    await tx("UPDATE approvals SET status='CANCELLED' WHERE client_id=$1 AND status='PENDING'",[clientId]);
  });
}
async function tenantRead(path,params) {
  const clientId = context.getStore();
  if (!clientId) throw Error('TENANT_CONTEXT_REQUIRED');
  const c = await credentials(clientId);
  if (path==='/me/adaccounts') return graph(path,c.token,params);
  if (!c.meta_ad_account_id) throw Error('ACCOUNT_SELECTION_REQUIRED');
  const id = path.split('/')[1];
  if (id.startsWith('act_')) {
    if (id!==c.meta_ad_account_id) throw Error('TENANT_ACCOUNT_MISMATCH');
  } else {
    if (!/^\d+$/.test(id)) throw Error('INVALID_META_OBJECT');
    const object = await graph('/'+id,c.token,{fields:'account_id'});
    if ('act_'+object.account_id!==c.meta_ad_account_id) throw Error('TENANT_ACCOUNT_MISMATCH');
  }
  return graph(path,c.token,params);
}
module.exports = {hash,encrypt,decrypt,config,createInvite,begin,callback,consume,credentials,accounts,selectAccount,disconnect,tenantRead,context,graph};
