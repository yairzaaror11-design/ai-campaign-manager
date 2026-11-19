'use strict';
// WhatsApp presentation of a prepared campaign package: the ad image carrying
// its own copy as caption, then one short settings card with reply buttons.
const cut=(v,n)=>{const s=String(v||'').replace(/\s+/g,' ').trim();return s.length>n?s.slice(0,n-1)+'…':s;};
const UNSET=/לא נקבע|לא הוגדר|לא סופק|לא צוין|טרם|ממתין|יש להגדיר|לא ידוע|not set/iu;
function budgetMissing(note){return !String(note||'').trim()||UNSET.test(note);}
function build(view){
 if(view?.status!=='WAITING_REVIEW')return null;
 const artifacts=view.artifacts||[];
 const draft=artifacts.find(a=>a.campaignDraft&&!a.reviewed);if(!draft)return null;
 const d=draft.campaignDraft,image=artifacts.find(a=>a.mediaId&&a.imageText);
 const caption=cut(draft.adContent||draft.content,1000);
 const lines=['📋 *סיכום הקמפיין* (עוד לא עלה לאוויר)','','🎯 מטרה: '+cut(d.objective,140),'👥 קהל: '+cut(d.audience,160),'📍 אזור: '+cut(d.geography,100),'📱 איפה יופיע: '+cut(d.placements,100)];
 const missingBudget=budgetMissing(d.budgetNote);
 lines.push(missingBudget?'💰 תקציב: עוד לא נקבע':'💰 תקציב: '+cut(d.budgetNote,120));
 if(d.scheduleNote&&!UNSET.test(d.scheduleNote))lines.push('🗓 תזמון: '+cut(d.scheduleNote,100));
 if(draft.formDraft)lines.push('📝 טופס פניות: '+draft.formDraft.questions.length+' שאלות');
 const extras=artifacts.filter(a=>a!==draft&&a!==image&&!a.reviewed&&a.content).map(a=>'*'+cut(a.title,80)+'*\n'+cut(a.content,600));
 if(extras.length)lines.push('',...extras);
 lines.push('',missingBudget?'כדי להמשיך, כתוב לי כמה להוציא ביום (למשל: תקציב 30 ₪ ליום).':'אם הכול טוב, לוחצים ״מאשר״. זה אישור לתוכן בלבד, בלי פרסום ובלי חיוב.');
 return{mediaId:image?.mediaId||null,caption,card:lines.join('\n').slice(0,3800),missingBudget,choices:missingBudget?[{title:'30 ₪ ליום',text:'תקציב 30 ₪ ליום'},{title:'50 ₪ ליום',text:'תקציב 50 ₪ ליום'},{title:'לשנות משהו',text:'אני רוצה לשנות משהו בקמפיין'}]:[{title:'מאשר ✅',text:'מאשר את התוכן'},{title:'לשנות נוסח',text:'אני רוצה לשנות את נוסח המודעה'},{title:'תמונה אחרת',text:'אני רוצה תמונה אחרת למודעה'}]};
}
module.exports={build,budgetMissing};
