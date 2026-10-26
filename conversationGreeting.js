'use strict';
const WELCOME='🙋 היי, אני סוכן השיווק החכם של קמפיין בצא׳ט - מה לעשות בשבילך היום?';
function isGreeting(text){
 if(typeof text!=='string'||text.length>120)return false;
 const normalized=text.normalize('NFKC').replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u200D]/gu,'').replace(/[!?.,؟！？，]+/g,' ').replace(/\s+/g,' ').trim();
 return /^(?:הי{1,5}|שלום(?: לך| בוט)?|אהלן|אהלן אהלן|הל[וו]{1,3}|בוקר טוב|צהריים טובים|ערב טוב|שבוע טוב|מה נשמע|מה קורה|hi|hey|hello|\/start)(?: (?:מה נשמע|מה קורה))?$/iu.test(normalized);
}
module.exports={WELCOME,isGreeting};
