'use strict';
// A conservative offline guard. The model still handles the meaning of free-form messages.
function isDetour(text){
 const n=String(text||'').trim();
 return /[?？]/.test(n)||/^(?:איך|למה|מה\s|כמה\s|מי\s|אפשר\s|האם\s|תסביר|לא הבנתי|רגע|שאלה|עזוב רגע|יקר לי|זה יקר|אין לי כסף|אני חושש|אני מפחד|אני לא בטוח|אתה לא מבין|את לא מבינה|אתה חוזר|כבר עניתי|כבר אמרתי|תעזור|תעזרי|אני רוצה לשאול|לא רוצה לענות|זה לא מה)/.test(n);
}
function partialDraftRequested(text){return /(?:טיוטה|דוגמה|נוסח ראשוני).*(?:מה שיש|מה שידוע|בלי עוד שאלות|בלי שאלות|בינתיים)|(?:מה שיש|מה שידוע|בלי עוד שאלות|בלי שאלות|בינתיים).*(?:טיוטה|דוגמה|נוסח ראשוני)/.test(text);}
function detour(j){j.detour=true;return{handled:false,changed:true};}
module.exports={isDetour,partialDraftRequested,detour};
