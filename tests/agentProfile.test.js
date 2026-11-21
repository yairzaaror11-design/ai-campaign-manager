'use strict';
// Every fixed owner-facing text must follow the agent's writing rules (agentProfile.check).
const test=require('node:test'),assert=require('node:assert/strict');
const profile=require('../agentProfile');

function strings(value,path,out){
 if(typeof value==='string')out.push([path,value]);
 else if(typeof value==='function'){try{const r=value({monthly:2400,daily:80,headline:'כותרת',body:'גוף',cta:'פנו אלינו',n:100,count:2,total:5},'x');strings(r,path+'()',out);}catch{/* needs other args */}}
 else if(value&&typeof value==='object'&&!(value instanceof RegExp))for(const [k,v] of Object.entries(value))strings(v,path+'.'+k,out);
 return out;
}

test('checker catches jargon, commands, long and multi-question messages',()=>{
 assert.deepEqual(profile.check('מה התקציב היומי לפרסום?'),[]);
 assert.ok(profile.check('מטרה: LEAD_GENERATION').includes('JARGON'));
 assert.ok(profile.check('כדי להמשיך כתוב: "בטל את המשימה"').includes('COMMAND'));
 assert.ok(profile.check('מה העסק? ומה התקציב?').includes('MANY_QUESTIONS'));
 assert.ok(profile.check('א'.repeat(700)).includes('TOO_LONG'));
});

test('onboarding wording follows the writing rules',()=>{
 const bad=strings(require('../onboardingCopy'),'copy',[]).filter(([,t])=>t.trim()).map(([p,t])=>[p,profile.check(t,{limit:900})]).filter(([,i])=>i.length);
 assert.deepEqual(bad,[]);
});
