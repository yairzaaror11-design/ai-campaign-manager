'use strict';
function owner({text,profile,hasOpenBrief}){
 if(/^\/campaign-(status|draft|activate)(?:\s|$)/.test(text))return'lifecycle';
 if(/^\/brief(?:-|\s)/.test(text))return'brief';
 if(text.startsWith('/')&&!['/start','/discovery','/discovery-status'].includes(text))return'other';
 if(hasOpenBrief&&(!profile?.journey||profile.journey.stage==='IDLE'))return'brief';
 return'marketing';
}
module.exports={owner};
