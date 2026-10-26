'use strict';
const db=require('./db');
const meta=require('./metaConnection');
const store=require('./marketingStore');
const {norm}=require('./conversationAnalysis');
const STATES=['NOT_CONNECTED','CONNECTION_OFFERED','AWAITING_OAUTH','OAUTH_CALLBACK_RECEIVED','ACCOUNT_SELECTION_REQUIRED','VERIFYING_ACCESS','CONNECTED','MISSING_PERMISSIONS','TOKEN_EXPIRED','RECONNECT_REQUIRED','CONNECTION_FAILED','DISCONNECTED'];
const TRANSITIONS={
 NOT_CONNECTED:['CONNECTION_OFFERED','AWAITING_OAUTH','VERIFYING_ACCESS','OAUTH_CALLBACK_RECEIVED','DISCONNECTED'],
 CONNECTION_OFFERED:['AWAITING_OAUTH','NOT_CONNECTED','VERIFYING_ACCESS','DISCONNECTED'],
 AWAITING_OAUTH:['OAUTH_CALLBACK_RECEIVED','VERIFYING_ACCESS','CONNECTION_OFFERED','CONNECTION_FAILED','NOT_CONNECTED','DISCONNECTED'],
 OAUTH_CALLBACK_RECEIVED:['VERIFYING_ACCESS','MISSING_PERMISSIONS','CONNECTION_FAILED','DISCONNECTED'],
 VERIFYING_ACCESS:['CONNECTED','ACCOUNT_SELECTION_REQUIRED','MISSING_PERMISSIONS','TOKEN_EXPIRED','RECONNECT_REQUIRED','CONNECTION_FAILED','NOT_CONNECTED','DISCONNECTED'],
 CONNECTED:['VERIFYING_ACCESS','TOKEN_EXPIRED','RECONNECT_REQUIRED','MISSING_PERMISSIONS','CONNECTION_OFFERED','DISCONNECTED'],
 ACCOUNT_SELECTION_REQUIRED:['VERIFYING_ACCESS','CONNECTION_OFFERED','AWAITING_OAUTH','DISCONNECTED'],
 MISSING_PERMISSIONS:['CONNECTION_OFFERED','AWAITING_OAUTH','VERIFYING_ACCESS','NOT_CONNECTED','DISCONNECTED'],
 TOKEN_EXPIRED:['CONNECTION_OFFERED','AWAITING_OAUTH','VERIFYING_ACCESS','RECONNECT_REQUIRED','NOT_CONNECTED','DISCONNECTED'],
 RECONNECT_REQUIRED:['CONNECTION_OFFERED','AWAITING_OAUTH','VERIFYING_ACCESS','NOT_CONNECTED','DISCONNECTED'],
 CONNECTION_FAILED:['CONNECTION_OFFERED','AWAITING_OAUTH','VERIFYING_ACCESS','NOT_CONNECTED','DISCONNECTED'],
 DISCONNECTED:['CONNECTION_OFFERED','AWAITING_OAUTH','VERIFYING_ACCESS','NOT_CONNECTED','OAUTH_CALLBACK_RECEIVED']
};
// A validated, single-use OAuth callback may arrive while an earlier account is still selected.
for(const from of ['CONNECTION_OFFERED','CONNECTED','ACCOUNT_SELECTION_REQUIRED','MISSING_PERMISSIONS','TOKEN_EXPIRED','RECONNECT_REQUIRED','CONNECTION_FAILED'])TRANSITIONS[from].push('OAUTH_CALLBACK_RECEIVED');
function move(connection,status,data={}){
 const previous=connection?.status||'NOT_CONNECTED';
 if(!STATES.includes(status)||!TRANSITIONS[previous]||previous!==status&&!TRANSITIONS[previous].includes(status))throw Error('INVALID_CONNECTION_TRANSITION');
 return{...connection,...data,status,updatedAt:new Date().toISOString()};
}
async function recordStatus(clientId,status,data={}){
 return store.update(clientId,null,p=>{
  p.connection=move(p.connection,status,data);
  return{handled:false,changed:true,audit:'META_CONNECTION_'+status};
 });
}
function safeError(error){return ['ADS_READ_REQUIRED','META_CONNECTION_REQUIRED','ACCOUNT_NOT_GRANTED','INVALID_ACCOUNT','TOKEN_RECONNECT_REQUIRED','CONNECTION_REVOKED','META_TOKEN_EXPIRED','META_PERMISSION_REQUIRED'].includes(error?.message)?error.message:'META_REQUEST_FAILED';}
async function verify(clientId){
 const before=(await db.query('SELECT c.meta_ad_account_id,c.meta_generation,m.expires_at,m.app_id FROM clients c LEFT JOIN meta_connections m ON m.client_id=c.id WHERE c.id=$1',[clientId])).rows[0];
 if(!before)throw Error('MARKETING_CLIENT_NOT_FOUND');
 if(!before.expires_at||before.app_id!==process.env.META_APP_ID){
  const p=await store.load(clientId);const status=p?.connection?.status==='DISCONNECTED'?'DISCONNECTED':'NOT_CONNECTED';
  if(p?.connection?.status&&!['NOT_CONNECTED','DISCONNECTED'].includes(p.connection.status))await recordStatus(clientId,'VERIFYING_ACCESS');
  await recordStatus(clientId,status,{account:null,accounts:[],permissions:[],lastCheckAt:new Date().toISOString(),lastError:null});
  return{status,accounts:[],permissions:[],canRead:false,canManage:false};
 }
 await recordStatus(clientId,'VERIFYING_ACCESS');
 if(new Date(before.expires_at).getTime()<=Date.now()){
  await recordStatus(clientId,'TOKEN_EXPIRED',{account:null,lastError:'TOKEN_EXPIRED',lastCheckAt:new Date().toISOString()});
  return{status:'TOKEN_EXPIRED',accounts:[],permissions:[],canRead:false,canManage:false};
 }
 try {
  const credentials=await meta.credentials(clientId);
  const permissions=(await meta.graph('/me/permissions',credentials.token)).data||[];
  const granted=permissions.filter(p=>p.status==='granted'&&typeof p.permission==='string').map(p=>p.permission);
  if(!granted.includes('ads_read')){
   await recordStatus(clientId,'MISSING_PERMISSIONS',{permissions:granted,lastError:'ADS_READ_REQUIRED',lastCheckAt:new Date().toISOString(),account:null});
   return{status:'MISSING_PERMISSIONS',permissions:granted,accounts:[],canRead:false,canManage:false,missing:['ads_read']};
  }
  const list=(await meta.accounts(clientId)).data.filter(a=>/^act_\d+$/.test(a.id)&&a.account_status===1).map(a=>({id:a.id,name:String(a.name||a.id).slice(0,200),currency:a.currency||null}));
  const selected=list.find(a=>a.id===before.meta_ad_account_id)||null;
  const status=selected?'CONNECTED':'ACCOUNT_SELECTION_REQUIRED';
  let stale=false;
  await store.update(clientId,null,async p=>{
   const latest=(await db.query('SELECT meta_generation FROM clients WHERE id=$1',[clientId])).rows[0];
   if(!latest||String(latest.meta_generation)!==String(before.meta_generation)){stale=true;return{handled:false};}
   p.connection=move(p.connection,status,{account:selected,accounts:list,permissions:granted,lastCheckAt:new Date().toISOString(),lastError:null,verifiedGeneration:String(before.meta_generation)});
   return{handled:false,changed:true,audit:'META_CONNECTION_'+status};
  });
  if(stale)return{status:'RECONNECT_REQUIRED',accounts:[],permissions:[],canRead:false,canManage:false};
  return{status,accounts:list,account:selected,permissions:granted,canRead:!!selected,canManage:!!selected&&granted.includes('ads_management')&&process.env.META_WRITES_ENABLED==='true'&&process.env.READ_ONLY==='false'};
 } catch(error){
  const status=error.message==='META_TOKEN_EXPIRED'?'TOKEN_EXPIRED':error.message==='META_PERMISSION_REQUIRED'?'MISSING_PERMISSIONS':'CONNECTION_FAILED';
  await recordStatus(clientId,status,{lastError:safeError(error),lastCheckAt:new Date().toISOString(),account:null});
  return{status,accounts:[],permissions:[],canRead:false,canManage:false,error:safeError(error)};
 }
}
function statusReply(v){
 if(v.status==='CONNECTED')return`החשבון ״${v.account.name}״ אומת וחובר. ${v.canManage?'כל שינוי ידרוש אישור נפרד.':'אפשר לקרוא נתונים; שינוי קמפיינים אינו זמין כרגע.'} אפשר לבדוק קמפיינים קיימים או להכין טיוטה חדשה.`;
 if(v.status==='ACCOUNT_SELECTION_REQUIRED')return v.accounts.length?'אלה חשבונות הפרסום הזמינים:\n'+v.accounts.map((a,i)=>`${i+1}. ${a.name} (${a.id})`).join('\n')+'\nבאיזה חשבון נרצה לעבוד?':'ההרשאה נקלטה, אך לא נמצא חשבון מודעות פעיל שאפשר לבחור. אפשר לבדוק גישה במנהל המודעות או להכין טיוטה מקומית.';
 if(v.status==='MISSING_PERMISSIONS')return v.missing?.includes('ads_read')?'חסרה הרשאת ads_read לקריאת נתוני הפרסום. אין כרגע גישה לדוחות. אפשר לבדוק את הרשאות החיבור ב-Meta ולחבר מחדש.':'Meta חסמה את בדיקת הגישה בגלל הרשאות. אין כרגע אפשרות לקרוא דוחות; צריך לבדוק את ההרשאה לחשבון ולחיבור ב-Meta לפני ניסיון נוסף.';
 if(v.status==='TOKEN_EXPIRED'||v.status==='RECONNECT_REQUIRED')return'ההרשאה אינה תקפה כרגע. אפשר להכין טיוטה מקומית או לבקש קישור אישי לחיבור מחדש.';
 if(v.status==='CONNECTION_FAILED')return'לא הצלחתי לאמת את החיבור מול Meta כרגע. לא אסמן אותו כמחובר. אפשר לנסות בדיקה חדשה או להמשיך בטיוטה מקומית.';
 return'אין כרגע חשבון Meta מחובר ומאומת. אפשר לחבר אותו או להכין קודם טיוטה מקומית.';
}
async function offer(clientId,eventId){
 const v=await verify(clientId);
 if(['CONNECTED','ACCOUNT_SELECTION_REQUIRED'].includes(v.status))return{handled:true,reply:statusReply(v)};
 return store.update(clientId,eventId,p=>{
  p.connection=move(p.connection,'CONNECTION_OFFERED');
  return{handled:true,reply:'כדי לבדוק נתוני פרסום נחבר את החשבון דרך Meta, בלי לשלוח סיסמה בצ׳אט. לשלוח קישור אישי לחיבור?',audit:'META_CONNECTION_OFFERED'};
 });
}
async function invite(clientId,eventId){
 let claimed=false;
 const claim=await store.update(clientId,eventId,p=>{
  if(p.connection?.status==='AWAITING_OAUTH')return{handled:true,reply:'כבר נשלח קישור לחיבור. אפשר להשלים אותו, או לבקש במפורש קישור חדש אם פג תוקפו.'};
  p.connection=move(p.connection,'AWAITING_OAUTH');claimed=true;
  return{handled:true,reply:'הבקשה לקישור נקלטה. אם הקישור לא התקבל אפשר לבקש קישור חדש.',audit:'META_OAUTH_INVITE_REQUESTED'};
 });
 if(!claimed)return claim;
 try {return{handled:true,reply:'קישור אישי לחיבור Meta, תקף לעשר דקות. אין להעביר לאחרים:\n'+await meta.createInvite(clientId),historyReply:'נשלח קישור אישי לחיבור Meta. כתובת הקישור לא נשמרה בהיסטוריית השיחה.'};}
 catch(error){await recordStatus(clientId,'CONNECTION_FAILED',{lastError:safeError(error)});return{handled:true,reply:'לא הצלחתי ליצור קישור כרגע. אפשר להמשיך בטיוטה ולנסות חיבור בהמשך.'};}
}
async function handle(clientId,text,analysis,eventId){
 const p=await store.load(clientId);const n=norm(text);
 if(/להתחיל לפרסם (?:בפייסבוק|במטא)/.test(text)){
  const v=await verify(clientId);if(v.status==='CONNECTED')return{handled:true,reply:statusReply(v)};
  return store.update(clientId,eventId,profile=>{profile.connection={...(profile.connection||{}),status:profile.connection?.status||'NOT_CONNECTED',pendingQuestion:'hasAdAccount'};return{handled:true,reply:'יש כבר חשבון מודעות ב-Meta, או שזו הפעם הראשונה של העסק בפרסום?'};});
 }
 if(p?.connection?.pendingQuestion==='hasAdAccount'&&['yes','no'].includes(analysis.intent)){
  await store.update(clientId,null,profile=>{profile.connection.pendingQuestion=null;profile.connection.hasAdAccount=analysis.intent==='yes';return{handled:false,changed:true};});
  if(analysis.intent==='no'){
    await store.update(clientId,null,profile=>{require('./campaignJourney').init(profile).pendingAction='prepare_local_draft';return{handled:false,changed:true};});
    return{handled:true,reply:'אפשר להכין כאן אסטרטגיה ומודעות גם לפני פתיחת חשבון. את החשבון והגישה צריך להקים במסך הרשמי של Meta; לא אבקש סיסמה בצ׳אט. להכין קודם טיוטת קמפיין?'};
  }
  return offer(clientId,eventId);
 }
 const explicit=text.match(/^\/meta-select\s+(act_\d+)$/)||text.match(/^(?:בחר|בחירה|לעבוד עם)\s+(act_\d+)$/);
 const selection=p?.connection?.status==='ACCOUNT_SELECTION_REQUIRED'&&(explicit||/^\d{1,3}$/.test(n)||(analysis.intent==='yes'&&p.connection.accounts?.length===1));
 if(selection||explicit){
  const fresh=await verify(clientId);
  const id=explicit?.[1]||fresh.accounts?.[(analysis.intent==='yes'?1:Number(n))-1]?.id;
  if(!id||!fresh.accounts?.some(a=>a.id===id))return{handled:true,reply:'החשבון הזה אינו ברשימת החשבונות שאומתו עבורך.\n'+statusReply(fresh)};
  try {await meta.selectAccount(clientId,id);return{handled:true,reply:statusReply(await verify(clientId))};}
  catch{return{handled:true,reply:'לא ניתן לבחור את החשבון הזה בלי גישה תקפה. אפשר לבדוק שוב את רשימת החשבונות.'};}
 }
 if(analysis.intent==='yes'&&p?.connection?.status==='CONNECTION_OFFERED')return invite(clientId,eventId);
 if(text==='/meta-connect'||/^(?:שלח|שלחי) (?:לי )?קישור (?:חדש )?(?:לחיבור|למטא|Meta)/i.test(n)){
  if(text==='/meta-connect'){
    const v=await verify(clientId);if(['CONNECTED','ACCOUNT_SELECTION_REQUIRED'].includes(v.status))return{handled:true,reply:statusReply(v)};
  }
  if(p?.connection?.status==='AWAITING_OAUTH'&&/חדש/.test(n))await recordStatus(clientId,'CONNECTION_OFFERED');
  return invite(clientId,eventId);
 }
 if(analysis.intent==='connect')return offer(clientId,eventId);
 if(analysis.intent==='connection_status'||text==='/meta-accounts')return{handled:true,reply:statusReply(await verify(clientId))};
 if(analysis.intent==='disconnect'||text==='/meta-disconnect'){
  await meta.disconnect(clientId);await recordStatus(clientId,'DISCONNECTED',{account:null,accounts:[],permissions:[],lastError:null});
  return{handled:true,reply:'החיבור המקומי נותק והאישורים הממתינים בוטלו. נתוני העסק והטיוטה נשמרו.'};
 }
 if(analysis.intent==='renew'||text==='/meta-renew'){
  try{await meta.renew(clientId);return{handled:true,reply:statusReply(await verify(clientId))};}
  catch{await recordStatus(clientId,'VERIFYING_ACCESS');await recordStatus(clientId,'RECONNECT_REQUIRED',{lastError:'TOKEN_RECONNECT_REQUIRED'});return{handled:true,reply:'נדרש חיבור מחדש דרך Meta. אפשר לבקש קישור אישי; אין לשלוח סיסמה בצ׳אט.'};}
 }
 if(analysis.intent==='knowledge'){
  const topics=await require('./metaKnowledge').retrieve({query:text,state:p?.connection?.status||'NOT_CONNECTED'});
  return topics.length?{handled:true,reply:topics.map(t=>t.content).join('\n\n')}:{handled:false};
 }
 return{handled:false};
}
module.exports={STATES,TRANSITIONS,move,recordStatus,verify,statusReply,offer,invite,handle};
