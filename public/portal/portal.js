'use strict';
const $=id=>document.getElementById(id),statuses={NEW:'חדש',CONTACTED:'בטיפול',APPOINTMENT:'נקבעה פגישה',WON:'נסגרה עסקה',LOST:'לא הבשיל'};
let state;let leadEventId=crypto.randomUUID();
function tell(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
function text(tag,value,cls){const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;}
function csrf(){return document.cookie.split('; ').find(x=>x.startsWith('cb_csrf='))?.split('=')[1]||'';}
async function api(path,body,method=body?'POST':'GET'){
 const response=await fetch('/app/api/'+path,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json','X-CSRF-Token':csrf()}:undefined,body:body?JSON.stringify(body):undefined});
 const data=await response.json().catch(()=>({error:'לא ניתן להשלים את הבקשה כרגע.'}));if(!response.ok)throw Error(data.error||'הפעולה לא הושלמה.');return data;
}
function field(container,label,value){const e=text('div','','metric');e.append(text('strong',label),text('span',String(value??'עדיין לא נקבע')));container.append(e);}
function openPanel(name){document.querySelectorAll('[data-view]').forEach(e=>e.hidden=e.dataset.view!==name);}
async function refresh(){
 state=await api('dashboard');$('workspace').hidden=false;$('locked').hidden=true;$('logout').hidden=false;
 const b=state.business||{},draft=state.draft;
 $('business-name').textContent=b.businessName||'העסק שלך';$('business-description').textContent=b.businessType||'הפרטים יופיעו כאן לאחר ההיכרות בשיחה.';
 $('logo').hidden=!state.brand?.logo;if(state.brand?.logo)$('logo').src='/app/api/brand-image?slot=logo';
 const ad=$('ad-preview');ad.replaceChildren();
 if(draft?.creatives?.length){
  const creative=draft.creatives[0];ad.append(text('strong',b.businessName||'העסק שלך'),text('p','תוכן ממומן — תצוגת טיוטה','muted'));
  if(draft.mediaAssetId||state.brand?.images?.length){const img=document.createElement('img');img.alt='תמונה שנבחרה למודעה';img.src=draft.mediaAssetId?'/app/api/creative-image':'/app/api/brand-image?slot=0';img.addEventListener('error',()=>img.remove(),{once:true});ad.append(img);}
  ad.append(text('h3',creative.headline),text('p',creative.body),text('div',creative.cta,'cta'));
  if(draft.stale)ad.prepend(text('p','הפרטים השתנו. צריך לרענן ולאשר את הטיוטה בשיחה.','error'));
 }else ad.append(text('p','המודעה תופיע כאן אחרי שהסוכן יכין אותה בשיחה.'));
 $('draft-missing').textContent=draft?.missing?.length?'להשלמה: '+draft.missing.join(', '):'';
 const plan=$('plan');plan.replaceChildren();
 for(const [label,value]of [['מטרה',draft?.businessGoal||b.businessGoal],['שירות',draft?.product||b.product],['קהל',draft?.audience||b.audience],['אזור',draft?.geography||b.geography],['תקציב',draft?.budgetText],['יעד פנייה',draft?.destination||b.leadDestination]])field(plan,label,value);
 $('meta-status').textContent=state.connection?.status==='CONNECTED'?'לפי הבדיקה האחרונה: '+(state.connection.account?.name||'חשבון נבחר'):'נחבר את חשבון הפרסום לאחר בדיקת התוכנית.';
 const checks=$('website-checks');checks.replaceChildren();
 if(state.websiteChecks)for(const [key,label]of Object.entries({hasContactLink:'קישור יצירת קשר בעמוד',hasForm:'טופס בעמוד',hasMobileViewport:'תג התאמה למסך נייד',trackingTagsDetected:'זוהו תגי מדידה בעמוד'}))field(checks,label,state.websiteChecks[key]?'זוהה':'לא זוהה בעמוד שנקרא');
 else checks.append(text('p','עדיין לא בוצעה בדיקת עמוד ציבורי. אפשר לשלוח קישור בשיחה.'));
 $('billing-manage').hidden=!state.subscription.checkoutAvailable||state.subscription.plan_code!=='PAID';
 $('register-form').hidden=!!state.account;$('registration-status').textContent=state.account?'החשבון נשמר. פרטי השיחה והתוכנית כבר משויכים אליו.':'';
 $('lead-form').hidden=!state.account;
 $('subscription').replaceChildren(text('p','מסלול: '+state.subscription.plan_code),text('p',state.subscription.notice),text('p','ניסיונות יצירת תמונות ב-24 השעות האחרונות: '+state.usage.graphicsAttemptsLast24Hours));
 const c=state.crm.counts;$('lead-count').textContent=Object.values(c).reduce((a,b)=>a+b,0)+' פניות במערכת';
 tell('הפרטים מהשיחה נשמרו. אפשר להמשיך מאיפה שעצרנו.');
}
async function loadLeads(){
 const data=await api('leads'),list=$('leads-list');list.replaceChildren();
 if(!data.leads.length)list.append(text('p','עדיין אין פניות. אפשר להוסיף פנייה ידנית או לחבר מקור פניות.'));
 for(const lead of data.leads){
  const card=text('article','','card lead'),details=text('div','');details.append(text('h3',lead.name),text('p',[lead.phone,lead.email].filter(Boolean).join(' · ')),text('p','מקור: '+lead.source),text('p',lead.note));
  const select=document.createElement('select');select.setAttribute('aria-label','מצב הטיפול ב-'+lead.name);
  for(const [v,label]of Object.entries(statuses)){const option=document.createElement('option');option.value=v;option.textContent=label;option.selected=v===lead.status;select.append(option);}
  select.addEventListener('change',async()=>{select.disabled=true;try{await api('leads/'+lead.id,{status:select.value,version:lead.version},'PATCH');await loadLeads();await refresh();tell('מצב הפנייה עודכן.');}catch(e){tell(e.message,true);select.disabled=false;}});
  card.append(details,select);list.append(card);
 }
}
async function run(button,work){button.disabled=true;try{await work();}catch(e){tell(e.message,true);}finally{button.disabled=false;}}
document.querySelectorAll('[data-panel]').forEach(button=>button.addEventListener('click',()=>run(button,async()=>{openPanel(button.dataset.panel);if(button.dataset.panel==='leads')await loadLeads();})));
$('register-form').addEventListener('submit',e=>{e.preventDefault();run(e.submitter,async()=>{const f=new FormData(e.target);await api('register',{name:f.get('name'),email:f.get('email'),acceptPrivacy:f.get('acceptPrivacy')==='on'});await refresh();tell('החשבון נפתח. כל הפרטים מה-WhatsApp נשמרו.');});});
$('lead-form').addEventListener('submit',e=>{e.preventDefault();run(e.submitter,async()=>{const f=new FormData(e.target);await api('leads',{...Object.fromEntries(f.entries()),sourceEventId:leadEventId});leadEventId=crypto.randomUUID();e.target.reset();await loadLeads();await refresh();tell('הפנייה נשמרה.');});});
$('logout').addEventListener('click',()=>run($('logout'),async()=>{await api('logout',{});$('workspace').hidden=true;$('locked').hidden=false;$('logout').hidden=true;tell('יצאת מהחשבון.');}));
$('meta-connect').addEventListener('click',()=>run($('meta-connect'),async()=>{
 tell('בודק את חיבור הפרסום…');const result=await api('meta/check',{});$('meta-accounts').replaceChildren();
 if(result.status==='CONNECTED'){$('meta-status').textContent='החשבון אומת: '+result.account.name;tell('חיבור החשבון אומת.');return;}
 if(result.status==='ACCOUNT_SELECTION_REQUIRED'&&result.accounts?.length){$('meta-status').textContent='באיזה חשבון נשתמש?';for(const account of result.accounts){const button=text('button',account.name);button.addEventListener('click',()=>run(button,async()=>{await api('meta/select',{accountId:account.id});await refresh();$('meta-accounts').replaceChildren();}));$('meta-accounts').append(button);}return;}
 const address=await api('meta/connect',{});if(address.url){const link=document.createElement('a');link.textContent='לחיבור מאובטח דרך Meta';link.href=address.url;link.rel='noreferrer noopener';$('meta-accounts').append(link);$('meta-status').textContent='יש להשלים את החיבור במסך הרשמי, ואז ללחוץ שוב על בדיקת החיבור.';tell('קישור החיבור מוכן.');}
}));
$('report').addEventListener('click',()=>run($('report'),async()=>{tell('מכין דוח מהנתונים המחוברים…');const data=await api('report');$('report-output').textContent=data.text;tell('הדוח מוכן.');}));
(async()=>{try{
 const fragment=new URLSearchParams(location.hash.slice(1)),token=fragment.get('login');
 if(token){history.replaceState(null,'',location.pathname);await api('login',{token});}
 await refresh();
}catch(e){$('locked').hidden=false;$('workspace').hidden=true;tell(e.message,true);}})();

$('landing-create').addEventListener('click',()=>run($('landing-create'),async()=>{const r=await api('landing',{confirmPublish:true});const a=document.createElement('a');a.textContent='דף הפניות שלך מוכן';a.href=r.url;a.target='_blank';a.rel='noopener noreferrer';$('landing-link').replaceChildren(a);tell('דף הפניות פורסם. פניות ממנו יישמרו כאן במערכת.');}));

$('show-price').addEventListener('click',()=>run($('show-price'),async()=>{
 const price=await api('billing/price'),container=$('price-review');container.replaceChildren();
 if(!price.available){container.append(text('p',price.reason));return;}
 container.append(text('p',`מחיר השירות: ${(price.amountMinor/100).toFixed(2)} ${price.currency} ל-${price.interval==='month'?'חודש':'שנה'}`),text('p',price.notice));
 const buy=text('button','המשך לרכישה במחיר המוצג');buy.addEventListener('click',()=>run(buy,async()=>{const result=await api('billing/checkout',{confirmPurchase:true,expectedPriceId:price.id,expectedAmountMinor:price.amountMinor});location.assign(result.url);}));container.append(buy);
}));

$('billing-manage').addEventListener('click',()=>run($('billing-manage'),async()=>{const r=await api('billing/manage',{});location.assign(r.url);}));
