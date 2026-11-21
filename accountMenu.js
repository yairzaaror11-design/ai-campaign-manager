'use strict';
const normalize=s=>String(s||'').normalize('NFKC').replace(/[״׳"']/g,'').replace(/\s+/g,' ').trim().toLowerCase();
function page(connection){
 const query=normalize(connection.accountQuery);
 const list=(connection.accounts||[]).filter(a=>!query||normalize(a.name).includes(query));
 const index=Math.max(0,Math.min(Number(connection.accountPage)||0,Math.max(0,Math.ceil(list.length/8)-1)));
 const offset=index*8;
 return {index,offset,total:list.length,items:list.slice(offset,offset+8),hasNext:offset+8<list.length};
}
const digits=a=>String(a?.id||'').replace(/\D/g,'').slice(-4);
// "…" marks a cut name; the full name and the account's last digits tell similar names apart.
function shortName(name,max){const n=String(name||'חשבון ללא שם').trim();return n.length>max?n.slice(0,max-1).trimEnd()+'…':n;}
function sameName(a,all){return (all||[]).filter(b=>normalize(b.name)===normalize(a.name)).length>1;}
function describe(a,all){const tail=digits(a)?`מספר חשבון שמסתיים ב־${digits(a)}`:'';const full=String(a.name||'').length>16?String(a.name).slice(0,72-tail.length-3):'';return [full,tail].filter(Boolean).join(' · ').slice(0,72)||undefined;}
function label(a,all){return String(a.name||'חשבון ללא שם')+(sameName(a,all)&&digits(a)?` (מסתיים ב־${digits(a)})`:'');}
function reply(connection){const p=page(connection);return p.total?`באיזה חשבון נרצה לעבוד? (${p.offset+1}–${p.offset+p.items.length} מתוך ${p.total})\n`+p.items.map((a,i)=>`${p.offset+i+1}. ${label(a,connection.accounts)}`).join('\n')+'\nאפשר גם פשוט לבקש ממני לעבור לחשבון לפי השם שלו.':'לא מצאתי חשבון בשם הזה. אם תרצה, רק תבקש ואציג לך את כל החשבונות.';}
module.exports={normalize,page,reply,shortName,describe,label};
