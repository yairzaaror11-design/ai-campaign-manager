'use strict';
// Only direct conversation-control requests, never quoted examples or business facts.
function isReset(text){
 const n=String(text||'').normalize('NFKC').trim().replace(/[.!?]+$/,'');
 return n==='/reset'||/^(?:בבקשה\s+)?(?:תמחק|מחק|מחקי|תמחקי|אפס|אפסי|תאפס|תאפסי)\s+(?:לי\s+)?(?:את\s+)?(?:כל\s+)?(?:השיחה|הצאט|הצ׳אט|הצ'אט|האפיון)(?:\s*[,،.]?\s*(?:אני רוצה|אני רוצה שנ|ו?בוא|ו?בואו|ו?נרצה)?\s*(?:להתחיל|נתחיל|להתחיל את השיחה)\s+מחדש)?$/.test(n)||/^(?:אני רוצה\s+)?(?:להתחיל|נתחיל|בוא נתחיל|בואי נתחיל)\s+(?:את השיחה\s+)?מחדש$/.test(n);
}
function hasControlContamination(text){
 return typeof text==='string'&&/(?:תמחק|מחק|מחקי|תמחקי|אפס|אפסי|תאפס|תאפסי)\s+(?:לי\s+)?(?:את\s+)?(?:כל\s+)?(?:השיחה|הצאט|הצ׳אט|הצ'אט|האפיון)/.test(text);
}
module.exports={isReset,hasControlContamination};
