'use strict';
const $=id=>document.getElementById(id),statuses={NEW:'חדש',CONTACTED:'בטיפול',APPOINTMENT:'נקבעה פגישה',WON:'נסגר ✅',LOST:'לא רלוונטי'};
let state;let statusTimer;let leadEventId=crypto.randomUUID();
function tell(text,error=false){clearTimeout(statusTimer);$('status').textContent=text;$('status').classList.toggle('error',error);if(!error)statusTimer=setTimeout(()=>$('status').textContent='',6000);}
function text(tag,value,cls){const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;}
function csrf(){return document.cookie.split('; ').find(x=>x.startsWith('cb_csrf='))?.split('=')[1]||'';}
async function api(path,body,method=body?'POST':'GET'){
 const response=await fetch('/app/api/'+path,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json','X-CSRF-Token':csrf()}:undefined,body:body?JSON.stringify(body):undefined});
 const data=await response.json().catch(()=>({error:'לא ניתן להשלים את הבקשה כרגע.'}));if(!response.ok){const error=Error(response.status===429?'יותר מדי פעולות בזמן קצר. נסו שוב בעוד דקה.':response.status>=500?'השרת לא ענה כרגע. נסו שוב בעוד רגע.':data.error||'הפעולה לא הושלמה.');error.status=response.status;throw error;}return data;
}
function field(container,label,value){const e=text('div','','metric');e.append(text('strong',label),text('span',String(value??'עדיין לא נקבע')));container.append(e);}
function openPanel(name){document.querySelectorAll('[data-view]').forEach(e=>e.hidden=e.dataset.view!==name);document.dispatchEvent(new CustomEvent('portal:navigate',{detail:name}));}
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
 $('register-form').hidden=!!state.account;$('registration-status').textContent=state.account?'החשבון נשמר. פרטי השיחה והתוכנית כבר משויכים אליו.':'';
 $('lead-form').hidden=!state.account;
 const c=state.crm.counts;$('lead-count').textContent=Object.values(c).reduce((a,b)=>a+b,0)+' לידים';
 $('status').textContent='';document.dispatchEvent(new CustomEvent('portal:refresh',{detail:state}));
}
// Where a lead came from, in plain Hebrew (never the raw source code).
function leadSourceLabel(source){const s=String(source||'');return {meta_lead_ads:'טופס לידים ב־Meta',whatsapp_manual:'נוסף בוואטסאפ',manual:'הוספה ידנית',landing_page:'עמוד מכירה',crm:'הוספה ידנית',form:'טופס'}[s]||(/^landing/.test(s)?'עמוד מכירה':/^webhook/.test(s)?'טופס באתר':/^whatsapp/.test(s)?'וואטסאפ':s?'מקור אחר':'');}
// Israeli local numbers (05x...) become international (9725x...), like the WhatsApp lead alert.
function waNumber(phone){let d=String(phone||'').replace(/\D/g,'');if(/^0\d{8,9}$/.test(d))d='972'+d.slice(1);return /^\d{8,15}$/.test(d)?d:null;}
async function loadLeads(){
 const data=await api('leads'),list=$('leads-list'),lc=await api('lead-concierge').catch(()=>null),dash=window.ScorpioDashboard;list.replaceChildren();
 if(lc?.available&&dash?.conciergeSettings)list.append(dash.conciergeSettings(lc,loadLeads));
 if(!data.leads.length)list.append(text('p','עוד אין לידים. אפשר להוסיף ליד ידנית או לחבר טופס לידים.'));
 if(data.speed?.leads){const pct=data.speed.fastShare==null?'':' · '+Math.round(data.speed.fastShare*100)+'% תוך 15 דקות';list.append(text('p','⏱ זמן תגובה ממוצע ב־30 הימים האחרונים: '+data.speed.label+pct,'lead-speed'));}
 for(const lead of data.leads){
  const card=text('article','','card lead'),details=text('div','');details.append(text('h3',lead.name),text('p',[lead.phone,lead.email].filter(Boolean).join(' · ')),text('p','מקור: '+leadSourceLabel(lead.source)),text('p',lead.note));
  card.id='lead-'+lead.id;card.tabIndex=-1;
  {const conv=lc?.conversations?.find(c=>c.lead_id===lead.id);if(conv&&dash?.conciergeBlock)details.append(dash.conciergeBlock(lead,conv,loadLeads));}
  const select=document.createElement('select');select.setAttribute('aria-label','מצב הטיפול ב-'+lead.name);
  for(const [v,label]of Object.entries(statuses)){const option=document.createElement('option');option.value=v;option.textContent=label;option.selected=v===lead.status;select.append(option);}
  select.addEventListener('change',async()=>{select.disabled=true;try{await api('leads/'+lead.id,{status:select.value,version:lead.version},'PATCH');await loadLeads();await refresh();tell('הליד עודכן.');if(select.value==='WON'&&window.ScorpioGrowth)window.ScorpioGrowth.dealDialog(lead).catch(()=>{});}catch(e){tell(e.message,true);select.disabled=false;}});
  const number=waNumber(lead.phone);
  if(number){const first=String(lead.name||'').trim().split(/\s+/)[0]||'',business=state?.business?.businessName,message=lead.ready_message||(first&&lead.name!=='ליד מ־Meta'?'היי '+first:'היי')+', כאן'+(business?' מ'+business:'')+'. ראינו שהשארת פרטים, תודה! מתי נוח לך לדבר כמה דקות?',link=(href,label,cls)=>{const a=document.createElement('a');a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.className='button '+cls;a.textContent=label;return a;},row=text('div','','actions');
   // Speed to lead: the personal first message (drafted when the lead arrived) opens in the owner's own WhatsApp.
   row.append(link('https://wa.me/'+number+'?text='+encodeURIComponent(message),'✉️ שלח הודעה מוכנה',lead.status==='NEW'?'primary':'secondary'),link('https://wa.me/'+number,'💬 וואטסאפ','secondary'));
   if(lead.ready_message&&lead.status==='NEW')details.append(text('p','״'+lead.ready_message+'״','muted'));details.append(row);}
  if(lead.status==='NEW'){const done=document.createElement('button');done.type='button';done.className='button secondary';done.textContent='📞 חזרתי ללקוח';done.title='מסמן שהליד קיבל מענה, כדי למדוד את זמן התגובה';done.addEventListener('click',async()=>{done.disabled=true;try{await api('leads/'+lead.id,{status:'CONTACTED',version:lead.version},'PATCH');await loadLeads();await refresh();tell('סימנתי שהליד קיבל מענה 👍');}catch(e){tell(e.message,true);done.disabled=false;}});details.append(done);}
  if(lead.status==='NEW'&&lead.created_at){const minutes=Math.max(0,Math.round((Date.now()-new Date(lead.created_at))/60000));details.append(text('p',minutes<60?'⏱ מחכה '+minutes+' דקות למענה':minutes<1440?'⏱ מחכה '+Math.round(minutes/60)+' שעות למענה':'⚠️ מחכה יותר מיום, כדאי לחזור היום',minutes>=60?'error':'muted'));}
  card.append(details,select);if(window.ScorpioDashboard){const tools=text('div','','lead-tools');tools.append(window.ScorpioDashboard.leadDetailsButton(lead),window.ScorpioDashboard.leadRevenueButton(lead));if(window.ScorpioGrowth)tools.append(window.ScorpioGrowth.leadTools(lead));card.append(tools);}list.append(card);
 }
}
async function run(button,work){if(button.disabled)return;button.disabled=true;button.setAttribute('aria-busy','true');try{await work();}catch(e){tell(e.message,true);}finally{button.disabled=false;button.removeAttribute('aria-busy');}}
document.querySelectorAll('[data-panel]').forEach(button=>button.addEventListener('click',()=>run(button,async()=>{openPanel(button.dataset.panel);if(button.dataset.panel==='leads')await loadLeads();})));
$('register-form').addEventListener('submit',e=>{e.preventDefault();run(e.submitter,async()=>{const f=new FormData(e.target);await api('register',{name:f.get('name'),email:f.get('email'),acceptPrivacy:f.get('acceptPrivacy')==='on'});await refresh();tell('החשבון נפתח. כל הפרטים מה-WhatsApp נשמרו.');});});
$('lead-form').addEventListener('submit',e=>{e.preventDefault();run(e.submitter,async()=>{const f=new FormData(e.target);await api('leads',{...Object.fromEntries(f.entries()),sourceEventId:leadEventId});leadEventId=crypto.randomUUID();e.target.reset();await loadLeads();await refresh();tell('הליד נשמר.');});});
$('logout').addEventListener('click',()=>run($('logout'),async()=>{await api('logout',{});$('workspace').hidden=true;$('locked').hidden=false;$('logout').hidden=true;tell('יצאת מהחשבון.');}));
$('meta-connect').addEventListener('click',()=>run($('meta-connect'),async()=>{
 tell('בודק את חיבור הפרסום…');const result=await api('meta/check',{});$('meta-accounts').replaceChildren();
 if(result.status==='CONNECTED'){$('meta-status').textContent='החשבון אומת: '+result.account.name;tell('חיבור החשבון אומת.');return;}
 if(result.status==='ACCOUNT_SELECTION_REQUIRED'&&result.accounts?.length){$('meta-status').textContent='באיזה חשבון נשתמש?';for(const account of result.accounts){const button=text('button',account.name);button.addEventListener('click',()=>run(button,async()=>{await api('meta/select',{accountId:account.id});await refresh();$('meta-accounts').replaceChildren();}));$('meta-accounts').append(button);}return;}
 const address=await api('meta/connect',{});if(address.url){const link=document.createElement('a');link.textContent='לחיבור מאובטח דרך Meta';link.href=address.url;link.rel='noreferrer noopener';$('meta-accounts').append(link);$('meta-status').textContent='יש להשלים את החיבור במסך הרשמי, ואז ללחוץ שוב על בדיקת החיבור.';tell('קישור החיבור מוכן.');}
}));
$('report').addEventListener('click',()=>run($('report'),async()=>{tell('מכין את הדוח…');const data=await api('report');$('report-output').textContent=data.text;tell('הדוח מוכן.');}));
// Coming back from Google (#google=...): what happened, in plain Hebrew.
const GOOGLE_NOTES={linked:['חשבון Google חובר. מעכשיו אפשר להיכנס גם איתו.',false],pending:['כמעט סיימנו: חשבון ה־Google הזה עוד לא מחובר לעסק. היכנסו פעם אחת עם מספר הטלפון והקוד (או מהקישור בוואטסאפ), והוא יחובר אוטומטית.',false],denied:['הכניסה עם Google בוטלה.',true],'in-use':['חשבון ה־Google הזה כבר מחובר לעסק אחר.',true],unverified:['כתובת המייל בחשבון ה־Google הזה לא מאומתת אצל Google.',true],expired:['הכניסה עם Google לקחה יותר מדי זמן. נסו שוב.',true],unavailable:['הכניסה עם Google עוד לא מופעלת.',true],signin:['כדי לחבר חשבון Google צריך קודם להיכנס.',true],error:['הכניסה עם Google לא הושלמה. נסו שוב או היכנסו עם מספר הטלפון.',true]};
let googleNote=null;
// A login link opened in a tab that already shows /app only changes the fragment: reload to use it.
window.addEventListener('hashchange',()=>{if(/(^|&)(login|google)=/.test(location.hash.slice(1)))location.reload();});
function showGoogleNote(){const n=GOOGLE_NOTES[googleNote];if(!n||googleNote==='ok')return;if(!$('locked').hidden){$('google-note').textContent=n[0];$('google-note').hidden=false;$('google-note').classList.toggle('error',n[1]);}else tell(n[0],n[1]);}
(async()=>{try{
 const fragment=new URLSearchParams(location.hash.slice(1)),token=fragment.get('login');googleNote=fragment.get('google');
 if(token||googleNote)history.replaceState(null,'',location.pathname);
 if(token){const r=await api('login',{token});if(r.googleLinked)googleNote='linked';}
 await refresh();showGoogleNote();
}catch(e){
 if(e.status===401||e.status===403){$('locked').hidden=false;$('workspace').hidden=true;tell(googleNote&&googleNote!=='ok'?'':e.message,!googleNote);showGoogleNote();return;}
 // Not a sign-in problem (busy server, network): keep the session and offer a retry.
 tell(e.status?e.message:'אין חיבור לשרת כרגע. בדקו את האינטרנט ונסו שוב.',true);const retry=text('button','ניסיון חוזר');retry.type='button';retry.id='load-retry';retry.addEventListener('click',()=>location.reload());$('status').append(' ',retry);
}})();

$('landing-create').addEventListener('click',()=>run($('landing-create'),async()=>{if(!await window.ScorpioUI.confirm('פרסום דף הנחיתה','הדף יעלה לאוויר עם הנוסח של הקמפיין וטופס לידים. לפרסם?','אישור פרסום'))return;const r=await api('landing',{confirmPublish:true});const a=document.createElement('a');a.textContent='דף הנחיתה שלך מוכן';a.href=r.url;a.target='_blank';a.rel='noopener noreferrer';$('landing-link').replaceChildren(a);tell('דף הנחיתה באוויר 🎉 כל ליד ממנו ייכנס לכאן.');}));

