'use strict';
const qs=require('./marketingQuestions');
function fact(p,id) {const a=qs.answerFor(p,id);return a?.status==='known'?a.value:null;}
function performanceInsight({spend,leads,sales,priorSpend,priorLeads}={}) {
 if(![spend,leads].every(x=>Number.isFinite(x)&&x>=0)) return {status:'insufficient_data',message:'נדרשים נתוני הוצאה ופניות מאומתים לאותה תקופה.'};
 const cpl=leads>0?spend/leads:null;
 const previous=Number.isFinite(priorSpend)&&Number.isFinite(priorLeads)&&priorLeads>0&&priorSpend>=0?priorSpend/priorLeads:null;
 const change=cpl!==null&&previous!==null&&previous>0?(cpl/previous-1):null;
 const salesCount=Number.isInteger(sales)&&sales>=0?sales:null;
 return {status:'observed',cpl,sales:salesCount,change,insight:leads===0?'לא נמדדו פניות בתקופה. יש לבדוק קודם את תקינות המדידה והחשיפה.':change!==null&&change>0.2?'עלות הפנייה עלתה ביותר מ-20% ביחס לתקופה הקודמת. מומלץ לבדוק קהל, מסר ומדידה לפני שינוי תקציב.':'הנתונים תיאוריים בלבד; יש לבדוק איכות פניות והמרה למכירה לפני החלטה.'};
}
function nextAction(p) {
 const audience=String(fact(p,'AUD-001')||'');
 const offer=String(fact(p,'GOAL-002')||'');
 const goal=String(fact(p,'GOAL-001')||'');
 const suggestions=[];
 if(/כל (?:התחומים|בעלי העסקים)|כולם|מכל התחומים|לכל בעל עסק/.test(audience))
   suggestions.push('קהל היעד רחב. אפשר להתחיל בבדיקת ענף שבו כבר יש ניסיון מוכח, אם קיים, במקום להניח שכל הענפים יגיבו באופן דומה.');
 if(/14\s*(?:יום|ימים)/.test(offer))
   suggestions.push('אם מציעים 14 ימי ניהול ללא עלות, צריך לוודא בנפרד מי משלם את המדיה ומה המחיר לאחר ההתנסות.');
 if(/מכירות/.test(goal))
   suggestions.push('המטרה העסקית היא מכירות. יעד הקמפיין בפלטפורמה ייבחר רק לאחר בירור מסלול ההמרה והמדידה.');
 return suggestions;
}
function draft(p) {
 const name=fact(p,'BUS-001'),service=fact(p,'BUS-002'),audience=fact(p,'AUD-001');
 const offer=fact(p,'GOAL-002'),region=fact(p,'BUS-005'),goal=fact(p,'GOAL-001');
 const known=[['עסק',name],['מוצר או שירות',service],['מטרה עסקית',goal],['קהל מדווח',audience],['אזור שירות',region],['הצעה לקידום',offer]].filter(x=>x[1]!=null);
 const lines=['טיוטת אסטרטגיה לבדיקה (לא קמפיין שנוצר ב-Meta):',...known.map(([k,v])=>k+': '+String(v))];
 lines.push('כיוון מומלץ לבדיקה: מסר שמציג את השירות והיתרון המרכזי, מול מסר שמדגיש את ההצעה. אלו השערות לניסוי, לא הבטחה לתוצאה.');
 const insights=nextAction(p);if(insights.length)lines.push('שיקולים מקצועיים:',...insights);
 lines.push('לפני יצירה ב-Meta יש לאמת תקציב, יעד המרה, נכסי מודעה, חשבון מחובר והרשאות. כל יצירה תתחיל במצב PAUSED ותדרוש אישור מפורש; הפעלה דורשת אישור נפרד.');
 return lines.join('\n');
}
module.exports={fact,nextAction,draft,performanceInsight};
