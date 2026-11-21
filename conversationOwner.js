'use strict';
function owner({text,profile,hasOpenBrief}){
 if(/^\/campaign-(status|draft|activate)(?:\s|$)/.test(text))return'lifecycle';
 if(/^\/brief(?:-|\s)/.test(text))return'brief';
 if(text.startsWith('/')&&!['/start','/discovery','/discovery-status'].includes(text))return'other';
 if(require('./businessEntry').enabled()&&(/https:\/\//.test(text)||/^(פתח חשבון|הרשמה|דשבורד|החשבון שלי|תצוגה מקדימה|ניהול לידים|הפניות שלי|הלידים שלי)$/.test(text)||profile?.businessEntry?.awaitingConfirmation||profile?.businessEntry?.awaitingLink))return'marketing';
 if(hasOpenBrief&&(!profile?.journey||profile.journey.stage==='IDLE'))return'brief';
 return'marketing';
}
module.exports={owner};
