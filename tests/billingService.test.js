'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),axios=require('axios');
const {openDatabase}=require('./helpers/database');
test('billing remains off without configuration and verified events cannot cross tenants or replay',async t=>{
 const h=await openDatabase(),env={...process.env},get=axios.get,post=axios.post;
 const billing=require('../billingService');
 let a,b,sessionId='cs_test_1';
 try{
  delete process.env.BILLING_ENABLED;assert.equal((await billing.price()).available,false);
  Object.assign(process.env,{BILLING_ENABLED:'true',STRIPE_SECRET_KEY:'sk_test_mock',STRIPE_WEBHOOK_SECRET:'whsec_mock',STRIPE_PRICE_ID:'price_mock',APP_PUBLIC_URL:'https://campaign.example'});
  axios.get=async()=>({data:{id:'price_mock',active:true,unit_amount:9900,currency:'ils',recurring:{interval:'month',interval_count:1}}});
  axios.post=async(_url,data,options)=>{assert.ok(options.headers['Idempotency-Key']);assert.equal(data.get('line_items[0][price]'),'price_mock');return{data:{id:sessionId,url:'https://checkout.stripe.com/c/pay/'+sessionId}};};
  a=await require('../clientStore').getOrCreateClient('972501003111');b=await require('../clientStore').getOrCreateClient('972501003222');
  await require('../portalStore').register(a.id,{name:'א',acceptPrivacy:true});
  await assert.rejects(billing.checkout(a.id,{confirmPurchase:true,expectedPriceId:'price_attacker',expectedAmountMinor:1}),/CONFIRMATION/);
  await billing.checkout(a.id,{confirmPurchase:true,expectedPriceId:'price_mock',expectedAmountMinor:9900});
  const now=Math.floor(Date.now()/1000);
  const event=(id,type,object,created=now)=>({id,type,created,data:{object}});
  const paid=event('evt_one','checkout.session.completed',{id:sessionId,client_reference_id:String(a.id),mode:'subscription',payment_status:'paid',subscription:'sub_mock',customer:'cus_mock'});
  const raw=Buffer.from(JSON.stringify(paid)),signature='t='+now+',v1='+crypto.createHmac('sha256','whsec_mock').update(now+'.').update(raw).digest('hex');
  assert.equal(billing.verify(raw,signature).id,paid.id);assert.throws(()=>billing.verify(Buffer.from(raw+' '),signature),/SIGNATURE/);assert.throws(()=>billing.verify(raw,signature,Date.now()+600000),/SIGNATURE/);
  const forged=event('evt_other','checkout.session.completed',{...paid.data.object,client_reference_id:String(b.id)});await billing.apply(forged);assert.equal((await h.db.query('SELECT client_id FROM customer_subscriptions WHERE client_id=$1',[b.id])).rows.length,0);
  await billing.apply(paid);assert.equal((await billing.apply(paid)).duplicate,true);
  assert.equal((await h.db.query('SELECT status FROM customer_subscriptions WHERE client_id=$1',[a.id])).rows[0].status,'ACTIVE');
  await billing.apply(event('evt_cancel','customer.subscription.deleted',{id:'sub_mock',status:'canceled'},now+10));
  await billing.apply(event('evt_old','customer.subscription.updated',{id:'sub_mock',status:'active'},now));
  assert.equal((await h.db.query('SELECT status FROM customer_subscriptions WHERE client_id=$1',[a.id])).rows[0].status,'CANCELLED');
 }finally{axios.get=get;axios.post=post;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);await h.close();}
});
