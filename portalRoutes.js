'use strict';
const router=require('express').Router(),path=require('node:path'),db=require('./db'),auth=require('./portalStore');
router.use('/app',(req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});next();});
router.get('/app',(req,res)=>res.sendFile(path.join(__dirname,'public/portal/index.html')));
router.get('/app/portal.js',(req,res)=>res.sendFile(path.join(__dirname,'public/portal/portal.js')));
router.get('/app/portal.css',(req,res)=>res.sendFile(path.join(__dirname,'public/portal/portal.css')));
router.post('/app/api/login',require('./rateLimit').middleware('portal-login',20),async(req,res)=>{
 try{
  if(req.headers.origin!==auth.origin()||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return res.sendStatus(403);
  const result=await auth.redeem(req.body?.token);
  res.setHeader('Set-Cookie',[`cb_session=${result.session}; Path=/app; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`,`cb_csrf=${result.csrf}; Path=/app; Secure; SameSite=Strict; Max-Age=604800`]);
  res.json({ok:true});
 }catch{res.status(401).json({error:'הקישור אינו תקף. אפשר לבקש קישור חדש בשיחת ה-WhatsApp.'});}
});
router.use('/app/api',require('./rateLimit').middleware('portal-api',120),async(req,res,next)=>{
 try{req.portal=await auth.authenticate(req,{write:!['GET','HEAD'].includes(req.method)});next();}catch(e){res.status(e.message==='PORTAL_CSRF'?403:401).json({error:'צריך להיכנס דרך קישור אישי מה-WhatsApp.'});}
});
const endpoint=handler=>async(req,res)=>{try{await require('./metaConnection').context.run(String(req.portal.clientId),()=>handler(req,res));}catch(e){res.status(e.message==='LEAD_NOT_FOUND_OR_STALE'?409:400).json({error:e.message==='LEAD_NOT_FOUND_OR_STALE'?'הפנייה עודכנה במקום אחר. רעננו ונסו שוב.':'לא ניתן להשלים את הפעולה. בדקו את הפרטים ונסו שוב.'});}};
router.get('/app/api/dashboard',endpoint(async(req,res)=>{
 const id=req.portal.clientId,p=await require('./marketingStore').load(id);
 const account=(await db.query('SELECT display_name,email,consent_version FROM customer_accounts WHERE client_id=$1',[id])).rows[0]||null;
 const subscription=(await db.query('SELECT plan_code,status,period_end FROM customer_subscriptions WHERE client_id=$1',[id])).rows[0]||{plan_code:'PILOT',status:'PILOT'};
 const graphics=(await db.query('SELECT COUNT(*)::int AS count FROM graphic_jobs WHERE client_id=$1 AND created_at>NOW()-INTERVAL \'1 day\'',[id])).rows[0]?.count||0;
 res.json({account,subscription:{...subscription,checkoutAvailable:require('./billingService').configured(),notice:'מנוי הפיילוט אינו חיוב כספי. מדיה משולמת לפלטפורמת הפרסום בנפרד. רכישה תיפתח רק לאחר הגדרת ספק, מחיר ותנאים.'},business:p?require('./conversationFacts').all(p):{},brand:p?.brand||null,websiteChecks:p?.websiteChecks||null,draft:p?.journey?.draft||null,stage:p?.journey?.stage||'DISCOVERY',connection:p?.connection?{status:p.connection.status,account:p.connection.account,lastCheckAt:p.connection.lastCheckAt}:null,crm:await require('./crmService').summary(id),usage:{graphicsAttemptsLast24Hours:graphics},capabilities:{metaWrites:process.env.READ_ONLY==='false'&&process.env.META_WRITES_ENABLED==='true',googleAds:false,videoGeneration:false,billing:require('./billingService').configured()}});
}));
router.post('/app/api/register',endpoint(async(req,res)=>res.json(await auth.register(req.portal.clientId,req.body))));
router.post('/app/api/logout',endpoint(async(req,res)=>{
 await db.query('DELETE FROM portal_sessions WHERE token_hash=$1',[req.portal.tokenHash]);
 res.setHeader('Set-Cookie',['cb_session=; Path=/app; HttpOnly; Secure; SameSite=Strict; Max-Age=0','cb_csrf=; Path=/app; Secure; SameSite=Strict; Max-Age=0']);res.json({ok:true});
}));
router.get('/app/api/leads',endpoint(async(req,res)=>res.json({leads:await require('./crmService').list(req.portal.clientId)})));
router.post('/app/api/leads',endpoint(async(req,res)=>{
 const account=(await db.query('SELECT client_id FROM customer_accounts WHERE client_id=$1',[req.portal.clientId])).rows[0];if(!account)return res.status(403).json({error:'יש להשלים את פתיחת החשבון לפני הוספת פניות.'});
 res.json(await require('./crmService').create(req.portal.clientId,{...req.body,source:'manual'}));
}));
router.patch('/app/api/leads/:id',endpoint(async(req,res)=>res.json(await require('./crmService').update(req.portal.clientId,req.params.id,req.body))));
router.post('/app/api/business/inspect',endpoint(async(req,res)=>{
 if(!await require('./rateLimit').take('business-inspect:'+req.portal.clientId,6,3600))return res.status(429).json({error:'אפשר לבדוק קישור נוסף בהמשך.'});
 const candidate=await require('./publicWebsite').inspect(req.body?.url);
 await require('./marketingStore').update(req.portal.clientId,null,p=>{p.businessImport=candidate;p.businessEntry={...(p.businessEntry||{}),linkAsked:true,awaitingConfirmation:true};return{handled:false,changed:true};});res.json({candidate});
}));
router.post('/app/api/business/confirm',endpoint(async(req,res)=>{
 if(req.body?.confirm!==true)return res.sendStatus(400);
 const result=await require('./businessEntry').handle(req.portal.clientId,'הפרטים נכונים',null);res.json({ok:!!result?.handled,next:result?.reply});
}));
router.get('/app/api/creative-image',endpoint(async(req,res)=>{
 const p=await require('./marketingStore').load(req.portal.clientId);const id=p?.journey?.draft?.mediaAssetId;if(!id)return res.sendStatus(404);
 const asset=await require('./mediaStore').loadMedia(req.portal.clientId,id);if(asset.media_type!=='image')return res.sendStatus(404);
 const media=await require('./mediaHandler').receiveWhatsAppMedia({type:'image',image:{id:asset.whatsapp_media_id}});res.type(media.mimeType).send(media.buffer);
}));
router.get('/app/api/brand-image',endpoint(async(req,res)=>{
 const p=await require('./marketingStore').load(req.portal.clientId),brand=p?.brand;
 const slot=String(req.query.slot||'');const value=slot==='logo'?brand?.logo:/^[0-5]$/.test(slot)?brand?.images?.[Number(slot)]:null;
 if(!value)return res.sendStatus(404);
 const image=await require('./publicWebsite').fetchPublic(value,{accept:'image'});res.type(image.type).send(image.buffer);
}));
router.post('/app/api/meta/connect',endpoint(async(req,res)=>{
 const result=await require('./metaConversation').verify(req.portal.clientId);
 if(result.status==='CONNECTED')return res.json({status:result.status});
 res.json({url:await require('./metaConnection').createInvite(req.portal.clientId)});
}));
router.post('/app/api/meta/check',endpoint(async(req,res)=>res.json(await require('./metaConversation').verify(req.portal.clientId))));
router.post('/app/api/meta/select',endpoint(async(req,res)=>{
 await require('./metaConnection').selectAccount(req.portal.clientId,req.body?.accountId);res.json(await require('./metaConversation').verify(req.portal.clientId));
}));
router.post('/app/api/landing',endpoint(async(req,res)=>res.json(await require('./landingService').create(req.portal.clientId,req.body))));
router.get('/app/api/landing',endpoint(async(req,res)=>{const r=await db.query('SELECT id,slug,status,created_at FROM landing_pages WHERE client_id=$1 ORDER BY created_at DESC LIMIT 20',[req.portal.clientId]);res.json({pages:r.rows.map(p=>({...p,url:auth.origin()+'/p/'+p.slug}))});}));
router.get('/app/api/billing/price',endpoint(async(req,res)=>res.json(await require('./billingService').price())));
router.post('/app/api/billing/checkout',endpoint(async(req,res)=>res.json(await require('./billingService').checkout(req.portal.clientId,req.body))));
router.post('/app/api/billing/manage',endpoint(async(req,res)=>res.json(await require('./billingService').management(req.portal.clientId))));
router.get('/app/api/billing/invoices',endpoint(async(req,res)=>{const r=await db.query('SELECT amount_paid_minor,currency,status,hosted_url,created_at FROM billing_invoices WHERE client_id=$1 ORDER BY created_at DESC LIMIT 50',[req.portal.clientId]);res.json({invoices:r.rows});}));
router.post('/billing/webhook',require('./rateLimit').middleware('billing-webhook',120),async(req,res)=>{try{const event=require('./billingService').verify(req.rawBody,req.headers['stripe-signature']);res.json(await require('./billingService').apply(event));}catch{res.status(400).json({error:'Invalid billing event'});}});
router.get('/app/api/report',endpoint(async(req,res)=>{
 const v=await require('./metaConversation').verify(req.portal.clientId);if(!v.canRead)return res.status(409).json({error:require('./metaConversation').statusReply(v)});
 res.json({text:await require('./reportService').campaignReport(req.portal.clientId,'last_7d')});
}));
module.exports=router;
