'use strict';
const router=require('express').Router(),path=require('node:path'),db=require('./db'),auth=require('./portalStore');
router.use('/app',(req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});next();});
router.get('/app',(req,res)=>res.sendFile(path.join(__dirname,'public/portal/index.html')));
router.get('/app/:screen',(req,res,next)=>{if(![...require('./portalAgent').SCREENS,'pages','performance','approvals','catalog','agreement','growth'].includes(req.params.screen))return next();res.sendFile(path.join(__dirname,'public/portal/index.html'));});
router.get('/app/portal.js',(req,res)=>res.sendFile(path.join(__dirname,'public/portal/portal.js')));
router.get('/app/dashboard.js',(req,res)=>res.sendFile(path.join(__dirname,'public/portal/dashboard.js')));
router.get('/app/billing.js',(req,res)=>res.sendFile(path.join(__dirname,'public/portal/billing.js')));
router.get('/app/growth.js',(req,res)=>res.sendFile(path.join(__dirname,'public/portal/growth.js')));
router.get('/app/experience.js',(req,res)=>res.sendFile(path.join(__dirname,'public/portal/experience.js')));
router.get('/app/components.js',(req,res)=>res.sendFile(path.join(__dirname,'public/portal/components.js')));
router.get('/app/portal.css',(req,res)=>res.sendFile(path.join(__dirname,'public/portal/portal.css')));
router.post('/app/api/login',require('./rateLimit').middleware('portal-login',20),async(req,res)=>{
 try{
  if(req.headers.origin!==auth.origin()||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return res.sendStatus(403);
  const result=await auth.redeem(req.body?.token);
  res.setHeader('Set-Cookie',[`cb_session=${result.session}; Path=/app; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`,`cb_csrf=${result.csrf}; Path=/app; Secure; SameSite=Strict; Max-Age=604800`]);
  res.json({ok:true});
 }catch{res.status(401).json({error:'הקישור אינו תקף. אפשר לבקש קישור חדש בשיחת ה-WhatsApp.'});}
});
// Sign-in without a WhatsApp link: phone number -> one-time 6-digit code on WhatsApp.
// The request answer never reveals whether the number is a customer.
const sameOriginJson=req=>req.headers.origin===auth.origin()&&/^application\/json(?:;|$)/i.test(req.headers['content-type']||'');
router.post('/app/api/login/code/request',require('./rateLimit').middleware('portal-login-code',10),async(req,res)=>{
 try{if(!sameOriginJson(req))return res.sendStatus(403);res.json(await require('./loginCode').request(req.body?.phone));}
 catch{res.json({ok:true,message:require('./onboardingCopy').loginCodeSentGeneric});}
});
router.post('/app/api/login/code/verify',require('./rateLimit').middleware('portal-login-code-verify',20),async(req,res)=>{
 try{
  if(!sameOriginJson(req))return res.sendStatus(403);
  const result=await require('./loginCode').verify(req.body?.phone,req.body?.code);
  res.setHeader('Set-Cookie',[`cb_session=${result.session}; Path=/app; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`,`cb_csrf=${result.csrf}; Path=/app; Secure; SameSite=Strict; Max-Age=604800`]);
  res.json({ok:true});
 }catch(e){const copy=require('./onboardingCopy');res.status(e.message==='LOGIN_CODE_RATE_LIMITED'?429:401).json({error:e.message==='LOGIN_CODE_RATE_LIMITED'?copy.loginCodeSlowDown:copy.loginCodeInvalid});}
});
router.use('/app/api',require('./rateLimit').middleware('portal-api',600),async(req,res,next)=>{
 try{req.portal=await auth.authenticate(req,{write:!['GET','HEAD'].includes(req.method)});next();}catch(e){res.status(e.message==='PORTAL_CSRF'?403:401).json({error:'צריך להיכנס: בקישור אישי מה־WhatsApp, או עם מספר הטלפון וקוד.'});}
});
// Field errors the owner can fix, in plain Hebrew (never the raw code).
const FORM_ERRORS={LEAD_CONTACT_REQUIRED:'כדי לשמור ליד צריך טלפון או דוא״ל.',INVALID_LEAD_PHONE:'מספר הטלפון לא נראה תקין. למשל 0501234567.',INVALID_LEAD_EMAIL:'כתובת הדוא״ל לא נראית תקינה.',INVALID_LEAD:'צריך שם לליד (עד 120 תווים).',INVALID_LEAD_UPDATE:'הפרטים לא נשמרו. בדקו את הסכום ונסו שוב.',INVALID_REGISTRATION:'צריך שם ואישור של מדיניות הפרטיות.'};
const endpoint=handler=>async(req,res)=>{try{await require('./metaConnection').context.run(String(req.portal.clientId),()=>handler(req,res));}catch(e){res.status(['LEAD_NOT_FOUND_OR_STALE','WORKSPACE_STALE','WORKSPACE_REQUEST_CONFLICT'].includes(e.message)?409:400).json({error:e.message==='LEAD_NOT_FOUND_OR_STALE'?'הפנייה עודכנה במקום אחר. רעננו ונסו שוב.':e.message==='WORKSPACE_STALE'?'הפרטים עודכנו במקביל. רעננו את המסך לפני עריכה נוספת.':e.message==='WORKSPACE_REQUEST_CONFLICT'?'הבקשה הזו כבר נשמרה עם פרטים אחרים. פתחו מחדש את הטופס.':FORM_ERRORS[e.message]||'משהו לא עבד. בדקו את הפרטים ונסו שוב.'});}};
router.use('/app/api/authority',require('./authorityRoutes'));
router.use('/app/api/catalog',require('./catalogRoutes'));
router.use('/app/api/growth',require('./growthRoutes'));
router.use('/app/api/channels',require('./channelRoutes'));
router.get('/app/api/dashboard',endpoint(async(req,res)=>{
 const id=req.portal.clientId,p=await require('./marketingStore').load(id);
 const account=(await db.query('SELECT display_name,email,consent_version FROM customer_accounts WHERE client_id=$1',[id])).rows[0]||null;
 const subscription=(await db.query('SELECT plan_code,status,period_end FROM customer_subscriptions WHERE client_id=$1',[id])).rows[0]||{plan_code:'PILOT',status:'PILOT'};
 const graphics=(await db.query('SELECT COUNT(*)::int AS count FROM graphic_jobs WHERE client_id=$1 AND created_at>NOW()-INTERVAL \'1 day\'',[id])).rows[0]?.count||0;
 res.json({productName:'SCORPIO AI',profileVersion:p?.version||0,account,subscription:{...subscription,checkoutAvailable:require('./billingService').configured(),notice:require('./billingPlans').AD_BUDGET_NOTE},billing:await require('./subscriptionService').summary(id),business:p?require('./conversationFacts').all(p):{},brand:p?.brand||null,websiteChecks:p?.websiteChecks||null,draft:p?.journey?.draft||null,stage:p?.journey?.stage||'DISCOVERY',connection:p?.connection?{status:p.connection.status,account:p.connection.account,lastCheckAt:p.connection.lastCheckAt}:null,crm:await require('./crmService').summary(id),usage:{graphicsAttemptsLast24Hours:graphics},catalog:await require('./verticalProfiles').summary(id).catch(()=>null),capabilities:{metaWrites:process.env.READ_ONLY==='false'&&process.env.META_WRITES_ENABLED==='true',googleAds:false,videoGeneration:false,billing:require('./billingService').configured()}});
}));
router.post('/app/api/register',endpoint(async(req,res)=>res.json(await auth.register(req.portal.clientId,req.body))));
router.post('/app/api/logout',endpoint(async(req,res)=>{
 await db.query('DELETE FROM portal_sessions WHERE token_hash=$1',[req.portal.tokenHash]);
 res.setHeader('Set-Cookie',['cb_session=; Path=/app; HttpOnly; Secure; SameSite=Strict; Max-Age=0','cb_csrf=; Path=/app; Secure; SameSite=Strict; Max-Age=0']);res.json({ok:true});
}));
router.get('/app/api/leads',endpoint(async(req,res)=>res.json({leads:await require('./crmService').list(req.portal.clientId),speed:await require('./leadSpeed').stats(req.portal.clientId,30).catch(()=>null)})));
router.get('/app/api/leads/export.csv',endpoint(async(req,res)=>{const crm=require('./crmService');res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="leads.csv"'});res.send(crm.csv(await crm.list(req.portal.clientId,{limit:5000})));}));
router.get('/app/api/leads/:id/timeline',endpoint(async(req,res)=>res.json({events:await require('./crmService').timeline(req.portal.clientId,req.params.id)})));
router.post('/app/api/leads/:id/reminder',endpoint(async(req,res)=>{if(!/^[a-f0-9-]{36}$/i.test(req.params.id))return res.sendStatus(400);res.json(await require('./crmService').addReminder(req.portal.clientId,req.params.id,{date:req.body?.date,requestId:req.body?.requestId}));}));
router.get('/app/api/leads/new-meta',endpoint(async(req,res)=>{
 const before=req.query.before;
 if(before!==undefined&&(typeof before!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(before)))return res.sendStatus(400);
 res.json(await require('./crmService').newMetaLeads(req.portal.clientId,before));
}));
router.post('/app/api/leads',endpoint(async(req,res)=>{
 const account=(await db.query('SELECT client_id FROM customer_accounts WHERE client_id=$1',[req.portal.clientId])).rows[0];if(!account)return res.status(403).json({error:'יש להשלים את פתיחת החשבון לפני הוספת פניות.'});
 res.json(await require('./crmService').create(req.portal.clientId,{...req.body,source:'manual'}));
}));
router.get('/app/api/lead-concierge',endpoint(async(req,res)=>res.json(await require('./leadConcierge').overview(req.portal.clientId))));
router.put('/app/api/lead-concierge/settings',endpoint(async(req,res)=>{const lc=require('./leadConcierge'),b=req.body||{};if(b.enabled===true&&!lc.enabled())return res.status(409).json({error:'המענה האוטומטי ללידים עוד לא זמין בחשבון.'});const s=await lc.saveSettings(req.portal.clientId,{enabled:b.enabled,availability:b.availability,vertical:b.vertical});res.json({enabled:s.enabled,availability:s.availability,availabilityText:lc.availabilityText(s.availability)});}));
router.get('/app/api/leads/:id/concierge',endpoint(async(req,res)=>res.json(await require('./leadConcierge').transcript(req.portal.clientId,req.params.id))));
router.post('/app/api/leads/:id/takeover',endpoint(async(req,res)=>res.json(await require('./leadConcierge').takeover(req.portal.clientId,req.params.id))));
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
router.get('/app/api/meta/lead-source',endpoint(async(req,res)=>{
 const importer=require('./metaLeadImport');
 if(!importer.enabled())return res.json({enabled:false});
 const clientId=req.portal.clientId;
 const sources=(await db.query(`SELECT s.form_id,s.page_id,
   s.meta_generation=c.meta_generation AND s.app_id=$2 AND m.expires_at>NOW()
     AND m.app_id=$2 AS current_connection,
   (SELECT COUNT(*)::int FROM meta_lead_events e
    WHERE e.form_id=s.form_id AND e.generation=s.meta_generation AND e.status='FAILED') AS failed
   FROM meta_lead_sources s JOIN clients c ON c.id=s.client_id
   LEFT JOIN meta_connections m ON m.client_id=c.id WHERE s.client_id=$1 ORDER BY s.form_id`,
   [clientId,process.env.META_APP_ID])).rows;
 const forms=require('./metaLeadForms');
 if(req.query.pageId)return res.json(await forms.list(req.query.pageId));
 res.json({enabled:true,sources});
}));
router.get('/app/api/meta/lead-source/pages',endpoint(async(req,res)=>{
 if(!require('./metaLeadImport').enabled())return res.sendStatus(404);
 res.json(await require('./metaLeadForms').pages());
}));
router.post('/app/api/meta/lead-source',endpoint(async(req,res)=>{
 const importer=require('./metaLeadImport');
 if(!importer.enabled())return res.sendStatus(404);
 try {
  await importer.connect(req.portal.clientId,req.body?.pageId,req.body?.formId);
 } catch (error) {
  if(error.message!=='META_LEAD_SUBSCRIPTION_REQUIRED')throw error;
  return res.status(409).json({error:'ב־Meta יש להפעיל את המינוי לאירועי לידים עבור הדף הזה, ואז לנסות לחבר את הטופס שוב.'});
 }
 res.json({ok:true});
}));
router.post('/app/api/meta/check',endpoint(async(req,res)=>res.json(await require('./metaConversation').verify(req.portal.clientId))));
router.post('/app/api/meta/select',endpoint(async(req,res)=>{
 await require('./metaConnection').selectAccount(req.portal.clientId,req.body?.accountId);res.json(await require('./metaConversation').verify(req.portal.clientId));
}));
router.post('/app/api/landing/drafts',endpoint(async(req,res)=>res.json(await require('./landingDrafts').save(req.portal.clientId,req.body))));
router.patch('/app/api/landing/drafts/:id',endpoint(async(req,res)=>res.json(await require('./landingDrafts').save(req.portal.clientId,req.body,req.params.id))));
router.post('/app/api/landing/:id/publish',endpoint(async(req,res)=>res.json(await require('./landingDrafts').publish(req.portal.clientId,req.params.id,req.body))));
router.post('/app/api/landing',endpoint(async(req,res)=>res.json(await require('./landingService').create(req.portal.clientId,req.body))));
router.get('/app/api/landing',endpoint(async(req,res)=>{const r=await db.query('SELECT id,slug,payload,status,revision,created_at FROM landing_pages WHERE client_id=$1 ORDER BY created_at DESC LIMIT 20',[req.portal.clientId]);res.json({pages:r.rows.map(p=>({...p,url:p.status==='PUBLISHED'?auth.origin()+'/p/'+p.slug:null}))});}));
router.get('/app/api/billing',endpoint(async(req,res)=>res.json(await require('./subscriptionService').summary(req.portal.clientId))));
router.get('/app/api/billing/price',endpoint(async(req,res)=>res.json(await require('./billingService').price(String(req.query.plan||'')))));
router.post('/app/api/billing/plan',endpoint(async(req,res)=>res.json(await require('./subscriptionService').selectPlan(req.portal.clientId,req.body?.planKey))));
router.post('/app/api/billing/cancel',endpoint(async(req,res)=>{if(req.body?.confirm!==true)throw Error('BILLING_CONFIRMATION_REQUIRED');res.json(await require('./subscriptionService').cancel(req.portal.clientId,{channel:'PORTAL'}));}));
router.post('/app/api/billing/refund',endpoint(async(req,res)=>res.json(await require('./subscriptionService').requestRefund(req.portal.clientId,{channel:'PORTAL',reason:typeof req.body?.reason==='string'&&req.body.reason.trim()?req.body.reason:null}))));
router.get('/app/api/billing/refunds',endpoint(async(req,res)=>res.json(await require('./subscriptionService').refundQueue(req.portal.clientId))));
router.post('/app/api/billing/refunds/:id/done',endpoint(async(req,res)=>res.json(await require('./subscriptionService').markRefunded(req.portal.clientId,req.params.id))));
router.post('/app/api/billing/checkout',endpoint(async(req,res)=>res.json(await require('./billingService').checkout(req.portal.clientId,req.body))));
router.post('/app/api/billing/manage',endpoint(async(req,res)=>res.json(await require('./billingService').management(req.portal.clientId))));
router.get('/app/api/billing/invoices',endpoint(async(req,res)=>{const r=await db.query('SELECT amount_paid_minor,currency,status,hosted_url,created_at FROM billing_invoices WHERE client_id=$1 ORDER BY created_at DESC LIMIT 50',[req.portal.clientId]);res.json({invoices:r.rows});}));
router.post('/billing/webhook',require('./rateLimit').middleware('billing-webhook',120),async(req,res)=>{try{const verified=require('./billingService').verify(req.rawBody,req.headers);res.json(await require('./billingService').apply(verified));}catch{res.status(400).json({error:'Invalid billing event'});}});
// Structured business report: spend, funnel, per-campaign results and next steps.
// Today, setup checklist, trend, campaigns and approvals: the dashboard's operating view.
router.get('/app/api/today',endpoint(async(req,res)=>{const f=require('./dashboardFeed');const [items,setup]=await Promise.all([f.today(req.portal.clientId),f.checklist(req.portal.clientId)]);res.json({items,setup});}));
router.get('/app/api/trend',endpoint(async(req,res)=>res.json(await require('./dashboardFeed').trend(req.portal.clientId,req.query.days==='30'?30:14))));
router.get('/app/api/campaigns',endpoint(async(req,res)=>res.json(await require('./dashboardFeed').campaigns(req.portal.clientId))));
router.get('/app/api/campaigns/:id/budget',endpoint(async(req,res)=>res.json(await require('./budgetControl').info(req.portal.clientId,req.params.id))));
router.post('/app/api/campaigns/:id/budget',require('./rateLimit').middleware('portal-campaign-action',20),endpoint(async(req,res)=>res.json(await require('./budgetControl').prepareBudgetChange(req.portal.clientId,req.params.id,req.body?.dailyBudget))));
router.post('/app/api/campaigns/:id/duplicate',require('./rateLimit').middleware('portal-campaign-action',20),endpoint(async(req,res)=>res.json(await require('./budgetControl').prepareDuplicate(req.portal.clientId,req.params.id,req.body?.dailyBudget))));
router.post('/app/api/campaigns/:id/action',require('./rateLimit').middleware('portal-campaign-action',20),endpoint(async(req,res)=>res.json(await require('./dashboardApprovals').prepareCampaignAction(req.portal.clientId,req.params.id,req.body?.kind))));
// Ongoing organic content: three-month calendar, approvals, pause, photo shoots.
router.get('/app/api/organic',endpoint(async(req,res)=>res.json(await require('./organicContent').overview(req.portal.clientId))));
router.post('/app/api/organic/plan',endpoint(async(req,res)=>{const o=require('./organicContent');res.json(await o.create(req.portal.clientId,{perWeek:req.body?.perWeek,media:req.body?.media,extend:req.body?.extend===true}));}));
router.post('/app/api/organic/draft',require('./rateLimit').middleware('organic-draft',20),endpoint(async(req,res)=>res.json(await require('./organicContent').draftOne(req.portal.clientId,{topic:String(req.body?.topic||''),channel:req.body?.channel}))));
router.post('/app/api/organic/approve-all',endpoint(async(req,res)=>res.json({approved:await require('./organicContent').approveAll(req.portal.clientId)})));
router.post('/app/api/organic/status',endpoint(async(req,res)=>res.json(await require('./organicContent').setStatus(req.portal.clientId,req.body?.status))));
router.post('/app/api/organic/posts/:id',endpoint(async(req,res)=>res.json(await require('./organicContent').updatePost(req.portal.clientId,req.params.id,{action:req.body?.action,caption:req.body?.caption}))));
router.post('/app/api/organic/photo-shoot',endpoint(async(req,res)=>res.json(await require('./organicContent').requestShoot(req.portal.clientId,String(req.body?.details||'')))));
// Work agreement (הסכם עבודה) and the five-part status (done / running / waiting / failed / spend).
router.get('/app/api/status',endpoint(async(req,res)=>res.json(await require('./activityLog').status(req.portal.clientId))));
const agreementEndpoint=work=>async(req,res)=>{
 try{await require('./scopedAuthority').withPortalOwner(req.portal,async()=>res.json(await work(req)));}
 catch(e){const known={AGREEMENT_LIMITS_REQUIRED:'צריך תקרה חודשית ותקציב יומי מקסימלי, שניהם גדולים מאפס.',AGREEMENT_DAILY_ABOVE_MONTHLY:'התקציב היומי לקמפיין לא יכול להיות גדול מהתקרה החודשית.',AGREEMENT_NOT_FOUND:'עוד אין הסכם עבודה. קודם שומרים אחד.',AUTHORITY_OWNER_REQUIRED:'רק בעל העסק יכול לשנות את הסכם העבודה.'};res.status(e.message==='AUTHORITY_OWNER_REQUIRED'?403:400).json({error:known[e.message]||'בדקו את הפרטים ונסו שוב.'});}
};
router.get('/app/api/agreement',endpoint(async(req,res)=>{const w=require('./workAgreement');res.json({agreement:await require('./scopedAuthority').getAgreement(req.portal.clientId),labels:w.ALLOW_HE,alwaysAsk:w.ALWAYS_ASK_HE,presets:w.PRESETS});}));
router.post('/app/api/agreement',agreementEndpoint(req=>require('./scopedAuthority').setAgreement(req.portal.clientId,req.body)));
router.post('/app/api/agreement/pause',agreementEndpoint(req=>require('./scopedAuthority').pauseAll(req.portal.clientId)));
router.post('/app/api/agreement/resume',agreementEndpoint(req=>require('./scopedAuthority').resumeAll(req.portal.clientId)));
// AI cost this month: the owner sees their own business; support operators see everyone.
router.get('/app/api/usage',endpoint(async(req,res)=>res.json(await require('./usageLedger').ownerSummary(req.portal.clientId))));
router.get('/app/api/usage/operator',endpoint(async(req,res)=>{if(!require('./opsAlerts').operatorIds().includes(String(req.portal.clientId)))return res.sendStatus(403);res.json(await require('./usageLedger').operatorSummary());}));
// Experience: onboarding progress "X מתוך 5", the 30-second tour, the "בבדיקה" registry, undo.
router.get('/app/api/experience',endpoint(async(req,res)=>res.json({progress:await require('./onboarding').progress(req.portal.clientId),capabilities:await require('./capabilityStatus').list()})));
router.post('/app/api/experience/tour-seen',endpoint(async(req,res)=>res.json(await require('./onboarding').tourSeen(req.portal.clientId))));
router.post('/app/api/activity/:id/undo',require('./rateLimit').middleware('portal-campaign-action',20),endpoint(async(req,res)=>{
 const r=await require('./undoActions').undo(req.portal.clientId,req.params.id,{channel:'PORTAL'});
 res.json({ok:!!r.ok,mode:r.mode||null,actionId:r.approval?.actionId||r.actionId||null,reply:r.text});
}));
router.get('/app/api/activity',endpoint(async(req,res)=>res.json({items:await require('./activityLog').list(req.portal.clientId,{days:30})})));
router.get('/app/api/approvals',endpoint(async(req,res)=>res.json({approvals:await require('./dashboardApprovals').pending(req.portal.clientId)})));
router.post('/app/api/approvals/:id/approve',endpoint(async(req,res)=>{if(req.body?.confirm!==true)return res.sendStatus(400);res.json(await require('./dashboardApprovals').approve(req.portal.clientId,req.params.id));}));
router.post('/app/api/approvals/:id/reject',endpoint(async(req,res)=>res.json(await require('./dashboardApprovals').reject(req.portal.clientId,req.params.id))));
router.get('/app/api/business-report',endpoint(async(req,res)=>{
 const preset=['last_7d','last_14d','last_30d'].includes(req.query.period)?req.query.period:'last_7d';
 res.json(await require('./businessReport').build(req.portal.clientId,preset));
}));
router.get('/app/api/report',endpoint(async(req,res)=>{
 const v=await require('./metaConversation').verify(req.portal.clientId);if(!v.canRead)return res.status(409).json({error:require('./metaConversation').statusReply(v)});
 res.json({text:await require('./reportService').campaignReport(req.portal.clientId,'last_7d')});
}));

// Preserve social provider configuration and callbacks from the dashboard branch.
router.get('/app/api/integrations',endpoint(async(req,res)=>res.json({social:await require('./socialConnections').list(req.portal.clientId)})));
router.post('/app/api/social/:provider/connect',endpoint(async(req,res)=>{
 const social=require('./socialConnections'),r=await social.begin(req.portal.clientId,req.params.provider,req.portal.tokenHash);social.setBinding(res,req.params.provider,r.binding);res.json({url:r.url});
}));
router.post('/app/api/social/:provider/account',endpoint(async(req,res)=>{await require('./socialConnections').selectAccount(req.portal.clientId,req.params.provider,req.body?.accountId);res.json({ok:true});}));
router.post('/app/api/social/:provider/disconnect',endpoint(async(req,res)=>{if(req.body?.confirm!==true)return res.sendStatus(400);await require('./socialConnections').disconnect(req.portal.clientId,req.params.provider);res.json({ok:true});}));
// All workspace routes inherit the existing session, Origin, CSRF and tenant context boundary.
router.get('/app/api/workspace/:kind',endpoint(async(req,res)=>res.json(await require('./workspaceService').list(req.portal.clientId,req.params.kind))));
router.post('/app/api/workspace/:kind',endpoint(async(req,res)=>res.json(await require('./workspaceService').save(req.portal.clientId,req.params.kind,req.body?.payload,{requestId:req.body?.requestId}))));
router.patch('/app/api/workspace/:kind/:id',endpoint(async(req,res)=>res.json(await require('./workspaceService').save(req.portal.clientId,req.params.kind,req.body?.payload,{id:req.params.id,version:req.body?.version,requestId:req.body?.requestId}))));
router.post('/app/api/brand',endpoint(async(req,res)=>res.json(await require('./workspaceService').saveBrand(req.portal.clientId,req.body))));
router.get('/app/api/agent',endpoint(async(req,res)=>res.json(await require('./portalAgent').history(req.portal.clientId))));
router.post('/app/api/agent',require('./rateLimit').middleware('portal-agent',30),endpoint(async(req,res)=>res.json(await require('./portalAgent').send(req.portal.clientId,req.body))));
router.post('/app/api/agent/attachment',require('./rateLimit').middleware('portal-agent',30),endpoint(async(req,res)=>res.json(await require('./portalAttachment').send(req.portal.clientId,req.body))));
router.get('/app/api/agent/media/:id',endpoint(async(req,res)=>{
 const asset=await require('./mediaStore').loadMedia(req.portal.clientId,req.params.id);if(asset.media_type!=='image')return res.sendStatus(415);
 const image=await require('./mediaStore').readMedia(req.portal.clientId,asset.id);if(!['image/png','image/jpeg','image/webp'].includes(image.mimeType))return res.sendStatus(415);
 res.type(image.mimeType).send(image.buffer);
}));

module.exports=router;
