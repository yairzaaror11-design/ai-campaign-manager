'use strict';
function classify(text){
 const n=String(text).trim();
 if(/^לא\s+אני\s+(?:רוצה|צריך|צריכה).*(?:סושיאל|פוסט|סטורי|תוכן)/.test(n))return{kind:'ambiguous'};
 const clauses=n.split(/[,;\n]|\s+(?:אבל|אלא|במקום)\s+/).map(s=>s.trim()).filter(Boolean);
 let selected=null,rejected=null;const asserted=[];
 for(let i=0;i<clauses.length;i++){
  const c=clauses[i];
  if(/^(?:מה זה|מה ההבדל|מה הכוונה|איך|למה|האם|אולי|ואולי)(?:\s|$)/.test(c))return{kind:null,question:true};
  const social=/סושיאל|פוסט|סטורי|לוח תוכן/.test(c),paid=/קמפיין|מודע[הת]|פניות ותורים/.test(c);
  if(/(?:^|\s)(?:לא\s+(?:רוצה|רוצים|צריך|צריכה|מעוניין|מעוניינת)|בלי)(?:\s|$)/.test(c)){if(social)rejected='social';else if(paid)rejected='paid';continue;}
  asserted.push(c);
  const asks=/רוצה|רוצים|צריך|צריכה|תכין|תכיני|כתוב|כתבי|הכן|נעבור|להכין|נכין/.test(c)||i>0;
  if(asks&&social)selected='social';else if(asks&&paid)selected='paid';
 }
 if(selected)return{kind:selected,correction:!!rejected,assertion:asserted.join('\n')};
 if(rejected)return{kind:'reject',channel:rejected};
 return{kind:null};
}
module.exports={classify};
