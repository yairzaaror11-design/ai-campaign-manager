const crypto = require('crypto');

const WRITE_INTENTS = new Set([
  'CREATE_CAMPAIGN',
  'CREATE_LEAD_FORM',
  'CREATE_ADSET',
  'CREATE_AD',
  'CREATE_CREATIVE',
  'UPLOAD_IMAGE',
  'CREATE_BUNDLE',
  'ACTIVATE_BUNDLE',
  'CHANGE_BUDGET',
  'DUPLICATE_CAMPAIGN',
  'PAUSE_CAMPAIGN',
  'RESUME_CAMPAIGN',
  'EDIT_CAMPAIGN'
]);

function isWriteIntent(intent) {
  return WRITE_INTENTS.has(String(intent || '').toUpperCase());
}

function createActionPlan({
  intent,
  summary,
  target = {},
  parameters = {},
  missing = [],
  confidence = null
}) {
  return {
    id: crypto.randomBytes(6).toString('hex').toUpperCase(),
    intent: String(intent || 'UNKNOWN').toUpperCase(),
    summary: String(summary || ''),
    target,
    parameters,
    missing: Array.isArray(missing) ? missing : [],
    confidence,
    requiresApproval: isWriteIntent(intent),
    createdAt: new Date().toISOString()
  };
}

const INTENT_HE={CREATE_CAMPAIGN:'יצירת קמפיין',CREATE_LEAD_FORM:'יצירת טופס פניות',CREATE_ADSET:'יצירת קהל ותקציב',CREATE_AD:'יצירת מודעה',CREATE_CREATIVE:'יצירת עיצוב מודעה',UPLOAD_IMAGE:'העלאת התמונה לחשבון הפרסום',CREATE_BUNDLE:'יצירת הקמפיין המלא (מושהה)',ACTIVATE_BUNDLE:'הפעלת הקמפיין',CHANGE_BUDGET:'שינוי תקציב',DUPLICATE_CAMPAIGN:'שכפול קמפיין (מושהה)',PAUSE_CAMPAIGN:'השהיית קמפיין',RESUME_CAMPAIGN:'חידוש קמפיין',EDIT_CAMPAIGN:'עריכת קמפיין'};
const OBJECTIVE_HE={OUTCOME_LEADS:'פניות (לידים)',OUTCOME_SALES:'מכירות',OUTCOME_TRAFFIC:'כניסות לאתר',OUTCOME_ENGAGEMENT:'מעורבות',OUTCOME_AWARENESS:'חשיפה',OUTCOME_APP_PROMOTION:'קידום אפליקציה'};
const SYMBOL={ILS:'₪',USD:'$',EUR:'€'};
function money(amount,currency){return amount===undefined||amount===null||amount===''?null:String(amount)+' '+(SYMBOL[currency]||currency||'');}
function minor(amount,currency){return amount===undefined||amount===null?null:money(Number(amount)/100,currency);}
function when(v){if(!v)return null;const d=new Date(v);return isNaN(d)?String(v):d.toLocaleString('he-IL',{timeZone:'Asia/Jerusalem',day:'numeric',month:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});}
function audience(t){
 if(!t||typeof t!=='object')return null;const g=t.geo_locations||{},parts=[];
 const places=[...(g.cities||[]).map(c=>(c.name||c.key)+(c.radius?' + '+c.radius+' ק"מ':'')),...(g.regions||[]).map(r=>r.name||r.key),...(g.countries||[]).map(c=>c==='IL'?'ישראל':c)].filter(Boolean);
 if(places.length)parts.push(places.slice(0,6).join(', '));
 if(t.age_min||t.age_max)parts.push('גילאי '+(t.age_min||18)+'–'+(t.age_max||65));
 if(Array.isArray(t.genders)&&t.genders.length===1)parts.push(t.genders[0]===1?'גברים':'נשים');
 return parts.join(' · ')||null;
}
// What the owner will actually pay, in plain numbers, before approving anything that spends.
function dailyTotal(p,sets,review){
  if(p.dailyBudget!==undefined&&p.dailyBudget!==null&&p.dailyBudget!=='')return Number(p.dailyBudget);
  const v=sets.map(s=>s.dailyBudget!==undefined?Number(s.dailyBudget):s.daily_budget!==undefined&&s.daily_budget!==null?Number(s.daily_budget)/100:NaN);
  if(v.length&&v.every(Number.isFinite))return v.reduce((a,b)=>a+b,0);
  // Resuming or activating a campaign whose budget sits on the campaign itself.
  const current=Number(review?.currentDailyBudgetMinor);
  return Number.isFinite(current)&&current>0?current/100:null;
}
function costLine(plan,p,sets,currency){
  if(!['ACTIVATE_BUNDLE','RESUME_CAMPAIGN','CHANGE_BUDGET','CREATE_BUNDLE','CREATE_ADSET','DUPLICATE_CAMPAIGN'].includes(plan.intent))return null;
  const day=dailyTotal(p,sets,plan.review);if(!Number.isFinite(day)||day<=0)return null;
  const start=new Date(p.startTime||sets[0]?.startTime||sets[0]?.start_time||Date.now()),end=new Date(p.endTime||sets[0]?.endTime||sets[0]?.end_time||NaN);
  const days=Number.isFinite(end-start)&&end>start?Math.ceil((end-start)/864e5):null;
  const round=n=>Math.round(n).toLocaleString('he-IL');
  const prefix=plan.intent.startsWith('CREATE_')||plan.intent==='DUPLICATE_CAMPAIGN'?'אחרי ההפעלה, ':'';
  return '💸 כמה זה יעלה: '+prefix+'עד '+money(round(day),currency)+' ליום'+(days?' · עד '+money(round(day*days),currency)+' לכל התקופה ('+days+' ימים)':' · בערך '+money(round(day*30),currency)+' לחודש')+'. התשלום עובר ישירות ל־Meta.';
}
function formatActionPlan(plan) {
  const p=plan.parameters || {},t=plan.target || {},currency=p.currency||plan.review?.currency,lines=[];
  const add=(icon,label,value)=>{if(value!==null&&value!==undefined&&String(value).trim())lines.push(icon+' '+label+': '+value);};
  lines.push('*'+(INTENT_HE[plan.intent]||'פעולה בחשבון הפרסום')+' — נדרש אישור מפורש*');
  if(plan.summary)lines.push(plan.summary);
  lines.push('');
  add('🏢','חשבון',t.accountName||t.accountId||'לא נבחר');
  add('📣','קמפיין',t.campaignName||p.name);
  add('🎯','מטרה',OBJECTIVE_HE[p.objective||plan.review?.objective]||p.objective||plan.review?.objective);
  add('✏️','כותרת',p.headline);
  add('💬','נוסח',p.message);
  add('🔗','יעד',p.link);
  (p.variants||[]).forEach((v,i)=>add('🅰️','גרסה '+(i+2),v.headline+' — '+String(v.message).slice(0,140)));
  if(p.variants?.length)lines.push('Meta תריץ את '+(p.variants.length+1)+' הגרסאות ותעביר יותר תקציב למה שמביא פניות.');
  if(plan.intent==='UPLOAD_IMAGE')lines.push('🖼 התמונה שאישרת בצ׳אט');
  const sets=p.adSets||plan.review?.adSets||[];
  sets.forEach((set,i)=>{const who=audience(set.targeting);const budget=set.dailyBudget!==undefined?money(set.dailyBudget,currency):minor(set.daily_budget,currency);add('👥',sets.length>1?'קהל '+(i+1):'קהל',[who,budget&&budget+' ליום'].filter(Boolean).join(' · '));});
  if(!sets.length)add('👥','קהל',audience(p.targeting));
  const was=Number(plan.review?.currentDailyBudgetMinor);
  if(plan.intent==='CHANGE_BUDGET'&&p.dailyBudget!==undefined&&Number.isFinite(was)&&was>0)add('💰','תקציב יומי','מ־'+money(was/100,currency)+' ל־'+money(p.dailyBudget,currency)+' ליום');
  else if(plan.intent==='DUPLICATE_CAMPAIGN'&&p.dailyBudget!==undefined)add('💰','תקציב יומי לעותק',money(p.dailyBudget,currency)+(Number.isFinite(was)&&was>0?' (במקור: '+money(was/100,currency)+')':''));
  else add('💰','תקציב יומי',p.dailyBudget!==undefined?money(p.dailyBudget,currency):null);
  add('▶️','התחלה',when(p.startTime||sets[0]?.startTime||sets[0]?.start_time));
  add('⏹','סיום',when(p.endTime||sets[0]?.endTime||sets[0]?.end_time));
  if(plan.intent==='CREATE_LEAD_FORM'){lines.push('✅ טופס "כוונה גבוהה": הפונה מאשר את הפרטים לפני שליחה, פחות לידים מקריים');add('📝','שאלות בטופס',(p.questions||[]).map(q=>q.label||({FULL_NAME:'שם מלא',PHONE:'טלפון',EMAIL:'אימייל',CITY:'עיר'})[q.type]||q.key||q.type||q).join(', '));add('🔒','מדיניות פרטיות',p.privacyPolicyUrl);}
  const cost=costLine(plan,p,sets,currency);if(cost)lines.push(cost);
  lines.push('');
  lines.push(plan.intent==='CREATE_LEAD_FORM'?'האישור יוצר טופס בלבד. שום מודעה לא תופעל.':plan.intent==='ACTIVATE_BUNDLE'||plan.intent==='RESUME_CAMPAIGN'?'⚠️ האישור מפעיל פרסום ומתחיל לחייב מהתקציב.':plan.intent==='DUPLICATE_CAMPAIGN'?'העותק נוצר במצב מושהה, עם אותן מודעות וקהלים. אין פרסום ואין חיוב עד אישור הפעלה נפרד.':plan.intent.startsWith('CREATE_')||plan.intent==='UPLOAD_IMAGE'?'הכול נוצר במצב מושהה. אין פרסום ואין חיוב עד אישור הפעלה נפרד.':'האישור חל רק על הפעולה הזו.');
  lines.push('מס׳ אישור: '+require('./approvalPolicy').planHash(plan).slice(0,8));
  return lines.join('\n');
}

module.exports = {
  INTENT_HE,
  WRITE_INTENTS,
  isWriteIntent,
  createActionPlan,
  formatActionPlan
};
