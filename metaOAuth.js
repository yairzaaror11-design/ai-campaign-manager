'use strict';
const express = require('express');
const meta = require('./metaConnection');
const router = express.Router();
const cookieName = '__Host-meta_state';
router.use((req,res,next)=>{
  res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
  next();
});
const wrap = fn => async(req,res)=>{try { await fn(req,res); } catch { if(req.method==='GET')require('./metaConnectPage').send(res.status(400),{state:'error'});else res.status(400).json({error:'Meta connection failed. Request a new link in your authorized chat.'}); }};
router.get('/connect',(req,res)=>require('./metaConnectPage').send(res,{management:req.query.mode==='manage'}));
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
    require('./metaConnectPage').send(res,{state:'done',title:connected?'החשבון אומת וחובר':'ההרשאה התקבלה',description:connected?'אפשר לחזור ל־WhatsApp ולהמשיך עם החשבון שחיברתם.':'חזרו ל־WhatsApp ובחרו את חשבון הפרסום הרצוי. הקמפיין ימתין לאישור שלכם בשיחה.'});
  }else require('./metaConnectPage').send(res,{state:'done'});
}));
module.exports = router;
