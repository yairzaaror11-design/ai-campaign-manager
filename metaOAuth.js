'use strict';
const express = require('express');
const meta = require('./metaConnection');
const router = express.Router();
const cookieName = '__Host-meta_state';
router.use((req,res,next)=>{
  res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
  next();
});
const wrap = fn => async(req,res)=>{try { await fn(req,res); } catch { res.status(400).json({error:'Meta connection failed. Request a new link in your authorized chat.'}); }};
router.get('/connect', (req,res)=>{
  const nonce = require('node:crypto').randomBytes(16).toString('base64');
  res.set('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
  res.type('html').send(`<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><title>חיבור Meta</title><h1>חיבור חשבון Meta לSCORPIO AI</h1><p>החיבור מאפשר קריאת חשבונות והכנת טיוטות. לא יפורסם קמפיין.</p><button id="connect">המשך ל־Meta</button><script nonce="${nonce}">const invite=location.hash.slice(1);history.replaceState(null,'',location.pathname);document.getElementById('connect').onclick=async()=>{const r=await fetch('/auth/meta/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invite})});const d=await r.json();if(r.ok)location.assign(d.url);else document.getElementById('connect').textContent='הקישור פג. בקש קישור חדש בצ׳אט.';};</script></html>`);
});
router.post('/start',require('./rateLimit').middleware('meta-start',10),wrap(async(req,res)=>{
  if (req.headers.origin!==meta.config().origin) throw Error('INVALID_ORIGIN');
  const started = await meta.begin(req.body.invite);
  res.cookie(cookieName,started.browser,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:600000});
  res.json({url:started.url});
}));
router.get('/callback',require('./rateLimit').middleware('meta-callback',30),wrap(async(req,res)=>{
  const cookie = String(req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  res.clearCookie(cookieName,{httpOnly:true,secure:true,sameSite:'lax',path:'/'});
  const clientId=await meta.callback(req.query.state,cookie,req.query.code);
  if(require('./marketingConversation').enabled()){
    await require('./metaConversation').recordStatus(clientId,'OAUTH_CALLBACK_RECEIVED');
    const verified=await require('./metaConversation').verify(clientId);
    const connected=verified.status==='CONNECTED';
    res.type('html').send('<html lang="he" dir="rtl"><meta charset="utf-8"><h1>'+(connected?'החשבון אומת וחובר':'ההרשאה נקלטה בשרת')+'</h1><p>אפשר לחזור לשיחה ולכתוב ״בדוק את חיבור Meta״ להמשך אימות ובחירת חשבון. לא בוצע פרסום.</p></html>');
  }else res.type('html').send('<html lang="he" dir="rtl"><meta charset="utf-8"><h1>Meta חובר בהצלחה</h1><p>חזור לצ׳אט ושלח /meta-accounts לבחירת חשבון. לא בוצע פרסום.</p></html>');
}));
module.exports = router;
