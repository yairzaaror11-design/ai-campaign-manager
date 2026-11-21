'use strict';
// Explicit direction-setting is a local advisory request, not a creative order.
function directionOnly(message){
 const m=String(message||'').replace(/\s+/gu,' ').trim();
 const choice=/(?:תעזור|תעזרי|עזור|עזרי|בוא|בואי|רוצה|צריך|צריכה).{0,40}(?:לבחור|לדייק|נבחר|נדייק|נגדיר)/u.test(m);
 const topic=/למי|מה כדאי|מה להציע|קהל|הצע[הת]|כיוון/u.test(m);
 const before=/לפני\s+(?:ש(?:מכינים|נכין|תכין|תכיני|מייצרים|נייצר)|הכנת|יצירת).{0,40}(?:מודעה|מודעות|עיצוב|תמונה|קמפיין)/u.test(m);
 return choice&&topic||before&&/(?:נדייק|נבחר|לבחור|תעזור|לברר|כיוון)/u.test(m);
}
function isDiscovery(value){return (value?.planningMode||value?.state?.planningMode)==='DISCOVERY_BEFORE_CREATIVE'||directionOnly(value?.request);}
module.exports={directionOnly,isDiscovery};
