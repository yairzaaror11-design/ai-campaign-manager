'use strict';
const bank = require('./data/marketing-questions.he.json');
const byId = new Map(bank.questions.map(q => [q.id, q]));
if (bank.questions.length !== 500 || byId.size !== 500) throw Error('INVALID_QUESTION_BANK');
const ROUTES = Object.freeze({
  onboarding: ['GOAL-001','BUS-001','BUS-002','GOAL-002','BUS-005','AUD-001','DIF-001','BUS-021','GOAL-021'],
  audience: ['AUD-001','AUD-002','AUD-003','AUD-011','AUD-015','AUD-021','AUD-022','AUD-024','AUD-060'],
  leads: ['MEAS-002','SALES-003','SALES-011','SALES-006','SALES-041','SALES-044','MEAS-050','EXP-010'],
  profitability: ['GOAL-002','PROF-001','PROF-002','PROF-010','PROF-011','PROF-017','PROF-018','PROF-019','PROF-020'],
  measurement: ['BUS-008','BUS-018','MEAS-001','MEAS-002','MEAS-003','MEAS-005','MEAS-009','MEAS-012','MEAS-013','MEAS-033','EXP-010'],
  creative: ['GOAL-002','AUD-001','DIF-001','CRE-001','CRE-004','CRE-011','CRE-012','CRE-021','CRE-025'],
  experiment: ['EXP-006','EXP-010','EXP-011','EXP-012','EXP-013','EXP-014','EXP-015','EXP-016','EXP-017','EXP-018','EXP-019','EXP-020']
});
for (const route of Object.values(ROUTES)) for (const id of route) if (!byId.has(id)) throw Error('INVALID_QUESTION_ROUTE');
const normalized = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[״׳"'?!.,]/g, '').trim();
function question(id) { return byId.get(String(id)) || null; }
function searchQuestions({category, query = '', ids, limit = 5} = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 8 || typeof query !== 'string' || query.length > 200) throw Error('INVALID_QUESTION_SEARCH');
  if (category && !bank.categories.some(c => c.name === category)) throw Error('INVALID_QUESTION_CATEGORY');
  if (ids && (!Array.isArray(ids) || ids.length > 8 || ids.some(id => !byId.has(id)))) throw Error('INVALID_QUESTION_IDS');
  const terms = normalized(query).split(/\s+/).filter(Boolean);
  return bank.questions.filter(q => (!category || q.category === category) && (!ids || ids.includes(q.id)))
    .map(q => ({q, score: terms.reduce((n,t) => n + (normalized([q.whatsapp_text,q.topic,q.decision_impact].join(' ')).includes(t) ? 1 : 0),0)}))
    .filter(x => !terms.length || x.score > 0).sort((a,b) => b.score-a.score || a.q.priority-b.q.priority)
    .slice(0,limit).map(({q}) => ({id:q.id, category:q.category, question:q.whatsapp_text, activation:q.activation_condition, answerType:q.answer_type, purpose:q.purpose, decisionImpact:q.decision_impact, priority:q.priority}));
}
function scopeFor(q, profile) {
  if (['BUS','AUD','DIF','SALES'].includes(q.id.split('-')[0])) return 'business';
  return 'plan:' + profile.planId; // Never reuse an old plan's goal, economy or measurement as a new plan's facts.
}
function answerFor(profile, id) {
  const q = question(id);
  return q ? profile.answers[scopeFor(q, profile) + ':' + q.storage_field] || null : null;
}
function applicable(profile, id) {
  // These are the only website-specific questions in the active measurement route.
  // Other catalogue conditions remain descriptive; they are not executed as code.
  if (['BUS-018','MEAS-012','MEAS-013'].includes(id) && profile.session?.route==='measurement') {
    const site=answerFor(profile,'BUS-008');
    if (site?.status!=='known'||typeof site.value!=='string'||!/^https?:\/\//.test(site.value)) return false;
  }
  if (id==='MEAS-013') {
    const hasCheckout = answerFor(profile,'BUS-018');
    if (hasCheckout?.status !== 'known' || hasCheckout.value !== true) return false;
  }
  return true;
}
function nextQuestion(profile) {
  const ids = ROUTES[profile.session?.route] || [];
  return ids.map(question).find(q => applicable(profile,q.id) && !answerFor(profile,q.id)) || null;
}
function parseAnswer(q, text) {
  const raw = String(text).trim();
  if (!raw || raw.length > 1800) return {error:'אפשר לשלוח תשובה קצרה עד 1,800 תווים.'};
  const n = normalized(raw);
  if (/^(לא יודע(?:ת)?|אין לי נתון|אין לי מושג|לא ידוע|דלג|לא בטוח(?:ה)?)$/.test(n)) return {value:null,status:'unknown'};
  if (/^(לא רלוונטי|לא חל)$/.test(n)) return {value:null,status:'not_applicable'};
  let status = 'known';
  let input = raw;
  if (/^(בערך|הערכה|להערכתי)\s/.test(raw)) {status='estimated';input=raw.replace(/^(בערך|הערכה|להערכתי)\s+/,'');}
  const kind = q.answer_type;
  if (kind==='קישור') {
    if (/^(אין אתר|אין לי אתר|אין|לא)$/.test(n)) return {value:null,status:'not_applicable'};
    try {
      const url=new URL(input);
      if(!['https:','http:'].includes(url.protocol)||url.username||url.password) throw Error();
      return {value:url.href,status};
    } catch {return {error:'מה כתובת האתר המלאה? למשל https://example.com. אם אין אתר, אפשר לכתוב ״אין אתר״.'};}
  }
  if (kind === 'כן/לא' || kind === 'כן/לא/לא ידוע') {
    if (/^(כן|יש)$/.test(n)) return {value:true,status};
    if (/^(לא|אין)$/.test(n)) return {value:false,status};
    return {error:'אפשר לענות כן, לא או לא ידוע.'};
  }
  if (kind.startsWith('מספר ') && !kind.includes(' או ') && !kind.includes(' ו')) {
    const m = input.replace(/,/g,'').match(/^\d+(?:\.\d+)?(?:\s+(?:ימים|יום|דקות|דקה|חודשים|חודש|שעות|שעה|לקוחות|פניות|יחידות|גרסאות|ניסיונות))?$/);
    const value = m ? Number(input.replace(/,/g,'').match(/^\d+(?:\.\d+)?/)[0]) : NaN;
    if (!Number.isFinite(value) || value < 0) return {error:'מה המספר? אפשר גם לכתוב לא ידוע.'};
    return {value,status,unit:kind.replace('מספר ','')};
  }
  if (kind === 'סכום ומטבע' || kind.startsWith('סכום ומטבע ל')) {
    const amountText=input.replace(/,/g,'');
    const nums=amountText.match(/\d+(?:\.\d+)?/g);
    const currency = /₪|ש[״"]?ח|שקל|ILS/i.test(input)?'ILS':/\$|דולר|USD/i.test(input)?'USD':/€|אירו|EUR/i.test(input)?'EUR':null;
    if (!currency || nums?.length!==1 || !Number.isFinite(Number(nums?.[0])) || /-\s*\d/.test(input)) return {error:'מה הסכום ובאיזה מטבע? למשל 1,200 ₪. אפשר גם לכתוב לא ידוע.'};
    return {value:{amount:Number(nums[0]),currency,unit:kind},status};
  }
  if (kind === 'תאריך') {
    const m = input.match(/^(\d{4})-(\d{2})-(\d{2})$/) || input.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/)?.map((v,i,a)=>i===1?a[3]:i===3?a[1]:v);
    if (!m) return {error:'מה התאריך בפורמט יום/חודש/שנה? למשל 30/11/2026. אפשר גם לכתוב לא ידוע.'};
    const iso=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    if (!Number.isFinite(Date.parse(iso)) || new Date(iso).toISOString().slice(0,10)!==iso) return {error:'התאריך לא תקין. מה התאריך בפורמט יום/חודש/שנה?'};
    return {value:iso,status};
  }
  if (kind.startsWith('אחוז')) {
    const m=input.match(/^(\d+(?:\.\d+)?)\s*(%|אחוז)?(?:\s+(.+))?$/);
    if (!m || Number(m[1])>100) return {error:'מה השיעור באחוזים, ומה התקופה או מקור ההערכה? למשל 20% לפי החודש האחרון.'};
    if (!m[2]) return {error:'האם המספר הוא באחוזים? למשל 20%.'};
    if (kind.includes('ו') && !m[3]) return {error:'על איזו תקופה או מקור מבוסס האחוז הזה? נא לשלוח יחד, למשל 20% לפי החודש האחרון.'};
    return {value:{rate:Number(m[1])/100,basis:m[3]||null},status};
  }
  return {value:input,status};
}
function formatValue(answer) {
  if (!answer) return '';
  if (answer.status==='unknown') return 'לא ידוע';
  if (answer.status==='not_applicable') return 'לא רלוונטי';
  const v=answer.value;
  return typeof v==='boolean'?(v?'כן':'לא'):v&&typeof v==='object'?(v.amount!==undefined?`${v.amount} ${v.currency}`:v.rate!==undefined?`${v.rate*100}% (${v.basis||'ללא מקור'})`:JSON.stringify(v)):String(v??'');
}
function summary(profile) {
  const labels={'BUS-001':'שם העסק','BUS-002':'מה העסק עושה','BUS-005':'אזורי שירות','BUS-008':'אתר','BUS-018':'רכישה באתר','BUS-021':'קיבולת חודשית','GOAL-001':'המטרה','GOAL-002':'השירות לקידום','GOAL-021':'מועד היעד','AUD-001':'לקוחות מתאימים','AUD-002':'לקוחות שאינם מתאימים','AUD-003':'אזורי הקהל הרצוי','DIF-001':'סיבת הבחירה בעסק','SALES-003':'זמן לתגובה ראשונה','SALES-041':'שיעור סגירה מדווח','SALES-044':'יכולת טיפול בפניות','PROF-001':'מחיר עסקה נטו','PROF-002':'עלות משתנה לעסקה','PROF-010':'תרומה רצויה אחרי פרסום','PROF-011':'בסיס עלות הגיוס','PROF-017':'שיעור סגירה צפוי','PROF-018':'שיעור התאמה צפוי','PROF-019':'עלות טיפול נוספת בפנייה','PROF-020':'תקרת עלות גיוס','MEAS-001':'הגדרת פנייה','MEAS-002':'הגדרת פנייה מתאימה','MEAS-003':'הגדרת עסקה','MEAS-005':'תקופת המדידה','MEAS-009':'עדכניות הנתונים'};
  return Object.values(profile.answers).filter(a=>a.scope==='business'||a.scope==='plan:'+profile.planId)
    .slice(-12).map(a=>`${labels[a.questionId]||question(a.questionId)?.whatsapp_text||a.questionId}: ${formatValue(a)}${a.status==='estimated'?' (הערכה)':''}`).join('\n');
}
module.exports={question,searchQuestions,ROUTES,scopeFor,answerFor,applicable,nextQuestion,parseAnswer,formatValue,summary,normalized};
