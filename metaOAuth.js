'use strict';
const express = require('express');
const meta = require('./metaConnection');
const router = express.Router();
const cookieName = '__Host-meta_state';
router.use((req,res,next)=>{
  res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
  next();
});
const wrap = fn => async(req,res)=>{try { await fn(req,res); } catch(error) { if(req.method==='GET')require('./metaConnectPage').send(res.status(400),{state:'error',...(error.message==='ADS_MANAGEMENT_REQUIRED'?{title:'Meta לא העניקה הרשאת ניהול',description:'חזור לשיחה בוואטסאפ ונבדוק יחד את ההרשאות. פרטי העסק והתוכנית שמורים, אין צורך להתחיל מחדש.'}:{})});else res.status(400).json({error:'Meta connection failed. Request a new link in your authorized chat.'}); }};
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
    // The conversation continues in WhatsApp by itself: the agent writes first (account
    // buttons, the saved draft, or a guide when there is no ad account yet).
    const next=await require('./metaConversation').notifyConnected(clientId,await require('./metaConversation').verify(clientId));
    const connected=next.verified.status==='CONNECTED';
    require('./metaConnectPage').send(res,{state:'done',title:connected?'החשבון חובר ✓':'ההרשאה התקבלה ✓',description:next.sent?'שלחתי לך הודעה בוואטסאפ. חזור לשיחה כדי להמשיך מאיפה שעצרנו.':'חזור לשיחה בוואטסאפ וכתוב ״המשך״ כדי להמשיך מאיפה שעצרנו.'});
  }else require('./metaConnectPage').send(res,{state:'done'});
}));
module.exports = router;
