'use strict';
const crypto=require('node:crypto'),db=require('./db');
async function create(clientId,{confirmPublish=false}={}){
 if(confirmPublish!==true)throw Error('LANDING_PUBLISH_CONFIRMATION_REQUIRED');
 const p=await require('./marketingStore').load(clientId),d=p?.journey?.draft;
 if(!d||d.stale||!d.creatives?.length)throw Error('CURRENT_DRAFT_REQUIRED');
 const f=require('./conversationFacts').all(p);
 const payload={businessName:f.businessName||'העסק',title:d.creatives[0].headline,body:d.creatives[0].body,cta:'השאירו פרטים ונחזור אליכם',product:d.product,privacyContact:process.env.PRIVACY_CONTACT_EMAIL||null};
 const slug=crypto.randomBytes(20).toString('hex'),id=crypto.randomUUID();
 await db.transaction(async tx=>{
  const account=await tx('SELECT client_id FROM customer_accounts WHERE client_id=$1',[clientId]);if(!account.rows.length)throw Error('REGISTRATION_REQUIRED');
  await tx("INSERT INTO landing_pages(id,client_id,slug,payload,status,published_at) VALUES($1,$2,$3,$4::jsonb,'PUBLISHED',NOW())",[id,clientId,slug,JSON.stringify(payload)]);
  await tx("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'LANDING_PUBLISHED',$2)",[clientId,id]);
 });return{id,url:require('./portalStore').origin()+'/p/'+slug};
}
async function get(slug){
 if(!/^[a-f0-9]{40}$/.test(slug||''))throw Error('LANDING_NOT_FOUND');
 const r=await db.query("SELECT id,client_id,payload FROM landing_pages WHERE slug=$1 AND status='PUBLISHED'",[slug]);if(!r.rows.length)throw Error('LANDING_NOT_FOUND');return r.rows[0];
}
async function submit(slug,input){
 const page=await get(slug);
 if(input?.consent!==true||input?.website||!(/^[a-f0-9-]{36}$/i).test(input?.eventId||''))throw Error('INVALID_LEAD_FORM');
 return require('./crmService').create(page.client_id,{name:input.name,phone:input.phone,email:input.email,source:'landing:'+page.id,sourceEventId:input.eventId,campaignId:page.payload.campaignId||null,note:''});
}
const escape=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function html(page){const p=page.payload;return`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(p.businessName)}</title><link rel="stylesheet" href="/app/portal.css"><script defer src="/landing.js"></script></head><body><main><p class="eyebrow">${escape(p.businessName)}</p><section class="hero"><div><h1>${escape(p.title)}</h1><p>${escape(p.body)}</p></div></section><section class="card"><h2>${escape(p.cta)}</h2><form id="contact-form"><label>שם<input name="name" required maxlength="120" autocomplete="name"></label><label>טלפון<input name="phone" required maxlength="30" inputmode="tel" autocomplete="tel"></label><label>דוא״ל — לא חובה<input name="email" type="email" maxlength="254"></label><div hidden><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div><label class="check"><input type="checkbox" name="consent" required>אני מסכים/ה שהפרטים יועברו ל-${escape(p.businessName)} כדי לחזור אליי בנוגע לפנייה.</label><button>שליחת הפנייה</button></form><p id="form-status" role="status"></p><p>הטופס מופעל באמצעות SCORPIO AI. <a href="/privacy">מידע על פרטיות</a>${p.privacyContact?' · לפניות למפעיל: '+escape(p.privacyContact):''}</p></section></main></body></html>`;}
module.exports={create,get,submit,html,escape};
