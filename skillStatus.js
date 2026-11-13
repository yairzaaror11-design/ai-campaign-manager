'use strict';
// Local wiring checks only: never call providers, spend money or grant authority.
function check(){
 const capabilities=require('./botCapabilities'),guides=require('./professionalSkills').SKILLS;
 const declarations=new Set(require('./gemini').functionDeclarations.map(t=>t.name));
 const operations=Object.keys(require('./businessCase').OPS);
 const missing=capabilities.READ_TOOLS.filter(name=>!declarations.has(name));
 const invalidGuides=guides.filter(g=>!g.id||!g.checks.length||g.calculators.some(op=>!operations.includes(op))).map(g=>g.id);
 const duplicates=guides.length!==new Set(guides.map(g=>g.id)).size;
 return{ok:missing.length===0&&invalidGuides.length===0&&!duplicates,scope:'LOCAL_REGISTRY_WIRING_ONLY',guides:guides.length,readTools:capabilities.READ_TOOLS.length,analysisOperations:operations.length,missing,invalidGuides,duplicates,providerAccessVerified:false};
}
function requested(message){
 const text=message.normalize('NFKC').trim().replace(/[?!.,:]/g,'').replace(/\s+/g,' ');
 return /^(?:\/skills(?:-check)?|בדיקת סקילים|בדוק סקילים|תבדוק את (?:כל )?הסקילים|מה מצב הסקילים|איזה סקילים מחוברים)$/i.test(text);
}
function reply(){
 const result=check(),evaluation=require('./taskEvaluation').status();
 const model=evaluation.status==='PASSED'?'בדיקת המודל עברה':evaluation.status==='RUNNING'?'בדיקת המודל מתבצעת כעת':'בדיקת המודל טרם עברה';
 const gate=process.env.TASK_AGENT_REQUIRE_EVAL==='true'?'בדיקת המודל נדרשת לפני ביצוע משימות':'בדיקת המודל אינה מוגדרת כחובה';
 const guideNames=require('./professionalSkills').SKILLS.map(g=>g.title).join(' · ');
 return {handled:true,externalActionsExecuted:false,reply:[
  result.ok?`בדיקת החיבור בקוד עברה: ${result.guides} מדריכי שיווק ו־${result.readTools} כלי קריאה זמינים למנגנון השיחה.`:'בדיקת החיבור בקוד נכשלה. ביצוע משימות נעצר עד לתיקון.',
  `${model}; ${gate}.`,
  guideNames,
  'המדריכים הם ידע וניתוח חלקיים. הבדיקה אינה מאמתת הרשאות אצל ספקים או ביצוע קמפיין בפועל. Google Ads ויצירת סרטונים טרם מחוברים לביצוע; CRM וסליקה מחוץ להפעלה. פרסום והוצאה כספית דורשים אישור מתאים.'
 ].join('\n\n')};
}
module.exports={check,requested,reply};
