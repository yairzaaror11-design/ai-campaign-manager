'use strict';
const normalize=s=>String(s||'').normalize('NFKC').replace(/[״׳"']/g,'').replace(/\s+/g,' ').trim().toLowerCase();
function page(connection){
 const query=normalize(connection.accountQuery);
 const list=(connection.accounts||[]).filter(a=>!query||normalize(a.name).includes(query));
 const index=Math.max(0,Math.min(Number(connection.accountPage)||0,Math.max(0,Math.ceil(list.length/8)-1)));
 const offset=index*8;
 return {index,offset,total:list.length,items:list.slice(offset,offset+8),hasNext:offset+8<list.length};
}
function reply(connection){const p=page(connection);return p.total?`באיזה חשבון נרצה לעבוד? (${p.offset+1}–${p.offset+p.items.length} מתוך ${p.total})\n`+p.items.map((a,i)=>`${p.offset+i+1}. ${a.name}`).join('\n')+'\nאפשר גם לכתוב ״תעבור לחשבון״ ואת שם החשבון.':'לא נמצאו חשבונות בשם הזה. אפשר לכתוב ״החשבונות שלי״ להצגת כולם.';}
module.exports={normalize,page,reply};
