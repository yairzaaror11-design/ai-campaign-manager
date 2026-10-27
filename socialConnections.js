// Reused from feature/dashboard-rtl @ 6f55a4d; portal session adapter only.
'use strict';
const express=require('express'),axios=require('axios'),crypto=require('node:crypto'),db=require('./db'),meta=require('./metaConnection');
const providers={
 facebook:{label:'Facebook',prefix:'FACEBOOK',authorize:'https://www.facebook.com/v26.0/dialog/oauth',token:'https://graph.facebook.com/v26.0/oauth/access_token',scopes:['pages_show_list','pages_read_engagement','pages_manage_posts']},
 instagram:{label:'Instagram',prefix:'INSTAGRAM',authorize:'https://www.facebook.com/v26.0/dialog/oauth',token:'https://graph.facebook.com/v26.0/oauth/access_token',scopes:['pages_show_list','pages_read_engagement','instagram_basic','instagram_content_publish']},
 linkedin:{label:'LinkedIn',prefix:'LINKEDIN',authorize:'https://www.linkedin.com/oauth/v2/authorization',token:'https://www.linkedin.com/oauth/v2/accessToken',scopes:['openid','profile','w_member_social']},
 tiktok:{label:'TikTok',prefix:'TIKTOK',authorize:'https://www.tiktok.com/v2/auth/authorize/',token:'https://open.tiktokapis.com/v2/oauth/token/',scopes:['user.info.basic','video.publish']},
 youtube:{label:'YouTube',prefix:'YOUTUBE',authorize:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',scopes:['https://www.googleapis.com/auth/youtube.readonly','https://www.googleapis.com/auth/youtube.upload']},
 x:{label:'X (Twitter)',prefix:'X',authorize:'https://x.com/i/oauth2/authorize',token:'https://api.x.com/2/oauth2/token',scopes:['tweet.read','tweet.write','users.read','offline.access'],pkce:true}
};
const pLabel=name=>providers[name].label;
const fail=(code,status=400)=>Object.assign(Error(code),{status});
const random=()=>crypto.randomBytes(32).toString('base64url');
function provider(name){if(!Object.hasOwn(providers,name))throw fail('INVALID_PROVIDER');return providers[name];}
function config(name){
 const p=provider(name),id=process.env['SOCIAL_'+p.prefix+'_CLIENT_ID'],secret=process.env['SOCIAL_'+p.prefix+'_CLIENT_SECRET'];
 const origin=new URL(process.env.APP_PUBLIC_URL||'https://invalid.local');
 if(!id||!secret||origin.protocol!=='https:'||origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password||origin.hostname==='invalid.local'||(process.env.DASHBOARD_ORIGIN&&new URL(process.env.DASHBOARD_ORIGIN).origin!==origin.origin))throw fail('PROVIDER_NOT_CONFIGURED',503);
 const key=Buffer.from(process.env.META_TOKEN_ENCRYPTION_KEY||'','base64');if(key.length!==32)throw fail('PROVIDER_NOT_CONFIGURED',503);
 return {...p,id,secret,redirect:origin.origin+'/auth/social/callback/'+name};
}
function available(name){try{config(name);return true;}catch{return false;}}
async function list(clientId){
 const rows=(await db.query('SELECT provider,app_id,external_id,display_name,accounts,scopes,expires_at,token_ciphertext IS NOT NULL AS authorized FROM social_connections WHERE client_id=$1',[clientId])).rows;
 return Object.entries(providers).map(([id,p])=>{const r=rows.find(x=>x.provider===id);const configured=available(id),currentApp=process.env['SOCIAL_'+p.prefix+'_CLIENT_ID'];const connected=!!(configured&&r?.authorized&&r.external_id&&r.app_id===currentApp&&r.expires_at&&new Date(r.expires_at)>new Date());return {id,name:p.label,configured,connected,hasAuthorization:!!r?.authorized,selectionRequired:!!(configured&&r?.authorized&&!r.external_id&&r.app_id===currentApp&&r.expires_at&&new Date(r.expires_at)>new Date()),accounts:r?.accounts||[],expired:!!(r?.authorized&&!connected),displayName:r?.display_name||null,expiresAt:r?.expires_at||null,scopes:r?.scopes||''};});
}
async function begin(clientId,name,actorHash=null){
 const p=config(name),state=random(),binding=random(),verifier=random();
 const generation=await db.transaction(async tx=>{
 await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[clientId]);
 const throttle=await tx(`INSERT INTO api_rate_limits(bucket,attempts,expires_at) VALUES($1,1,NOW()+INTERVAL '15 minutes') ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN api_rate_limits.expires_at<NOW() THEN 1 ELSE api_rate_limits.attempts+1 END,expires_at=CASE WHEN api_rate_limits.expires_at<NOW() THEN NOW()+INTERVAL '15 minutes' ELSE api_rate_limits.expires_at END RETURNING attempts`,['social-start:'+clientId+':'+name]);
 if(throttle.rows[0].attempts>10)throw fail('RATE_LIMITED',429);
 await tx('DELETE FROM social_oauth_states WHERE expires_at<NOW()');
 const r=await tx('INSERT INTO social_connections(client_id,provider) VALUES($1,$2) ON CONFLICT(client_id,provider) DO UPDATE SET generation=social_connections.generation RETURNING generation',[clientId,name]);
 await tx("INSERT INTO social_oauth_states(state_hash,client_id,provider,generation,app_id,binding_hash,verifier_ciphertext,account_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW()+INTERVAL '10 minutes')",[meta.hash(state),clientId,name,r.rows[0].generation,p.id,meta.hash(binding),p.pkce?meta.encrypt(verifier,clientId+':'+name):null,actorHash]);
 return r.rows[0].generation;
 });
 const params=new URLSearchParams({response_type:'code',[name==='tiktok'?'client_key':'client_id']:p.id,redirect_uri:p.redirect,state,scope:p.scopes.join(['facebook','instagram','tiktok'].includes(name)?',':' ')});
 if(p.pkce){params.set('code_challenge',crypto.createHash('sha256').update(verifier).digest('base64url'));params.set('code_challenge_method','S256');}
 if(name==='youtube'){params.set('access_type','offline');params.set('prompt','consent');}
 return {url:p.authorize+'?'+params,binding,generation};
}
function setBinding(res,name,value,clear=false){provider(name);res.cookie('bachat_social_'+name,value,{httpOnly:true,secure:true,sameSite:'lax',path:'/auth/social',maxAge:clear?0:600000});}
function bindingCookie(req,name){return String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('bachat_social_'+name+'='))?.slice(('bachat_social_'+name+'=').length)||'';}
async function get(url,accessToken,params={}){return (await axios.get(url,{headers:{Authorization:'Bearer '+accessToken},params,timeout:15000,maxRedirects:0,maxContentLength:1048576})).data;}
async function identity(name,token){
 if(['facebook','instagram'].includes(name)){
  const data=await get('https://graph.facebook.com/v26.0/me/accounts',token,{fields:name==='instagram'?'id,name,instagram_business_account{id,username}':'id,name',limit:100});
  // A multi-account authorization needs an explicit choice; never silently select one.
  const options=(data.data||[]).map(a=>name==='instagram'?{id:a.instagram_business_account?.id,name:a.instagram_business_account?.username}:a).filter(a=>a.id);
  if(data.paging?.next)throw fail('SOCIAL_ACCOUNT_PAGE_LIMIT');
  if(!options.length)throw fail('SOCIAL_ACCOUNT_REQUIRED');
  const accounts=options.map(a=>({id:String(a.id),name:String(a.name||a.id).slice(0,300)}));
  return accounts.length===1?{...accounts[0],accounts}:{id:null,name:pLabel(name),accounts};
 }
 if(name==='linkedin'){const d=await get('https://api.linkedin.com/v2/userinfo',token);return {id:d.sub,name:d.name};}
 if(name==='tiktok'){const d=await get('https://open.tiktokapis.com/v2/user/info/',token,{fields:'open_id,display_name'});return {id:d.data?.user?.open_id,name:d.data?.user?.display_name};}
 if(name==='youtube'){const d=await get('https://www.googleapis.com/youtube/v3/channels',token,{part:'snippet',mine:true});if(d.items?.length!==1)throw fail('SOCIAL_ACCOUNT_REQUIRED');return {id:d.items[0].id,name:d.items[0].snippet?.title};}
 const d=await get('https://api.x.com/2/users/me',token);return {id:d.data?.id,name:d.data?.name};
}
async function callback(name,state,binding,code,denied=false){
 const p=config(name);
 if(!/^[A-Za-z0-9_-]{43}$/.test(String(state))||!/^[A-Za-z0-9_-]{43}$/.test(String(binding)))throw fail('INVALID_SOCIAL_STATE');
 const r=await db.query('DELETE FROM social_oauth_states WHERE state_hash=$1 AND provider=$2 AND binding_hash=$3 AND app_id=$4 AND expires_at>NOW() RETURNING client_id,generation,verifier_ciphertext,account_hash',[meta.hash(state),name,meta.hash(binding),p.id]);
 if(!r.rows.length)throw fail('INVALID_SOCIAL_STATE');
 // The existing portal owner session replaces the other branch's environment-account login.
 if(r.rows[0].account_hash){const active=await db.query('SELECT client_id FROM portal_sessions WHERE token_hash=$1 AND client_id=$2 AND expires_at>NOW()',[r.rows[0].account_hash,r.rows[0].client_id]);if(!active.rows.length)throw fail('SOCIAL_APPROVAL_CHANGED',403);}
 if(denied)throw fail('SOCIAL_CONSENT_DENIED');
 if(typeof code!=='string'||!code||code.length>4096)throw fail('INVALID_SOCIAL_CODE');
 const s=r.rows[0],params=new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:p.redirect,[name==='tiktok'?'client_key':'client_id']:p.id});
 const headers={'Content-Type':'application/x-www-form-urlencoded'};
 if(name==='x'){headers.Authorization='Basic '+Buffer.from(p.id+':'+p.secret).toString('base64');params.set('code_verifier',meta.decrypt(s.verifier_ciphertext,s.client_id+':'+name));}else params.set('client_secret',p.secret);
 const data=(await axios.post(p.token,params,{headers,timeout:15000,maxRedirects:0,maxContentLength:1048576})).data;
 if(typeof data.access_token!=='string'||!data.access_token||data.access_token.length>16384||(data.refresh_token&&String(data.refresh_token).length>16384)||!Number.isFinite(Number(data.expires_in))||Number(data.expires_in)<=0)throw fail('SOCIAL_TOKEN_INVALID');
 const user=await identity(name,data.access_token);if((!user.id&&!user.accounts?.length)||typeof user.name!=='string'||user.name.length>300)throw fail('SOCIAL_IDENTITY_INVALID');
 const ciphertext=meta.encrypt(JSON.stringify({accessToken:data.access_token,refreshToken:data.refresh_token||null}),s.client_id+':'+name);
 await db.transaction(async tx=>{
 const saved=await tx('UPDATE social_connections SET app_id=$3,token_ciphertext=$4,external_id=$5,display_name=$6,scopes=$7,expires_at=$8,accounts=$10::jsonb,generation=generation+1,updated_at=NOW() WHERE client_id=$1 AND provider=$2 AND generation=$9 RETURNING client_id',[s.client_id,name,p.id,ciphertext,user.id?String(user.id):null,user.name,String(data.scope||''),new Date(Date.now()+Number(data.expires_in)*1000),s.generation,JSON.stringify(user.accounts||[])]);
 if(!saved.rows.length)throw fail('SOCIAL_CONNECTION_CHANGED');
 await tx("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'SOCIAL_ACCOUNT_CONNECTED',$2)",[s.client_id,name]);
 });
 return s.client_id;
}
async function disconnect(clientId,name){provider(name);await db.transaction(async tx=>{await tx('UPDATE social_connections SET token_ciphertext=NULL,external_id=NULL,display_name=NULL,accounts=\'[]\'::jsonb,expires_at=NULL,scopes=\'\',generation=generation+1,updated_at=NOW() WHERE client_id=$1 AND provider=$2',[clientId,name]);await tx('DELETE FROM social_oauth_states WHERE client_id=$1 AND provider=$2',[clientId,name]);await tx("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'SOCIAL_ACCOUNT_DISCONNECTED',$2)",[clientId,name]);});}

async function selectAccount(clientId,name,accountId){provider(name);if(typeof accountId!=='string'||accountId.length>200)throw fail('INVALID_ACCOUNT');await db.transaction(async tx=>{const r=await tx('SELECT accounts FROM social_connections WHERE client_id=$1 AND provider=$2 AND app_id=$3 AND token_ciphertext IS NOT NULL AND expires_at>NOW() FOR UPDATE',[clientId,name,config(name).id]);const account=r.rows[0]?.accounts.find(a=>a.id===accountId);if(!account)throw fail('INVALID_ACCOUNT');await tx('UPDATE social_connections SET external_id=$3,display_name=$4,updated_at=NOW() WHERE client_id=$1 AND provider=$2',[clientId,name,account.id,account.name]);await tx("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'SOCIAL_ACCOUNT_SELECTED',$2)",[clientId,name]);});}

const router=express.Router();
router.get('/callback/:provider',async(req,res)=>{
 res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"});
 const name=req.params.provider;
 try{provider(name);const binding=bindingCookie(req,name);setBinding(res,name,'',true);await callback(name,req.query.state,binding,req.query.code,!!req.query.error);res.redirect('/app?social=connected#integrations');}
 catch{res.redirect('/app?social=failed#integrations');}
});
module.exports={providers,config,available,list,begin,callback,disconnect,selectAccount,setBinding,router};

