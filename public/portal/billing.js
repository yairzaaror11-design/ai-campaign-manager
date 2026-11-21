'use strict';
// "מנוי וחיוב": plan, price, trial end, next charge, change plan, one-step cancel
// and refund request. Card details are only ever entered on the provider's own page.
(()=>{
 const STATUS={TRIAL:'תקופת ניסיון חינם',ACTIVE:'פעיל',PAST_DUE:'התשלום האחרון לא עבר',CANCELLED:'בוטל',PILOT:'עוד לא נבחר מסלול'};
 function node(tag,value='',cls=''){const n=document.createElement(tag);n.textContent=value;if(cls)n.className=cls;return n;}
 function btn(label,action,cls='secondary'){const b=node('button',label,cls);b.type='button';b.addEventListener('click',()=>run(b,action));return b;}
 function row(container,label,value){const e=node('div','','metric');e.append(node('strong',label),node('span',value));container.append(e);}
 // A dialog whose buttons say exactly what they do ("ביטול" alone would be ambiguous here).
 function ask(title,lines,yes,no,{danger=false,input=null}={}){
  return new Promise(resolve=>{
   const d=node('dialog','','modal billing-dialog'),h=node('h2',title);h.id='billing-dialog-'+crypto.randomUUID();d.setAttribute('aria-labelledby',h.id);d.append(h);
   for(const line of lines)d.append(node('p',line));
   let field=null;if(input){const label=node('label',input);field=node('textarea');field.maxLength=1000;label.append(field);d.append(label);}
   const actions=node('div','','actions');let answer=false;
   const y=node('button',yes,danger?'primary billing-danger':'primary');y.type='button';y.addEventListener('click',()=>{answer=field?{reason:field.value.trim()}:true;d.close();});
   const n=node('button',no,'secondary');n.type='button';n.addEventListener('click',()=>d.close());
   actions.append(y,n);d.append(actions);document.body.append(d);
   d.addEventListener('close',()=>{d.remove();resolve(answer);},{once:true});d.showModal();n.focus();
  });
 }
 function banner(s){
  let b=document.getElementById('billing-banner');
  if(!s||!s.trialReminderDue){b?.remove();return;}
  if(!b){b=node('div','','notice billing-banner');b.id='billing-banner';b.setAttribute('role','status');const w=document.getElementById('workspace');w?.parentNode?.insertBefore(b,w);}
  const text=`⏰ תקופת הניסיון מסתיימת ב־${s.trialEndsText}. `+(s.paymentEnabled&&s.hasPaymentMethod?`מאז החיוב יהיה ${s.priceText} (מסלול ${s.planName}).`:`המסלול שבחרת: ${s.planName}, ${s.priceText}. ${s.paymentNote}`)+' אפשר לבטל בלחיצה אחת.';
  const go=node('button','למנוי וחיוב','secondary');go.type='button';go.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('portal:navigate',{detail:'billing'})));
  b.replaceChildren(node('span',text),go);
 }
 async function reload(message){const s=await api('billing');render(s);if(message)tell(message);}
 function planCard(s,p){
  const c=node('div','','billing-plan'+(s.planKey===p.key?' current':''));
  c.append(node('h3',p.name),node('p',p.priceText,'billing-price'));
  const ul=node('ul');for(const f of p.features)ul.append(node('li',f));c.append(ul);
  if(s.planKey===p.key){const b=node('button','המסלול שלך ✓','secondary');b.type='button';b.disabled=true;c.append(b);}
  else if(!s.cancelled){
   const first=!s.trialUsed&&!s.planKey;
   c.append(btn(first?`להתחיל ${s.trialDays} ימי ניסיון חינם`:'מעבר למסלול הזה',async()=>{
    const lines=first?[`${s.trialDays} ימים חינם, בלי כרטיס אשראי.`,`אחרי זה: ${p.priceText}, רק אם תבחר להמשיך. ${s.paymentNote}`,s.adBudgetNote]:[`המחיר החדש: ${p.priceText}.`,s.hasPaymentMethod?'השינוי יחול מהחיוב הבא. אין חיוב נוסף עכשיו.':'אין חיוב עכשיו.',s.adBudgetNote];
    if(!await ask(first?`מתחילים ניסיון במסלול ${p.name}`:`מעבר למסלול ${p.name}`,lines,first?'להתחיל ניסיון':'כן, להחליף מסלול','לא עכשיו'))return;
    const r=await api('billing/plan',{planKey:p.key});if(r.ok===false){tell(r.message,true);return;}
    render(r.summary);tell(r.trialStarted?`תקופת הניסיון התחילה ✓ מסתיימת ב־${r.summary.trialEndsText}`:'המסלול עודכן ✓');
   },first?'primary':'secondary'));
  }
  return c;
 }
 function render(s){
  const root=document.getElementById('billing-center');if(!root||!s)return;banner(s);
  root.replaceChildren(node('h2','מנוי וחיוב'));
  if(!s.paymentEnabled)root.append(node('p',s.paymentNote,'notice'));
  const status=node('div','','billing-status');
  row(status,'מסלול',s.planKey?`${s.planName} · ${s.priceText}`:'עוד לא נבחר');
  row(status,'מצב',s.cancelled?'בוטל':s.status==='TRIAL'&&!s.trialActive?'תקופת הניסיון הסתיימה':STATUS[s.status]||s.status);
  if(s.trialEndsText)row(status,s.trialActive?'סיום תקופת הניסיון':'תקופת הניסיון הסתיימה ב־',s.trialActive?`${s.trialEndsText} (עוד ${s.trialDaysLeft} ימים)`:s.trialEndsText);
  row(status,'החיוב הבא',s.nextChargeText?`${s.nextChargeText} · ${s.priceText}`:'אין חיוב מתוכנן');
  if(s.cancelled)row(status,'הגישה נשארת עד',s.accessEndsText);
  root.append(status,node('p',s.adBudgetNote,'muted'));
  if(s.cancelled)root.append(node('p',`✅ המנוי בוטל. הגישה נשארת עד ${s.accessEndsText}, ולא יהיה שום חיוב נוסף.`,'notice'));

  root.append(node('h3','המסלולים'),node('p','מחיר חודשי קבוע. בלי התחייבות, בלי אחוזים מתקציב הפרסום.','muted'));
  const grid=node('div','','billing-plans');for(const p of s.plans)grid.append(planCard(s,p));root.append(grid);

  const actions=node('div','','actions billing-actions');
  if(s.paymentEnabled&&s.planKey&&!s.hasPaymentMethod&&!s.cancelled)actions.append(btn('הוספת אמצעי תשלום',async()=>{
   const price=await api('billing/price?plan='+encodeURIComponent(s.planKey));if(!price.available){tell(price.reason,true);return;}
   const when=s.trialActive?`החיוב הראשון: ${s.trialEndsText}, בסוף תקופת הניסיון.`:'החיוב הראשון: היום.';
   if(!await ask('הוספת אמצעי תשלום',[`מסלול ${s.planName}: ${(price.amountMinor/100).toLocaleString('he-IL')} ₪ לחודש.`,when,'פרטי הכרטיס מוזנים רק בדף המאובטח של ספק הסליקה, לא אצלנו.',s.cancelHow],'המשך לדף התשלום','לא עכשיו'))return;
   const r=await api('billing/checkout',{planKey:s.planKey,confirmPurchase:true,expectedAmountMinor:price.amountMinor});location.assign(r.url);
  },'primary'));
  if(s.paymentEnabled&&s.hasPaymentMethod)actions.append(btn('אמצעי תשלום וחשבוניות',async()=>{const r=await api('billing/manage',{});location.assign(r.url);}));
  if(s.cancellable)actions.append(btn('ביטול מנוי',async()=>{
   const until=s.trialActive?s.trialEndsText:s.nextChargeText;
   if(!await ask(`לבטל את מסלול ${s.planName}?`,[until?`השירות ממשיך עד ${until}. אחרי זה לא יהיה שום חיוב.`:'לא יהיה שום חיוב נוסף.','אפשר לחזור מתי שרוצים.'],'כן, לבטל את המנוי','להשאיר את המנוי',{danger:true}))return;
   const r=await api('billing/cancel',{confirm:true});render(r.summary);
   tell(r.status==='CANCELLED'?`המנוי בוטל ✓ הגישה נשארת עד ${r.summary.accessEndsText}`:'אין מנוי פעיל לביטול');
  },'secondary billing-danger'));
  if(actions.childNodes.length)root.append(actions);
  root.append(node('p',s.cancelHow,'muted'));

  const refund=node('div','','billing-refund');refund.append(node('h3','החזר כספי'),node('p',s.refundPolicy));
  if(s.refundRequest?.status==='REQUESTED')refund.append(node('p','✅ בקשת ההחזר שלך התקבלה. הצוות מטפל בה ויעדכן אותך בוואטסאפ.','notice'));
  else if(s.refundRequest?.status==='REFUNDED')refund.append(node('p','✅ ההחזר בוצע.','notice'));
  else if(s.refundEligible)refund.append(node('p',`אפשר לבקש עד ${s.refundUntilText}.`,'muted'),btn('בקשת החזר כספי',async()=>{
   const answer=await ask('בקשת החזר כספי',['החזר מלא, בלי שאלות. הצוות יטפל ויעדכן אותך.'],'שליחת הבקשה','לא עכשיו',{input:'רוצה לספר למה? (לא חובה)'});if(!answer)return;
   const r=await api('billing/refund',{reason:answer.reason||null});render(r.summary);
   tell(r.status==='REQUESTED'||r.status==='ALREADY_REQUESTED'?'בקשת ההחזר נשלחה ✓':'לא נמצא חיוב להחזר');
  }));
  else refund.append(node('p',s.hasPaymentMethod||s.status==='ACTIVE'?'חודש התשלום הראשון הסתיים. משהו לא תקין בחיוב? כתבו לנו בוואטסאפ.':'עוד לא חויבת, אז אין מה להחזיר.','muted'));
  root.append(refund);
 }
 document.addEventListener('portal:refresh',e=>render(e.detail?.billing));
 window.ScorpioBilling={render,reload};
})();
