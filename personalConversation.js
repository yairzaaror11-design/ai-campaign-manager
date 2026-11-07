'use strict';
function name(value){
 if(typeof value!=='string')return null;
 const n=value.normalize('NFKC').trim();
 if(/\b(?:ignore|instructions|system|assistant|execute)\b|הוראות|תתעלם|תפעיל|תפרסם/i.test(n))return null;
 return n.length>0&&n.length<=40&&/^[\p{L}\p{M} '\u2019\u05f3\u05f4-]+$/u.test(n)&&!require('./conversationControl').hasControlContamination(n)?n:null;
}
function explicit(text){
 const m=String(text).trim().match(/^(?:קוראים לי|השם שלי(?: הוא)?|אפשר לקרוא לי|תקרא לי|תקראי לי)\s+(.+)$/);
 return m?name(m[1]):null;
}
function decorate(p,text,key){
 const n=p.person?.name;
 if(!name(n)||p.person.disabled||typeof text!=='string'||text.includes(n))return text;
 const count=p.person.replyCount||0;p.person.replyCount=count+1;
 // A name belongs in a natural opening or question, never inside a financial review.
 if(key==='action_approval'||!/[?？]/.test(text)||count%3!==0)return text;
 if(key==='welcome')return text.replace(/^היי!/,`היי ${n}!`);
 return `${n}, ${text}`;
}
async function hydrate(clientId){
 const db=require('./db'),store=require('./marketingStore');
 const p=await store.load(clientId);if(p?.person)return;
 const row=(await db.query('SELECT display_name FROM clients WHERE id=$1',[clientId])).rows[0];
 const n=name(row?.display_name);if(!n)return;
 await store.update(clientId,null,profile=>{if(profile.person)return{handled:false};profile.person={name:n,source:'whatsapp_profile',replyCount:0};return{handled:false,changed:true};});
}
async function handle(clientId,text,eventId){
 const n=explicit(text),disable=/^(?:אל תקרא לי בשם|בלי לפנות בשם|בלי שם)$/.test(text);
 if(!n&&!disable)return null;
 return require('./marketingStore').update(clientId,eventId,p=>{p.person=disable?{disabled:true}:{name:n,source:'user_explicit',replyCount:1};return{handled:true,reply:disable?'בסדר, אמשיך בלי לפנות בשם.':`נעים להכיר, ${n}. נמשיך מהמקום שבו עצרנו.`,historyReply:disable?'התבקשה פנייה ללא שם.':`הלקוח ביקש פנייה בשם ${n}.`};});
}
module.exports={name,explicit,decorate,hydrate,handle};
