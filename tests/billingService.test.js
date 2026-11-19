'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),axios=require('axios');
const {openDatabase}=require('./helpers/isolatedDatabase');
const PRICES={price_basic:19900,price_growth:44900,price_premium:129000};
function stripeEnv(){Object.assign(process.env,{BILLING_ENABLED:'true',BILLING_PROVIDER:'stripe',STRIPE_SECRET_KEY:'sk_test_mock',STRIPE_WEBHOOK_SECRET:'whsec_mock',STRIPE_PRICE_BASIC:'price_basic',STRIPE_PRICE_GROWTH:'price_growth',STRIPE_PRICE_PREMIUM:'price_premium',APP_PUBLIC_URL:'https://campaign.example'});}
function restore(env){for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}

test('billing stays off without a configured provider and nothing can be charged',async()=>{
 const env={...process.env};
 try{
  delete process.env.BILLING_ENABLED;const billing=require('../billingService');
  assert.equal(billing.configured(),false);
  const p=await billing.price('growth');assert.equal(p.available,false);assert.match(p.reason,/התשלום עוד לא הופעל/);
  await assert.rejects(billing.checkout(1,{planKey:'growth',confirmPurchase:true,expectedAmountMinor:44900}),/NOT_CONFIGURED/);
  // Enabled but missing a plan price id: still off.
  stripeEnv();delete process.env.STRIPE_PRICE_PREMIUM;assert.equal(billing.configured(),false);
 }finally{restore(env);}
});

test('stripe adapter refuses a price that differs from the plan config',async()=>{
 const env={...process.env},get=axios.get;
 try{
  stripeEnv();const billing=require('../billingService');
  axios.get=async()=>({data:{id:'price_growth',active:true,unit_amount:44900,currency:'ils',recurring:{interval:'year',interval_count:1}}});
  await assert.rejects(billing.price('growth'),/UNSUPPORTED/);
  axios.get=async()=>({data:{id:'price_growth',active:true,unit_amount:45000,currency:'ils',recurring:{interval:'month',interval_count:1}}});
  await assert.rejects(billing.price('growth'),/UNSUPPORTED/);
  axios.get=async()=>({data:{id:'price_growth',active:true,unit_amount:44900,currency:'ils',recurring:{interval:'month',interval_count:1}}});
  const p=await billing.price('growth');assert.equal(p.amountMinor,44900);assert.match(p.notice,/ישירות ל־Meta/);
  await assert.rejects(billing.price('enterprise'),/PLAN_UNKNOWN/);
 }finally{axios.get=get;restore(env);}
});

test('verified events cannot cross tenants or replay, trial survives checkout, first real charge opens the refund window',async()=>{
 const h=await openDatabase(),env={...process.env},get=axios.get,post=axios.post;
 const billing=require('../billingService'),subs=require('../subscriptionService');
 let sessionId='cs_test_1',posted;
 try{
  stripeEnv();
  axios.get=async url=>{const id=url.split('/').pop();return{data:{id,active:true,unit_amount:PRICES[id],currency:'ils',recurring:{interval:'month',interval_count:1}}};};
  axios.post=async(_url,data,options)=>{posted=data;assert.ok(options.headers['Idempotency-Key']);return{data:{id:sessionId,url:'https://checkout.stripe.com/c/pay/'+sessionId}};};
  const store=require('../clientStore');
  const a=await store.getOrCreateClient('972500000771'),b=await store.getOrCreateClient('972500000772');
  await require('../portalStore').register(a.id,{name:'א',acceptPrivacy:true});
  await subs.selectPlan(a.id,'growth');
  await assert.rejects(billing.checkout(a.id,{planKey:'growth',confirmPurchase:true,expectedAmountMinor:1}),/CONFIRMATION/);
  await assert.rejects(billing.checkout(a.id,{planKey:'growth',expectedAmountMinor:44900}),/CONFIRMATION/);
  await billing.checkout(a.id,{planKey:'growth',confirmPurchase:true,expectedAmountMinor:44900});
  assert.equal(posted.get('line_items[0][price]'),'price_growth');
  assert.ok(Number(posted.get('subscription_data[trial_end]'))>Date.now()/1000+13*86400,'first charge waits for the trial end');
  const now=Math.floor(Date.now()/1000);
  const event=(id,type,object,created=now)=>({id,type,created,data:{object}});
  const sign=raw=>'t='+now+',v1='+crypto.createHmac('sha256','whsec_mock').update(now+'.').update(raw).digest('hex');
  const paid=event('evt_one','checkout.session.completed',{id:sessionId,client_reference_id:String(a.id),mode:'subscription',payment_status:'no_payment_required',subscription:'sub_mock',customer:'cus_mock'});
  const raw=Buffer.from(JSON.stringify(paid));
  const verified=billing.verify(raw,{'stripe-signature':sign(raw)});
  assert.equal(verified.provider,'stripe');assert.equal(verified.event.kind,'CHECKOUT_COMPLETED');
  assert.throws(()=>billing.verify(Buffer.from(raw+' '),{'stripe-signature':sign(raw)}),/SIGNATURE/);
  assert.throws(()=>billing.verify(raw,{'stripe-signature':sign(raw)},Date.now()+600000),/SIGNATURE/);
  const normalize=e=>({provider:'stripe',event:require('../billingProviders').ADAPTERS.stripe.normalize(e)});
  await billing.apply(normalize(event('evt_other','checkout.session.completed',{...paid.data.object,client_reference_id:String(b.id)})));
  assert.equal((await h.db.query('SELECT provider_subscription_id FROM customer_subscriptions WHERE client_id=$1',[b.id])).rows.length,0);
  await billing.apply(verified);assert.equal((await billing.apply(verified)).duplicate,true);
  let s=await subs.summary(a.id);
  assert.equal(s.status,'TRIAL');assert.equal(s.planKey,'growth');assert.equal(s.hasPaymentMethod,true);
  assert.equal(s.nextChargeText,s.trialEndsText,'next charge is the trial end date');
  assert.equal(s.refundEligible,false,'no refund before any real charge');
  await billing.apply(normalize(event('evt_inv0','invoice.paid',{id:'in_0',subscription:'sub_mock',amount_paid:0,currency:'ils'})));
  assert.equal((await subs.summary(a.id)).status,'TRIAL');
  await billing.apply(normalize(event('evt_inv1','invoice.paid',{id:'in_1',subscription:'sub_mock',amount_paid:44900,currency:'ils',hosted_invoice_url:'https://evil.example/x'})));
  s=await subs.summary(a.id);assert.equal(s.status,'ACTIVE');assert.equal(s.refundEligible,true);
  assert.equal((await h.db.query("SELECT hosted_url FROM billing_invoices WHERE provider_invoice_id='in_1'")).rows[0].hosted_url,null);
  await billing.apply(normalize(event('evt_cancel','customer.subscription.deleted',{id:'sub_mock',status:'canceled'},now+10)));
  await billing.apply(normalize(event('evt_old','customer.subscription.updated',{id:'sub_mock',status:'active'},now)));
  assert.equal((await h.db.query('SELECT status FROM customer_subscriptions WHERE client_id=$1',[a.id])).rows[0].status,'CANCELLED');
 }finally{axios.get=get;axios.post=post;restore(env);await h.close();}
});
