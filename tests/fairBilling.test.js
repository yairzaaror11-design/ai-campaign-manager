'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),axios=require('axios');
const {openDatabase}=require('./helpers/isolatedDatabase');
const plans=require('../billingPlans');
function restore(env){for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}

test('plans are flat monthly prices in one config, never a share of ad spend',()=>{
 assert.deepEqual(plans.list().map(p=>[p.key,p.priceIls]),[['basic',199],['growth',449],['premium',1290]]);
 assert.equal(plans.priceMinor('premium'),129000);assert.equal(plans.priceText('premium'),'₪1,290 לחודש');
 assert.match(plans.AD_BUDGET_NOTE,/ישירות ל־Meta/);assert.equal(plans.TRIAL_DAYS,14);
 assert.equal(plans.plan('__proto__'),null);
});

test('trial, reminder, one-step cancel and refund work without any payment provider',async()=>{
 const h=await openDatabase(),env={...process.env};
 const subs=require('../subscriptionService'),chat=require('../billingConversation'),db=h.db;
 try{
  delete process.env.BILLING_ENABLED;process.env.SUPPORT_OPERATOR_CLIENT_IDS='';
  const client=async phone=>({id:(await db.query('INSERT INTO clients(phone) VALUES($1) RETURNING id',[phone])).rows[0].id});
  const owner=await client('972500000773'),quiet=await client('972500000774');
  // Nothing chosen yet: nothing to cancel, nothing charged.
  let s=await subs.summary(owner.id);assert.equal(s.planKey,null);assert.equal(s.paymentEnabled,false);assert.match(s.paymentNote,/לא יתבצע שום חיוב/);
  assert.match((await chat.handle(owner.id,'בטל מנוי')).reply,/אין לך מנוי פעיל/);
  assert.equal((await subs.requestRefund(owner.id)).status,'NOT_CHARGED');
  // First plan choice starts a 14-day trial with a clear end date.
  const started=await subs.selectPlan(owner.id,'growth');assert.equal(started.trialStarted,true);
  s=started.summary;assert.equal(s.status,'TRIAL');assert.equal(s.trialDaysLeft,14);assert.ok(s.trialEndsText);assert.equal(s.nextChargeAt,null,'no charge date while payment is off');
  await assert.rejects(subs.selectPlan(owner.id,'gold'),/PLAN_UNKNOWN/);
  // Changing plan keeps the same trial (no second trial, no automatic upgrade).
  const changed=await subs.selectPlan(owner.id,'basic');assert.equal(changed.changed,true);assert.equal(changed.summary.trialEndsText,s.trialEndsText);
  assert.equal((await db.query('SELECT plan_key FROM customer_subscriptions WHERE client_id=$1',[owner.id])).rows[0].plan_key,'basic');
  // Reminder: 3 days before the end, only inside the 24h WhatsApp window.
  await subs.selectPlan(quiet.id,'premium');
  await db.query("UPDATE customer_subscriptions SET trial_ends_at=NOW()+INTERVAL '2 days' WHERE client_id IN ($1,$2)",[owner.id,quiet.id]);
  await db.query("INSERT INTO whatsapp_contacts(phone,last_inbound_at) VALUES('972500000773',NOW()),('972500000774',NOW()-INTERVAL '3 days')");
  assert.equal((await subs.runDue()).sent,1);assert.equal((await subs.runDue()).sent,0,'sent once');
  const out=(await db.query("SELECT client_id,payload FROM whatsapp_outbox WHERE dedupe_key IS NOT NULL AND client_id IN ($1,$2)",[owner.id,quiet.id])).rows;
  assert.equal(out.length,1);assert.equal(String(out[0].client_id),String(owner.id));
  const body=out[0].payload.text.body;assert.match(body,/מסתיימת ב־/);assert.match(body,/₪199 לחודש/);assert.match(body,/בטל מנוי/);assert.match(body,/ישירות ל־Meta/);
  // Outside the window the dashboard shows it instead.
  assert.equal((await subs.summary(quiet.id)).trialReminderDue,true);
  // Cancel over WhatsApp: a confirmation step, then a written end date.
  assert.match((await chat.handle(owner.id,'אישור ביטול מנוי')).reply,/כתבו "בטל מנוי"/,'no cancel without the prompt');
  const ask=await chat.handle(owner.id,'בטל מנוי');assert.equal(ask.decisionKey,'billing_cancel');assert.match(ask.reply,/לבטל את מסלול בסיס/);
  assert.match((await chat.handle(owner.id,'השאר את המנוי')).reply,/נשאר/);
  const done=await chat.handle(owner.id,'אישור ביטול מנוי');assert.match(done.reply,/המנוי בוטל/);assert.match(done.reply,/הגישה נשארת עד/);
  s=await subs.summary(owner.id);assert.equal(s.cancelled,true);assert.equal(s.accessEndsText,s.trialEndsText);assert.equal(s.cancellable,false);
  assert.match((await chat.handle(owner.id,'בטל מנוי')).reply,/כבר בוטל/);
  assert.equal((await subs.selectPlan(owner.id,'growth')).reason,'CANCEL_PENDING');
  // Dashboard cancel is one step too.
  const portal=await subs.cancel(quiet.id,{channel:'PORTAL'});assert.equal(portal.status,'CANCELLED');assert.equal(portal.providerStatus,'NOT_NEEDED');
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM tenant_audit WHERE event='BILLING_CANCELLED' AND client_id IN ($1,$2)",[owner.id,quiet.id])).rows[0].n,2);
  // Refund: no questions in the first paid month, recorded once.
  await db.query("UPDATE customer_subscriptions SET status='ACTIVE',first_paid_at=NOW()-INTERVAL '10 days' WHERE client_id=$1",[quiet.id]);
  const refund=await subs.requestRefund(quiet.id,{channel:'PORTAL',reason:'לא מתאים לי'});assert.equal(refund.status,'REQUESTED');
  assert.equal((await subs.requestRefund(quiet.id)).status,'ALREADY_REQUESTED');
  assert.match((await chat.handle(quiet.id,'החזר כספי')).reply,/כבר אצלנו/);
  assert.equal((await subs.summary(quiet.id)).refundRequest.status,'REQUESTED');
  await db.query("UPDATE customer_subscriptions SET first_paid_at=NOW()-INTERVAL '40 days' WHERE client_id=$1",[owner.id]);
  assert.match((await chat.handle(owner.id,'אני רוצה החזר כספי')).reply,/חודש התשלום הראשון/);
  // Refund queue is for support operators only.
  await assert.rejects(subs.refundQueue(quiet.id),/ACCESS_DENIED/);
  process.env.SUPPORT_OPERATOR_CLIENT_IDS=String(owner.id);
  assert.ok((await subs.refundQueue(owner.id)).refunds.some(r=>r.id===refund.id));
  assert.equal((await subs.markRefunded(owner.id,refund.id)).ok,true);assert.equal((await subs.summary(quiet.id)).refundRequest.status,'REFUNDED');
 }finally{restore(env);await h.close();}
});

test('a provider failure never blocks cancellation; the team is told to finish it',async()=>{
 const h=await openDatabase(),env={...process.env},post=axios.post;
 const subs=require('../subscriptionService'),db=h.db;
 try{
  Object.assign(process.env,{BILLING_ENABLED:'true',BILLING_PROVIDER:'stripe',STRIPE_SECRET_KEY:'sk_test_mock',STRIPE_WEBHOOK_SECRET:'whsec_mock',STRIPE_PRICE_BASIC:'price_basic',STRIPE_PRICE_GROWTH:'price_growth',STRIPE_PRICE_PREMIUM:'price_premium'});
  const client=async phone=>({id:(await db.query('INSERT INTO clients(phone) VALUES($1) RETURNING id',[phone])).rows[0].id});
  const c=await client('972500000775'),op=await client('972500000776');
  process.env.SUPPORT_OPERATOR_CLIENT_IDS=String(op.id);
  await db.query("INSERT INTO whatsapp_contacts(phone,last_inbound_at) VALUES('972500000776',NOW())");
  await db.query("INSERT INTO customer_subscriptions(client_id,plan_code,plan_key,status,provider,provider_customer_id,provider_subscription_id,period_end) VALUES($1,'PAID','growth','ACTIVE','stripe','cus_x','sub_x',NOW()+INTERVAL '12 days')",[c.id]);
  axios.post=async()=>{throw Error('network');};
  const r=await subs.cancel(c.id,{channel:'PORTAL'});
  assert.equal(r.status,'CANCELLED');assert.equal(r.providerStatus,'MANUAL_REQUIRED');assert.ok(r.summary.accessEndsText);
  assert.equal(r.summary.nextChargeAt,null,'no next charge shown after cancelling');
  const note=(await db.query('SELECT payload FROM whatsapp_outbox WHERE client_id=$1',[op.id])).rows;
  assert.equal(note.length,1);assert.match(note[0].payload.text.body,/ביטול מנוי ידני נדרש/);
  // Successful provider cancel uses the provider's end date.
  const c2=await client('972500000777');
  await db.query("INSERT INTO customer_subscriptions(client_id,plan_code,plan_key,status,provider,provider_customer_id,provider_subscription_id) VALUES($1,'PAID','basic','ACTIVE','stripe','cus_y','sub_y')",[c2.id]);
  const end=Math.floor(Date.now()/1000)+20*86400;
  axios.post=async(url,data)=>{assert.match(url,/subscriptions\/sub_y$/);assert.equal(data.get('cancel_at_period_end'),'true');return{data:{id:'sub_y',cancel_at:end}};};
  const ok=await subs.cancel(c2.id,{channel:'WHATSAPP'});assert.equal(ok.providerStatus,'DONE');
  assert.equal(new Date(ok.summary.accessEndsAt).getTime(),end*1000);
 }finally{axios.post=post;restore(env);await h.close();}
});

test('cancel confirmation buttons are offered and accepted in every conversation mode',()=>{
 const ui=require('../conversationUi');
 const items=ui.choices({},'billing_cancel');assert.deepEqual(items.map(i=>i.text),['אישור ביטול מנוי','השאר את המנוי']);
 assert.equal(require('../conversationController').acceptsInteractive({ui:{decisionKey:'billing_cancel'}}),true);
 const chat=require('../billingConversation');
 for(const t of ['בטל מנוי','ביטול המנוי','לבטל את המנוי','אישור ביטול מנוי','החזר כספי','המנוי שלי'])assert.equal(chat.matches(t),true,t);
 for(const t of ['בטל','מנוי','תבטל את הקמפיין','מחירים'])assert.equal(chat.matches(t),false,t);
});
