'use strict';
const axios=require('axios'),crypto=require('node:crypto'),db=require('./db');
function configured(){return process.env.BILLING_ENABLED==='true'&&/^sk_(?:test|live)_/.test(process.env.STRIPE_SECRET_KEY||'')&&!!process.env.STRIPE_WEBHOOK_SECRET&&/^price_[a-zA-Z0-9]+$/.test(process.env.STRIPE_PRICE_ID||'');}
async function request(method,path,data,headers={}){
 if(!configured())throw Error('BILLING_NOT_CONFIGURED');
 const options={headers:{Authorization:'Bearer '+process.env.STRIPE_SECRET_KEY,...headers},timeout:15000,maxRedirects:0,proxy:false};
 try{return(method==='GET'?await axios.get('https://api.stripe.com/v1'+path,options):await axios.post('https://api.stripe.com/v1'+path,new URLSearchParams(data),options)).data;}catch{throw Error('BILLING_PROVIDER_FAILED');}
}
async function price(){
 if(!configured())return{available:false,reason:'ספק הסליקה, המחיר ותנאי הרכישה טרם הוגדרו. לא מתבצע חיוב.'};
 const p=await request('GET','/prices/'+process.env.STRIPE_PRICE_ID);
 if(!p.active||!Number.isSafeInteger(p.unit_amount)||p.unit_amount<=0||!['ils','usd','eur'].includes(p.currency)||!['month','year'].includes(p.recurring?.interval)||!Number.isInteger(p.recurring.interval_count)||p.recurring.interval_count!==1)throw Error('BILLING_PRICE_UNSUPPORTED');
 return{available:true,id:p.id,amountMinor:p.unit_amount,currency:p.currency.toUpperCase(),interval:p.recurring.interval,notice:'מנוי מתחדש לפי התקופה המוצגת. תקציב המדיה משולם בנפרד. המחיר הסופי ומסים ככל שחלים יוצגו לפני התשלום אצל ספק הסליקה.'};
}
async function checkout(clientId,{confirmPurchase=false,expectedPriceId,expectedAmountMinor}={}){
 const p=await price();if(!p.available)throw Error('BILLING_NOT_CONFIGURED');
 if(!confirmPurchase||expectedPriceId!==p.id||expectedAmountMinor!==p.amountMinor)throw Error('BILLING_PRICE_CONFIRMATION_REQUIRED');
 const id=crypto.randomUUID();
 await db.transaction(async tx=>{
  const account=await tx('SELECT client_id FROM customer_accounts WHERE client_id=$1',[clientId]);if(!account.rows.length)throw Error('REGISTRATION_REQUIRED');
  await tx('INSERT INTO billing_checkouts(id,client_id,price_id) VALUES($1,$2,$3)',[id,clientId,p.id]);
 });
 try{
  const o=require('./portalStore').origin(),session=await request('POST','/checkout/sessions',{'mode':'subscription','line_items[0][price]':p.id,'line_items[0][quantity]':'1','client_reference_id':String(clientId),'metadata[checkout_id]':id,'success_url':o+'/app?payment=returned','cancel_url':o+'/app?payment=cancelled'}, {'Idempotency-Key':id});
  const u=new URL(session.url);if(u.origin!=='https://checkout.stripe.com'||typeof session.id!=='string')throw Error('INVALID_BILLING_REDIRECT');
  await db.query("UPDATE billing_checkouts SET provider_session_id=$2,status='READY' WHERE id=$1",[id,session.id]);return{url:session.url};
 }catch(e){await db.query("UPDATE billing_checkouts SET status='FAILED' WHERE id=$1",[id]);throw e;}
}
function verify(raw,signature,now=Date.now()){
 if(!Buffer.isBuffer(raw)||raw.length>2*1024*1024||typeof signature!=='string'||signature.length>2000||!configured())throw Error('INVALID_BILLING_SIGNATURE');
 const parts=signature.split(',').map(x=>x.split('=')),timestamp=parts.find(p=>p[0]==='t')?.[1],signatures=parts.filter(p=>p[0]==='v1').map(p=>p[1]);
 if(!/^\d+$/.test(timestamp||'')||Math.abs(now/1000-Number(timestamp))>300)throw Error('INVALID_BILLING_SIGNATURE');
 const expected=crypto.createHmac('sha256',process.env.STRIPE_WEBHOOK_SECRET).update(timestamp+'.').update(raw).digest();
 if(!signatures.some(s=>/^[a-f0-9]{64}$/.test(s||'')&&crypto.timingSafeEqual(Buffer.from(s,'hex'),expected)))throw Error('INVALID_BILLING_SIGNATURE');
 const event=JSON.parse(raw.toString('utf8'));if(typeof event.id!=='string'||event.id.length>200||typeof event.type!=='string'||!Number.isSafeInteger(event.created)||!event.data?.object)throw Error('INVALID_BILLING_EVENT');return event;
}
async function apply(event){
 return db.transaction(async tx=>{
  const inserted=await tx("INSERT INTO billing_events(provider,event_id,result) VALUES('stripe',$1,'PROCESSING') ON CONFLICT DO NOTHING RETURNING event_id",[event.id]);if(!inserted.rows.length)return{duplicate:true};
  const o=event.data.object;let result='IGNORED';
  if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)){
   const row=(await tx("SELECT client_id FROM billing_checkouts WHERE provider_session_id=$1 AND status='READY' FOR UPDATE",[o.id])).rows[0];
   if(row&&String(row.client_id)===o.client_reference_id&&o.mode==='subscription'&&['paid','no_payment_required'].includes(o.payment_status)&&typeof o.subscription==='string'&&typeof o.customer==='string'){
    await tx("UPDATE billing_checkouts SET status='COMPLETE' WHERE provider_session_id=$1",[o.id]);
    const known=(await tx('SELECT status FROM billing_subscription_state WHERE provider_subscription_id=$1',[o.subscription])).rows[0];
    const subscriptionStatus=known?.status||'ACTIVE';
    await tx(`INSERT INTO customer_subscriptions(client_id,plan_code,status,provider,provider_customer_id,provider_subscription_id) VALUES($1,'PAID',$4,'stripe',$2,$3) ON CONFLICT(client_id) DO UPDATE SET plan_code='PAID',status=$4,provider='stripe',provider_customer_id=$2,provider_subscription_id=$3,updated_at=NOW()`,[row.client_id,o.customer,o.subscription,subscriptionStatus]);result='SUBSCRIPTION_SAVED';
   }
  }
  if(['customer.subscription.updated','customer.subscription.deleted'].includes(event.type)){
   const status=event.type.endsWith('deleted')||['canceled','unpaid','incomplete_expired'].includes(o.status)?'CANCELLED':['past_due','incomplete','paused'].includes(o.status)?'PAST_DUE':['active','trialing'].includes(o.status)?'ACTIVE':null;
   if(status&&typeof o.id==='string'&&/^sub_[a-zA-Z0-9]+$/.test(o.id)){
    await tx(`INSERT INTO billing_subscription_state(provider_subscription_id,status,last_event_created) VALUES($1,$2,$3) ON CONFLICT(provider_subscription_id) DO UPDATE SET status=EXCLUDED.status,last_event_created=EXCLUDED.last_event_created,updated_at=NOW() WHERE billing_subscription_state.last_event_created<=EXCLUDED.last_event_created`,[o.id,status,event.created]);
    const current=(await tx('SELECT status FROM billing_subscription_state WHERE provider_subscription_id=$1',[o.id])).rows[0];
    const r=await tx('UPDATE customer_subscriptions SET status=$2,updated_at=NOW() WHERE provider_subscription_id=$1 AND provider=$3 RETURNING client_id',[o.id,current.status,'stripe']);if(r.rows.length)result='STATUS_UPDATED';
   }
  }
  if(event.type==='invoice.paid'){
   const subscription=o.subscription||o.parent?.subscription_details?.subscription;
   const row=(await tx("SELECT client_id FROM customer_subscriptions WHERE provider='stripe' AND provider_subscription_id=$1",[subscription||''])).rows[0];
   if(row&&Number.isSafeInteger(o.amount_paid)&&o.amount_paid>=0&&typeof o.currency==='string'){
    let address=null;try{const u=new URL(o.hosted_invoice_url);if(u.protocol==='https:'&&u.hostname==='invoice.stripe.com')address=u.toString();}catch{}
    await tx('INSERT INTO billing_invoices(provider_invoice_id,client_id,amount_paid_minor,currency,status,hosted_url) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[o.id,row.client_id,o.amount_paid,o.currency.toUpperCase(),'PAID',address]);result='INVOICE_SAVED';
   }
  }
  await tx("UPDATE billing_events SET result=$2 WHERE provider='stripe' AND event_id=$1",[event.id,result]);return{result};
 });
}
async function management(clientId){
 const row=(await db.query("SELECT provider_customer_id FROM customer_subscriptions WHERE client_id=$1 AND provider='stripe'",[clientId])).rows[0];
 if(!row?.provider_customer_id)throw Error('BILLING_CUSTOMER_REQUIRED');
 const result=await request('POST','/billing_portal/sessions',{customer:row.provider_customer_id,return_url:require('./portalStore').origin()+'/app'});
 const u=new URL(result.url);if(u.origin!=='https://billing.stripe.com')throw Error('INVALID_BILLING_REDIRECT');return{url:result.url};
}
module.exports={configured,request,price,checkout,verify,apply,management};
