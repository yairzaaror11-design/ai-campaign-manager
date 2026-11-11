'use strict';
const crypto=require('node:crypto'),db=require('./db'),meta=require('./metaConnection'),planner=require('./taskPlanner');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const KINDS=['collect','read','draft','image','meta'];
const OPS={ask:'collect',collect:'collect',read:'read',draft:'draft',image:'image',meta:'meta'};
const generalRecommendation=message=>/^(?:אז\s+)?מה\s+(?:אתה\s+)?(?:ממליץ\s+(?:לי\s+)?לשווק|כדאי\s+לי\s+לשווק)[?؟!.]*$/u.test(message.trim());
function newGoal(message){
 const m=message.trim().replace(/[.!?؟]+$/u,'').trim();
 return require('./planningIntent').directionOnly(m)||generalRecommendation(m)||/^(?:(?:אני\s+)?(?:רוצה|צריך|צריכה)|בוא(?:י)?|בואו)\s+(?:לשווק|לקדם|לפרסם)\s+(?:משהו|מוצר|שירות)\s+אחר(?:\s|$)/u.test(m)||/^(?:בוא(?:י)?\s+)?(?:נתחיל|נעבור ל|נפתח)\s*(?:משימה|בקשה|קמפיין)\s+חדש(?:ה)?(?:\s|$)/u.test(m);
}
const goalQuestion='בטח, מה המוצר או השירות שתרצה לקדם עכשיו?';
function vagueGoal(message){return /^(?:(?:אני\s+)?(?:רוצה|צריך|צריכה)|בוא(?:י)?|בואו)\s+(?:לשווק|לקדם|לפרסם)\s+(?:משהו|מוצר|שירות)\s+אחר[.!?؟]*$/u.test(message.trim())||/^(?:בוא(?:י)?\s+)?(?:נתחיל|נעבור ל|נפתח)\s*(?:משימה|בקשה)\s+חדש(?:ה)?[.!?؟]*$/u.test(message.trim());}
function changedDeliverable(message,task){
 if(!task||message.trim()===task.request.trim()||! /^(?:תכין|תכיני|תיצור|תיצרי|צור|צרי|בנה|בני|תקים|תעשה|תעשי|הכן)(?:\s|$)/u.test(message.trim()))return false;
 if(require('./planningIntent').directionOnly(task.request)&&!require('./planningIntent').directionOnly(message))return true;
 const family=value=>/דרושים|מועמדות|גיוס עובדים/u.test(value)?'recruitment':/דיר[הת]|נכס|נדל[״"]?ן/u.test(value)?'property':/לעסק|לקוחות חדשים/u.test(value)?'business':null;
 const old=family(task.request),next=family(message);
 const outcomes=requiredOutcomes(message),steps=task.state.steps||[];
 // Explicit creation in a different domain, or a newly requested outcome that
 // the immutable old plan cannot fulfill. Follow-up details/revisions stay put.
 return !!(old&&next&&old!==next)||outcomes.some(o=>steps.length?!steps.some(s=>s.kind==='meta'&&o.intents.includes(s.intent)):!requiredOutcomes(task.request,task.state.planningMode).some(prior=>prior.intents.some(i=>o.intents.includes(i))));
}
const enabled=()=>process.env.TASK_AGENT_ENABLED==='true'&&(process.env.TASK_AGENT_REQUIRE_EVAL!=='true'||require('./taskEvaluation').ready());
function text(value,max=2000){if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('INVALID_TASK_TEXT');return value.trim();}
function safe(value,limit=4000){
 const json=JSON.stringify(value,((key,v)=>/token|secret|password|authorization|cookie|ciphertext|paging/i.test(key)?undefined:v));
 if(!json)return null;
 return json.length<=limit?JSON.parse(json):{excerpt:json.slice(0,limit),truncated:true};
}
function requiredOutcomes(request,planningMode){
 if(require('./planningIntent').isDiscovery({request,planningMode}))return[];
 const localOnly=/^(?:(?:תכין|תכיני|הכן|תיצור|צור|אני רוצה)(?:\s+לי)?\s+)?(?:רק\s+)?(?:טיוטה|טיוטת|נוסח|שאלות לטופס|תוכנית|תכנית|תכנון|אסטרטגיה)/.test(request.trim())||/רק\s+(?:טיוטה|טיוטת|נוסח|תכנון)/.test(request);
 if(localOnly)return[];
 const outcomes=[];
 if(/קמפיין/.test(request)&&/תיצור|תיצרי|צור|צרי|תכין|תכיני|בנה|בני|תקים|להקים|לבנות/.test(request))outcomes.push({label:'קמפיין בחשבון Meta',intents:/מסגרת|קמפיין ריק/.test(request)?['CREATE_CAMPAIGN','CREATE_BUNDLE']:['CREATE_BUNDLE']});
 if(/טופס/.test(request)&&!/טופס\s+(?:קיים|שכבר)|טופס.*שיש/.test(request)&&/תיצור|תיצרי|צור|צרי|תכין|תכיני|בנה|בני|תקים/.test(request))outcomes.push({label:'טופס לידים ב-Meta',intents:['CREATE_LEAD_FORM']});
 if(/פרסם|תפרסם|תפרסמי|תפעיל|הפעל|תעלי? לאוויר/.test(request)&&!/(?:לא|בלי|ללא)\s+(?:לפרסם|פרסום|תפרסם|הפעלה)/.test(request))outcomes.push({label:'הפעלה מאושרת',intents:['ACTIVATE_BUNDLE','RESUME_CAMPAIGN']});
 return outcomes;
}
function validatePlan(plan,request='',planningMode){

 if(!Array.isArray(plan)||!plan.length||plan.length>12)throw Error('INVALID_TASK_PLAN');
 const seen=new Set();
 const steps=plan.map(p=>{
  if(!p||!/^[a-z][a-z0-9_]{0,39}$/.test(p.id||'')||seen.has(p.id)||!KINDS.includes(p.kind)||!Array.isArray(p.dependsOn)||p.dependsOn.some(id=>!seen.has(id)))throw Error('INVALID_TASK_PLAN');
  if(p.kind==='meta'&&!require('./actionPlan').WRITE_INTENTS.has(p.intent))throw Error('UNSUPPORTED_TASK_CAPABILITY');
  seen.add(p.id);return{id:p.id,label:text(p.label,160),kind:p.kind,dependsOn:[...new Set(p.dependsOn)],...(p.kind==='meta'?{intent:p.intent}:{}),status:'PENDING'};
 });
 if(require('./planningIntent').isDiscovery({request,planningMode})&&steps.some(s=>['image','meta'].includes(s.kind)))throw Error('INVALID_TASK_PLAN');
 if(requiredOutcomes(request,planningMode).some(o=>!steps.some(s=>s.kind==='meta'&&o.intents.includes(s.intent))))throw Error('TASK_PLAN_MISSING_OUTCOME');
 if(require('./campaignPackage').required(request,planningMode)&&!steps.slice(0,steps.findIndex(s=>s.kind==='meta')<0?steps.length:steps.findIndex(s=>s.kind==='meta')).some(s=>s.kind==='draft'))throw Error('INVALID_TASK_PLAN');
 return steps;
}
function view(task){
 const state=task.state||{};
 return{id:task.id,request:task.request,status:task.status,revision:task.revision,steps:(state.steps||[]).map(s=>({id:s.id,label:s.label,kind:s.kind,status:s.status,...(s.result?.mediaId?{mediaId:s.result.mediaId}:{}),...(s.result?.verified?{verified:true,objects:s.result.objects||null}:{}),...(s.reason?{reason:s.reason}:{})})),artifacts:(state.steps||[]).filter(s=>s.artifact).map(s=>({stepId:s.id,...s.artifact})),externalActionsExecuted:(state.steps||[]).some(s=>s.kind==='meta'&&s.status==='DONE'&&s.result?.verified)};
}
async function current(clientId){return(await db.query("SELECT * FROM agent_tasks WHERE client_id=$1 ORDER BY created_at DESC LIMIT 1",[clientId])).rows[0]||null;}
async function active(clientId){return(await db.query("SELECT * FROM agent_tasks WHERE client_id=$1 AND status NOT IN ('COMPLETE','CANCELLED')",[clientId])).rows[0]||null;}
async function checkpoint(task,lease){
 const paused=await require('./humanSupport').current(task.client_id);if(paused?.bot_paused)throw Error('TASK_HUMAN_PAUSED');
 if(JSON.stringify(task.state).length>112000)throw Error('TASK_CONTEXT_LIMIT');
 const r=await db.query("UPDATE agent_tasks SET state=$4::jsonb,status=$5,revision=revision+1,updated_at=NOW(),lease_until=NOW()+INTERVAL '5 minutes' WHERE id=$1 AND client_id=$2 AND lease_token=$3 AND lease_until>NOW() RETURNING revision",[task.id,task.client_id,lease,JSON.stringify(task.state),task.status]);
 if(!r.rows.length)throw Error('TASK_LEASE_LOST');task.revision=r.rows[0].revision;
}
function replyFor(task){
 const s=task.state;
 if(task.status==='COMPLETE'&&s.steps?.every(step=>step.kind==='read')){
  const analysis=[...s.steps].reverse().find(step=>step.result?.source==='OWNER_REPORTED_NOT_VERIFIED'&&step.result?.operation);
  if(analysis)return require('./businessCase').format(analysis.result);
 }
 if(task.status==='WAITING_INPUT')return s.question;
 if(task.status==='WAITING_MODEL')return 'בדיקת התקינות של הסוכן טרם הושלמה בהצלחה. הבקשה נשמרה; הכנה ופעולות חדשות ימתינו לסיום הבדיקה.';
 if(task.status==='WAITING_REVIEW')return (s.steps||[]).filter(x=>x.status==='PREPARED').map(x=>x.artifact.title+'\n'+x.artifact.content).join('\n\n')+'\n\nתעבור על מה שהכנתי ותגיד לי מה תרצה לשנות. אם הכול מתאים, כתוב ״מאשר את התוכן״. זה אישור לתוכן בלבד; פרסום והפעלת תקציב דורשים אישור נפרד.';
 const waiting=s.steps?.find(x=>x.status==='WAITING_APPROVAL');
 if(waiting){const a=waiting.result.approval;return require('./actionPlan').formatActionPlan(a.plan)+'\n\nכדי לאשר את הפעולה המדויקת, שלח: אשר '+meta.decrypt(a.codeCiphertext,task.client_id)+'\nהאישור תקף עד '+a.expiresAt+'. האישור מתייחס רק לפעולה הזו.';}
 if(task.status==='COMPLETE')return 'השלמתי את כל השלבים בתוכנית שנבדקה. '+((s.steps||[]).some(x=>x.kind==='meta')?'הפעולות החיצוניות המסומנות כהושלמו אומתו מול Meta.':'התוצרים הוכנו ואושרו; לא בוצעה פעולה חיצונית.')+(s.steps.some(x=>x.result?.privateDraft)?' טיוטת דף הנחיתה נשמרה בדשבורד שלך ולא פורסמה.':'')+'\n'+(s.steps||[]).filter(x=>x.artifact).map(x=>x.artifact.title+'\n'+x.artifact.content).join('\n\n');
 if(task.status==='CANCELLED')return 'המשך העבודה על המשימה בוטל והאישורים הממתינים בוטלו. פעולות שכבר בוצעו אינן מתבטלות אוטומטית.';
 if(task.status==='MANUAL_REVIEW')return 'המשימה נעצרה לבדיקה: לא ניתן לקבוע בביטחון אם פעולה הושלמה. לא אבצע אותה שוב עד לבירור התוצאה.';
 if(task.status==='PAUSED')return 'עצרתי את המשימה. ההתקדמות נשמרה; אפשר לכתוב ״המשך במשימה״.';
 if(task.status==='BLOCKED')return 'כדי להשלים את המשימה צריך לפתור את החלק הבא: '+(s.reason||'יכולת שלא זמינה כרגע')+'. שאר ההתקדמות נשמרה.';
 if(task.status==='HUMAN_PAUSED')return 'המענה האוטומטי והמשימה הושהו למענה אנושי.';
 if(s.lastError==='TASK_FORM_DRAFT_REQUIRED')return 'המודעה נשמרה, אבל עדיין חסר טופס המועמדות. צריך להשלים אותו לפני שאשלח הכול לבדיקה.';
 const prepared=(s.steps||[]).filter(x=>x.status==='PREPARED'&&x.artifact).map(x=>x.artifact.title).slice(0,3);
 const stage=['INVALID_TASK_JSON','TASK_STEP_FAILED'].includes(s.lastError)?'נתקעתי בתכנון השלב הבא.':s.lastError?.includes('CAMPAIGN_DRAFT')?'עדיין לא הצלחתי להשלים את הגדרות הקמפיין.':s.lastError?.includes('GRAPHIC')||s.lastError?.includes('IMAGE')?'נעצרתי בהכנת התמונה.':'לא הצלחתי להשלים את השלב הבא.';
 return stage+(prepared.length?' כבר מוכן ושמור: '+prepared.join(', ')+'.':' הבקשה שלך נשמרה.')+' אפשר לכתוב ״המשך במשימה״. פעולה שהתוצאה שלה לא ברורה לא תבוצע שוב אוטומטית.';
}
async function settle(task,lease,requestId){
 const reply=task.customReply||replyFor(task);
 const contextReply=task.status==='WAITING_APPROVAL'?'הוכנה פעולה לבדיקה; נדרש אישור נפרד לפעולה זו.':reply;
 task.state.messages=[...(task.state.messages||[]),{role:'assistant',content:contextReply.slice(0,2000),...(contextReply.length>2000?{truncated:true}:{})}].slice(-12);
 await checkpoint(task,lease);
 const result={handled:true,reply,mediaIds:task.newMedia||[],task:view(task),externalActionsExecuted:view(task).externalActionsExecuted};
 await db.transaction(async tx=>{
  const row=await tx('SELECT lease_token FROM agent_tasks WHERE id=$1 AND client_id=$2 FOR UPDATE',[task.id,task.client_id]);if(row.rows[0]?.lease_token!==lease)throw Error('TASK_LEASE_LOST');
  const storedResult=task.status==='WAITING_APPROVAL'?{...result,reply:undefined,replyCiphertext:meta.encrypt(result.reply,task.client_id)}:result;
  await tx('UPDATE agent_task_turns SET result=$3::jsonb WHERE client_id=$1 AND request_id=$2',[task.client_id,requestId,JSON.stringify(storedResult)]);
  await tx('UPDATE agent_tasks SET lease_token=NULL,lease_until=NULL WHERE id=$1',[task.id]);
 });return result;
}
async function cancel(clientId){
 return db.transaction(async tx=>{
  await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[clientId]);
  const task=(await tx("SELECT * FROM agent_tasks WHERE client_id=$1 AND status NOT IN ('COMPLETE','CANCELLED') FOR UPDATE",[clientId])).rows[0];if(!task)return null;
  for(const step of task.state.steps||[]){const actionId=step.result?.approval?.actionId;if(!actionId)continue;await tx("UPDATE approvals SET status='CANCELLED' WHERE client_id=$1 AND action_id=$2 AND status='PENDING'",[clientId,actionId]);await tx("UPDATE action_plans SET status='CANCELLED' WHERE client_id=$1 AND id=$2 AND status='PROPOSED'",[clientId,actionId]);}
  await tx("UPDATE agent_tasks SET status='CANCELLED',lease_token=NULL,lease_until=NULL,revision=revision+1,updated_at=NOW() WHERE id=$1",[task.id]);task.status='CANCELLED';return{handled:true,reply:replyFor(task),task:view(task),externalActionsExecuted:false};
 });
}
async function claim(clientId,{message,requestId,channel,taskRevision},dynamicRouting=false){
 return db.transaction(async tx=>{
  const owner=await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[clientId]);if(!owner.rows.length)throw Error('CLIENT_NOT_FOUND');
  const fingerprint=hash({message,channel,taskRevision});
  const prior=(await tx('SELECT * FROM agent_task_turns WHERE client_id=$1 AND request_id=$2',[clientId,requestId])).rows[0];
  if(prior?.fingerprint!==undefined&&prior.fingerprint!==fingerprint)throw Error('TASK_REQUEST_CONFLICT');
  if(prior?.result){const cached={...prior.result};if(cached.replyCiphertext){cached.reply=meta.decrypt(cached.replyCiphertext,clientId);delete cached.replyCiphertext;}return{cached};}
  let task=prior?(await tx('SELECT * FROM agent_tasks WHERE id=$1 AND client_id=$2 FOR UPDATE',[prior.task_id,clientId])).rows[0]:(await tx("SELECT * FROM agent_tasks WHERE client_id=$1 AND status NOT IN ('COMPLETE','CANCELLED') FOR UPDATE",[clientId])).rows[0];
  if(taskRevision!==undefined&&(!Number.isInteger(taskRevision)||taskRevision!==task?.revision))throw Error('TASK_STALE');
  if(task?.lease_until&&new Date(task.lease_until)>new Date())return{cached:{handled:true,reply:'אני עדיין עובד על המשימה. ההתקדמות נשמרת; לא התחלתי עותק נוסף.',task:view(task),busy:true,externalActionsExecuted:false}};
  const replacing=!dynamicRouting&&!prior&&(newGoal(message)||changedDeliverable(message,task));let advisoryContext=null;
  if(replacing&&task){
   // Never discard uncertain external effects or override an in-flight lease.
   let uncertain=task.status==='MANUAL_REVIEW'||task.state.steps.some(s=>s.status==='RUNNING'&&['image','meta'].includes(s.kind));
   for(const step of task.state.steps){const id=step.result?.approval?.actionId;if(!id)continue;const attempt=(await tx('SELECT status FROM meta_execution_attempts WHERE client_id=$1 AND action_id=$2',[clientId,id])).rows[0];if(attempt&&attempt.status!=='VERIFIED')uncertain=true;}
   if(uncertain)return{cached:{handled:true,reply:'אפשר לעבור לבקשה חדשה, אבל קודם צריך לברר את תוצאת הפעולה הקודמת כדי שלא לבצע אותה פעמיים. המשימה נשמרה לבדיקה.',task:view(task),externalActionsExecuted:false}};
   if(require('./planningIntent').directionOnly(task.request)&&!newGoal(message)&&changedDeliverable(message,task))advisoryContext={facts:task.state.facts||{},messages:(task.state.messages||[]).slice(-8)};
   for(const step of task.state.steps){const id=step.result?.approval?.actionId;if(!id)continue;await tx("UPDATE approvals SET status='CANCELLED' WHERE client_id=$1 AND action_id=$2 AND status='PENDING'",[clientId,id]);await tx("UPDATE action_plans SET status='CANCELLED' WHERE client_id=$1 AND id=$2 AND status='PROPOSED'",[clientId,id]);}
   await tx("UPDATE agent_tasks SET status='CANCELLED',lease_token=NULL,lease_until=NULL,revision=revision+1,updated_at=NOW() WHERE id=$1 AND client_id=$2",[task.id,clientId]);
   task=null;
  }
  if(!task){task={id:crypto.randomUUID(),client_id:clientId,request:message,status:'READY',revision:1,state:{steps:[],facts:advisoryContext?.facts||{},messages:advisoryContext?.messages||[],...(replacing?{newGoal:!advisoryContext,awaitingGoal:vagueGoal(message)}:{})}};await tx('INSERT INTO agent_tasks(id,client_id,request,state) VALUES($1,$2,$3,$4::jsonb)',[task.id,clientId,message,JSON.stringify(task.state)]);}
  if(!prior)task.state.messages=[...(task.state.messages||[]),{role:'user',content:message}].slice(-12);
  if((task.state.steps||[]).some(s=>s.status==='RUNNING'&&['image','meta'].includes(s.kind)))task.status='MANUAL_REVIEW';
  else for(const s of task.state.steps||[])if(s.status==='RUNNING')s.status='PENDING';
  const lease=crypto.randomUUID();
  await tx("UPDATE agent_tasks SET lease_token=$2,lease_until=NOW()+INTERVAL '5 minutes',state=$3::jsonb,status=$4 WHERE id=$1",[task.id,lease,JSON.stringify(task.state),task.status]);
  if(!prior)await tx('INSERT INTO agent_task_turns(client_id,request_id,task_id,fingerprint,channel,input_text) VALUES($1,$2,$3,$4,$5,$6)',[clientId,requestId,task.id,fingerprint,channel,/^אשר\s+\d{6}$/.test(message)?'נמסר אישור לפעולה':message]);
  return{task,lease};
 });
}
async function reconcile(task){
 for(const step of task.state.steps||[]){
  if(step.status!=='WAITING_APPROVAL')continue;
  const a=step.result.approval,row=(await db.query('SELECT status,plan_hash,execution_result,payload FROM action_plans WHERE id=$1 AND client_id=$2',[a.actionId,task.client_id])).rows[0];
  if(row?.plan_hash!==a.planHash)throw Error('TASK_APPROVAL_CHANGED');
  if(row.status==='VERIFIED'&&row.execution_result?.verified){step.status='DONE';step.result={...row.execution_result,actionId:a.actionId,verified:true,...(step.intent==='UPLOAD_IMAGE'?{sourceMediaId:row.payload?.parameters?.mediaId}:{})};}
  else if(['APPROVED','MANUAL_REVIEW'].includes(row.status)){task.status='MANUAL_REVIEW';return;}
  else if(row.status!=='PROPOSED'||new Date(a.expiresAt)<=new Date()){step.status='PENDING';delete step.result;}
 }
}
function normalizeFactQuote(value){
 return value.normalize('NFC').replace(/\s+/gu,' ').trim();
}
function collectFacts(task,decision,known){
 if(!Array.isArray(decision.facts)||decision.facts.length>12||!Array.isArray(decision.knownFields||[]))throw Error('INVALID_TASK_FACTS');
 const facts={...task.state.facts};
 const sources=[task.request,...task.state.messages.filter(message=>message.role==='user').map(message=>message.content)].map(normalizeFactQuote);
 for(const fact of decision.facts){
  if(!fact||!/^[a-z][a-z0-9_]{0,49}$/.test(fact.key||'')||typeof fact.value!=='string'||!fact.value.trim()||fact.value.length>1000||typeof fact.evidence!=='string')throw Error('UNGROUNDED_TASK_FACT');
  const evidence=normalizeFactQuote(fact.evidence);
  if(!evidence||!sources.some(source=>source.includes(evidence))||!evidence.includes(normalizeFactQuote(fact.value)))throw Error('UNGROUNDED_TASK_FACT');
  facts[fact.key]={value:fact.value,evidence:fact.evidence};
 }
 for(const field of decision.knownFields||[]){
  if(!known.facts?.[field]?.value)throw Error('UNKNOWN_TASK_FACT');
  facts[field]={value:known.facts[field].value,source:'known_business'};
 }
 if(!decision.facts.length&&!decision.knownFields?.length||JSON.stringify(facts).length>10000)throw Error('INVALID_TASK_FACTS');
 return facts;
}
const FACT_REPAIR={
 code:'UNGROUNDED_TASK_FACT',
 instruction:'Collect failed before saving facts. Copy each evidence quote and its value directly from the original request or a USER message, preserving every character and space. Keep price qualifiers such as starting from. Omit unsupported details. If a necessary detail is missing, ask one focused question using the same collect step.'
};
function contextFor(task,known){
 return{request:task.request,planningMode:task.state.planningMode,requiredOutcomes:requiredOutcomes(task.request,task.state.planningMode),lastError:task.state.lastError||null,pendingQuestion:task.state.question||null,plan:task.state.steps.map(s=>({...s,result:s.result?.approval?{awaitingExactApproval:true}:safe(s.result,1500)})),facts:task.state.facts,messages:task.state.messages.slice(-6),knownBusiness:known,readTools:planner.READ_TOOLS,professionalReadSchemas:require('./gemini').functionDeclarations.filter(t=>['get_professional_skills','analyze_business_case'].includes(t.name)),writeSchema:require('./gemini').functionDeclarations.find(t=>t.name==='propose_action').parameters,notes:'Only DONE is completed. PREPARED drafts await local review; WAITING_APPROVAL Meta actions have not executed.'};
}
function dependenciesReady(task,step){return step.dependsOn.every(id=>{const dep=task.state.steps.find(s=>s.id===id);return dep.status==='DONE'||step.kind!=='meta'&&dep.status==='PREPARED';});}
function reviewReady(task){
 const steps=task.state.steps;
 if(steps.some(s=>['STALE','RUNNING','WAITING_APPROVAL'].includes(s.status))||require('./taskDraftReview').issue(task))return false;
 return steps.some(s=>s.status==='PREPARED'&&s.artifact&&!s.artifact.reviewed)&&!steps.some(s=>s.kind!=='meta'&&['PENDING','WAITING_INPUT'].includes(s.status)&&dependenciesReady(task,s));
}
function prepareReview(task){
 delete task.state.reviewIssue;delete task.state.lastError;delete task.state.reason;
 task.state.reviewHash=hash(task.state.steps.filter(s=>s.status==='PREPARED').map(s=>[s.id,s.artifact.hash]));task.status='WAITING_REVIEW';
}
async function rebaseForTurn(task,lease,requestId,message,kind){
 const mode=kind==='DISCOVERY'?'DISCOVERY_BEFORE_CREATIVE':'REQUESTED_TASK';
 if(!task.state.steps.length){
  task.request=message;task.state.planningMode=mode;delete task.state.awaitingGoal;
  await db.query('UPDATE agent_tasks SET request=$4 WHERE id=$1 AND client_id=$2 AND lease_token=$3',[task.id,task.client_id,lease,message]);return task;
 }
 return db.transaction(async tx=>{
  const locked=(await tx('SELECT * FROM agent_tasks WHERE id=$1 AND client_id=$2 AND lease_token=$3 AND lease_until>NOW() FOR UPDATE',[task.id,task.client_id,lease])).rows[0];if(!locked)throw Error('TASK_LEASE_LOST');
  if(locked.status==='MANUAL_REVIEW'||locked.state.steps.some(s=>s.status==='RUNNING'&&['image','meta'].includes(s.kind)))throw Error('TASK_UNCERTAIN_SWITCH');
  for(const step of locked.state.steps){const id=step.result?.approval?.actionId;if(!id)continue;const attempt=(await tx('SELECT status FROM meta_execution_attempts WHERE client_id=$1 AND action_id=$2',[task.client_id,id])).rows[0];if(attempt&&attempt.status!=='VERIFIED')throw Error('TASK_UNCERTAIN_SWITCH');}
  for(const step of locked.state.steps){const id=step.result?.approval?.actionId;if(!id)continue;await tx("UPDATE approvals SET status='CANCELLED' WHERE client_id=$1 AND action_id=$2 AND status='PENDING'",[task.client_id,id]);await tx("UPDATE action_plans SET status='CANCELLED' WHERE client_id=$1 AND id=$2 AND status='PROPOSED'",[task.client_id,id]);}
  const carry=require('./planningIntent').isDiscovery(task),messages=carry?task.state.messages.slice(-8):[{role:'user',content:message}];
  const state={steps:[],facts:carry?task.state.facts:{},messages,newGoal:!carry,planningMode:mode,plannerCalls:0,routingCalls:1};
  await tx("UPDATE agent_tasks SET status='CANCELLED',lease_token=NULL,lease_until=NULL,revision=revision+1,updated_at=NOW() WHERE id=$1 AND client_id=$2 AND lease_token=$3",[task.id,task.client_id,lease]);
  const created=(await tx("INSERT INTO agent_tasks(id,client_id,request,status,state,lease_token,lease_until) VALUES($1,$2,$3,'RUNNING',$4::jsonb,$5,NOW()+INTERVAL '5 minutes') RETURNING *",[crypto.randomUUID(),task.client_id,message,JSON.stringify(state),lease])).rows[0];
  await tx('UPDATE agent_task_turns SET task_id=$3 WHERE client_id=$1 AND request_id=$2',[task.client_id,requestId,created.id]);return created;
 });
}
function canPresentReview(task,message){
 if(task?.state?.pendingRouting&&require('./conversationRouter').resume(message))return false;
 return process.env.TASK_AGENT_ENABLED==='true'&&!!task&&['BLOCKED','ERROR','WAITING_MODEL','WAITING_REVIEW'].includes(task.status)&&/^(?:המשך במשימה|נמשיך|המשך|תמשיך|הצג את החבילה|תציג את החבילה|הצג את הקמפיין|תציג את הקמפיין|תראה לי מה הכנת)[.!?]*$/u.test(message.trim())&&reviewReady(task);
}
async function send(clientId,{message,requestId,channel='PORTAL',taskRevision}={},options={}){
 text(message);text(requestId,200);if(!['PORTAL','WHATSAPP'].includes(channel))throw Error('INVALID_TASK_CHANNEL');
 if(String(meta.context.getStore())!==String(clientId))throw Error('TENANT_CONTEXT_REQUIRED');
 if((await require('./humanSupport').current(clientId))?.bot_paused)return{handled:true,reply:'המענה האוטומטי מושהה למענה אנושי.',externalActionsExecuted:false};
 if(/^(בטל את המשימה|בטלי את המשימה)$/.test(message.trim()))return await cancel(clientId)||{handled:true,reply:'אין משימה פתוחה לביטול.',externalActionsExecuted:false};
 const claimed=await claim(clientId,{message:message.trim(),requestId,channel,taskRevision},!!options.dynamicRouting);if(claimed.cached)return claimed.cached;
 let {task,lease}=claimed;let semanticRevision=false;
 try{
  if(/^(מצב המשימה|מה מצב המשימה|איפה עומדים|מה כבר עשית)$/.test(message.trim())){const labels={DONE:'הושלם',PREPARED:'מוכן לבדיקה',WAITING_INPUT:'ממתין לפרט ממך',WAITING_APPROVAL:'ממתין לאישור פעולה',PENDING:'טרם בוצע',RUNNING:'בתהליך'};task.customReply='היעד: '+task.request+'\n'+task.state.steps.map(s=>s.label+': '+(labels[s.status]||s.status)).join('\n');return await settle(task,lease,requestId);}
  if(task.status==='MANUAL_REVIEW')return await settle(task,lease,requestId);
  if(task.status==='PAUSED'&&!options.dynamicRouting&&!/^(המשך במשימה|נמשיך|המשך|תמשיך)$/.test(message.trim()))return await settle(task,lease,requestId);
  if(/^(עצור|עצירה|עצור את המשימה)$/.test(message.trim())){task.status='PAUSED';return await settle(task,lease,requestId);}
  if(options.dynamicRouting){
   const router=require('./conversationRouter'),pending=task.state.pendingRouting;
   const routeMessage=pending&&router.resume(message)?pending.nextMessage||pending.message:message;
   if(!router.exactControl(routeMessage)){
    task.state.pendingRouting=pending?{...pending,...(routeMessage!==pending.message?{nextMessage:routeMessage}:{})}:{message:routeMessage};
    if(!options.deferPlanning){
     if(!await require('./rateLimit').take('task-planner:'+clientId,60,3600))throw Error('TASK_ROUTING_LIMIT');
     task.state.routingCalls=(task.state.routingCalls||0)+1;await checkpoint(task,lease);
     const known=planner.businessContext(await require('./marketingStore').context(clientId));
     const input={message:routeMessage,...(pending?{pendingRequest:pending.message}:{}),task:{request:task.request,status:task.status,planningMode:task.state.planningMode,steps:task.state.steps.map(s=>({id:s.id,kind:s.kind,status:s.status,label:s.label,verified:s.result?.verified===true,artifact:s.artifact?{title:s.artifact.title,content:String(s.artifact.adContent||s.artifact.content||'').slice(0,700)}:null}))},messages:task.state.messages.slice(-6).map(m=>({role:m.role,content:m.content.slice(0,1200)})),business:known.facts};
     const route=await (options.turnRouter||router.route)(input);
     if(!router.KINDS.includes(route?.kind))throw Error('ROUTING_RESPONSE_INVALID');
     if(route.usePending&&!pending)throw Error('ROUTING_RESPONSE_INVALID');
     delete task.state.pendingRouting;
     if(route.kind==='ANSWER'){
      if(typeof route.reply!=='string'||!route.reply.trim()||route.reply.length>900)throw Error('ROUTING_RESPONSE_INVALID');
      task.customReply=route.reply.trim();return await settle(task,lease,requestId);
     }
     if(route.kind==='PAUSE'){task.status='PAUSED';return await settle(task,lease,requestId);}
     if(route.kind==='RESUME')task.status='RUNNING';
     if(['DISCOVERY','START'].includes(route.kind))task=await rebaseForTurn(task,lease,requestId,route.usePending?pending.message:routeMessage,route.kind);
     if(route.kind==='REVISE')semanticRevision=true;
    }
   }
  }
  if(task.status==='PAUSED'&&!require('./conversationRouter').resume(message))return await settle(task,lease,requestId);
  if(task.state.awaitingGoal){
   const first=task.state.messages.length===1;
   if(first||/^(?:כן|לא|אוקיי|בסדר|המשך|תמשיך|המשך במשימה|היי|תודה|מאשר את התוכן|מאשרת את התוכן|מאשר את החבילה|אשר\s+\d{6})[.!?]*$/u.test(message.trim())){task.status='WAITING_INPUT';task.state.question=goalQuestion;return await settle(task,lease,requestId);}
   task.request=message.trim();delete task.state.awaitingGoal;delete task.state.question;
   await db.query('UPDATE agent_tasks SET request=$4 WHERE id=$1 AND client_id=$2 AND lease_token=$3',[task.id,clientId,lease,task.request]);
  }
  // Explicitly viewing an already prepared local package is not planning or
  // authorization. Recheck the leased task and never cross this branch into a write.
  require('./campaignPackage').ensure(task);
  if(canPresentReview(task,message)){prepareReview(task);return await settle(task,lease,requestId);}
  if(options.deferPlanning){if(!['MANUAL_REVIEW','PAUSED','HUMAN_PAUSED'].includes(task.status))task.status='WAITING_MODEL';return await settle(task,lease,requestId);}
  // A paused task resumes only on a new explicit user message, never by a timer.
  await reconcile(task);if(task.status==='MANUAL_REVIEW')return await settle(task,lease,requestId);
  const revisionRequested=semanticRevision||/^(?:שנה|שני|תשנה|תשני|תקן|תקני|תתקן|תתקני|עדכן|עדכני|תעדכן|תעדכני|קצר|קצרי|תוסיף|תוסיפי|במקום|בעצם|לא אהבתי)(?:\s|$)/.test(message.trim());
  if(revisionRequested){
   if(task.state.steps.some(s=>s.kind==='meta'&&s.status==='DONE')){task.status='BLOCKED';task.state.reason='כבר בוצעה פעולה בחשבון; נדרשת תוכנית עדכון נפרדת כדי שלא ליצור עותק או לשנות פעולה שכבר אושרה';return await settle(task,lease,requestId);}
   for(const step of task.state.steps){
    if(step.status==='WAITING_APPROVAL'){const id=step.result.approval.actionId;await db.query("UPDATE approvals SET status='CANCELLED' WHERE action_id=$1 AND client_id=$2 AND status='PENDING'",[id,clientId]);await db.query("UPDATE action_plans SET status='CANCELLED' WHERE id=$1 AND client_id=$2 AND status='PROPOSED'",[id,clientId]);step.status='PENDING';delete step.result;}
    if(step.artifact){step.status='PREPARED';step.artifact.reviewed=false;}
   }
   task.state.revising=true;delete task.state.reviewHash;
  }
  // Resume a completed local package stranded by a former planning-loop limit.
  // This exposes drafts only; it never consumes an approval or retries a write.
  if(!revisionRequested&&['BLOCKED','ERROR'].includes(task.status)&&reviewReady(task)){prepareReview(task);return await settle(task,lease,requestId);}
  if(task.state.reviewIssue&&!require('./taskDraftReview').issue(task))delete task.state.reviewIssue;
  const waiting=task.state.steps.find(s=>s.status==='WAITING_APPROVAL');
  if(waiting){
   const code=message.trim().match(/^אשר\s+(\d{6})$/);
   if(!code){task.status='WAITING_APPROVAL';return await settle(task,lease,requestId);}
   const a=waiting.result.approval;
   // A valid code for some OTHER pending action must not be consumed by this task.
   if(code[1]!==meta.decrypt(a.codeCiphertext,clientId)){task.status='WAITING_APPROVAL';return await settle(task,lease,requestId);}
   const consumed=await require('./approvalEngine').consumeApprovalForClient(clientId,code[1]);
   if(!consumed.ok){task.status='WAITING_APPROVAL';return await settle(task,lease,requestId);}
   const outcome=await require('./actionExecutor').executeApprovedForClient(clientId,consumed.approval.actionPlan);
   if(!outcome.ok){if(outcome.reason==='READ_ONLY'){await db.query("UPDATE action_plans SET status='BLOCKED' WHERE id=$1 AND client_id=$2 AND status='APPROVED'",[a.actionId,clientId]);waiting.status='PENDING';delete waiting.result;task.status='BLOCKED';task.state.reason='הרשאות הכתיבה לחשבון הפרסום אינן פעילות';}else task.status='MANUAL_REVIEW';return await settle(task,lease,requestId);}
   await reconcile(task);
  }
  if(task.status==='WAITING_REVIEW'&&require('./taskDraftReview').issue(task)){
   task.status='RUNNING';task.state.reviewIssue=require('./taskDraftReview').issue(task);task.state.revising=true;delete task.state.reviewHash;
  }
  if(task.status==='WAITING_REVIEW'&&/^(כן|לא|מאשר|מאשרת|אוקיי)$/.test(message.trim()))return await settle(task,lease,requestId);
  if(task.status==='WAITING_REVIEW'&&/^(מאשר את התוכן|מאשרת את התוכן|מאשר את החבילה|מאשרת את החבילה)$/.test(message.trim())){
   if(task.state.reviewHash!==hash(task.state.steps.filter(s=>s.status==='PREPARED').map(s=>[s.id,s.artifact.hash])))throw Error('TASK_REVIEW_CHANGED');
   for(const step of task.state.steps)if(step.status==='PREPARED'){
    if(step.artifact.destination==='landing_page'){
     await checkpoint(task,lease);
     const digest=hash([task.id,step.id,step.artifact.hash]);
     const requestId=[digest.slice(0,8),digest.slice(8,12),'4'+digest.slice(13,16),'8'+digest.slice(17,20),digest.slice(20,32)].join('-');
     const page=await require('./landingDrafts').save(clientId,{requestId,payload:step.artifact.payload,taskBinding:{taskId:task.id,stepId:step.id,lease,artifactHash:step.artifact.hash}});
     step.result={draftId:page.id,status:page.status,privateDraft:true,published:false};
    }
    step.status='DONE';step.artifact.reviewed=true;
   }
   delete task.state.reviewHash;delete task.state.revising;
  }
  task.status='RUNNING';await checkpoint(task,lease);
  const known=planner.businessContext(await require('./marketingStore').context(clientId));
  if(task.state.newGoal&&!generalRecommendation(task.request)&&!require('./planningIntent').isDiscovery(task)){delete known.facts.product;known.rule+=' The owner explicitly switched goals. Do not reuse a prior product or campaign.';}
  let initialRepairs=0,decisionRepairs=0,decisionFeedback=task.state.lastError==='UNGROUNDED_TASK_FACT'?FACT_REPAIR:null;
  for(let round=0;round<16;round++){
   const automaticImage=require('./campaignPackage').imageDecision(task,dependenciesReady);
   if(!automaticImage&&( (task.state.plannerCalls||0)>=64||!await require('./rateLimit').take('task-planner:'+clientId,60,3600))){task.status='BLOCKED';task.state.reason='המשימה הגיעה למגבלת התכנון כדי לעצור לולאה או עלות לא צפויה';return await settle(task,lease,requestId);}
   if(!automaticImage)task.state.plannerCalls=(task.state.plannerCalls||0)+1;await checkpoint(task,lease);
   const context=contextFor(task,known);
   if(initialRepairs&&!task.state.steps.length)context.plannerFeedback=planner.initialFeedback(task.state.lastError);
   if(decisionFeedback)context.plannerFeedback=decisionFeedback;
   else if(task.state.reviewIssue)context.plannerFeedback=require('./taskDraftReview').feedback(task.state.reviewIssue);
   if(!context.plannerFeedback&&task.state.steps.some(s=>s.kind==='draft'&&s.status==='PREPARED')){
    const missing=require('./taskDraftReview').issue(task);
    if(['TASK_FORM_DRAFT_REQUIRED','TASK_CAMPAIGN_DRAFT_REQUIRED'].includes(missing))context.plannerFeedback=require('./taskDraftReview').feedback(missing);
   }
   let decision,collectedFacts;
   try{
    decision=automaticImage||await planner.decide(context,options);
    if(!decision||typeof decision!=='object'||!decision.next)throw Error('INVALID_TASK_DECISION');
    if(!task.state.steps.length){const proposed={...task,state:{...task.state,steps:validatePlan(decision.plan,task.request,task.state.planningMode)}};require('./campaignPackage').ensure(proposed);task.state=proposed.state;}
    const n=decision.next;
    if(['review','meta'].includes(n.op)&&require('./taskDraftReview').issue(task))throw Error(require('./taskDraftReview').issue(task));
    if(n.op==='draft'&&n.campaignDraft!==undefined)require('./campaignPackage').checked(n.campaignDraft);
    if(n.op==='image'&&task.state.steps.find(s=>s.id===n.stepId)?.packageImage&&!automaticImage)throw Error('TASK_CAMPAIGN_DRAFT_REQUIRED');
    if(n.op==='draft'&&n.formDraft!==undefined)require('./taskDraftReview').formDraft(n.formDraft);
    if(!['review','finish'].includes(n.op)){
     const step=task.state.steps.find(s=>s.id===n.stepId);
     if(!step||step.status==='STALE'||step.status==='DONE'&&!(step.kind==='read'&&n.op==='read'&&step.lastReadTurn!==requestId)&&!(task.state.revising&&step.kind==='collect'&&n.op==='collect')||step.status==='WAITING_APPROVAL'||!dependenciesReady(task,step))throw Error('TASK_STEP_NOT_READY');
     if(n.op!=='blocked'&&OPS[n.op]!==step.kind)throw Error('TASK_OPERATION_MISMATCH');
    }
    if(n.op==='collect')collectedFacts=collectFacts(task,n,known);
   }catch(error){
    // One model-only correction before any step is accepted; never retry an executor.
    if(!task.state.steps.length&&initialRepairs<1&&planner.repairableInitial(error)){
     initialRepairs++;task.state.lastError=error instanceof SyntaxError?'INVALID_TASK_JSON':error.message;await checkpoint(task,lease);continue;
    }
    if(decisionRepairs<1&&error.message==='UNGROUNDED_TASK_FACT'){
     decisionRepairs++;
     decisionFeedback=FACT_REPAIR;
     task.state.lastError=error.message;
     await checkpoint(task,lease);
     continue;
    }
    if(decisionRepairs<1&&['TASK_STEP_NOT_READY','TASK_OPERATION_MISMATCH','TASK_FORM_DRAFT_REQUIRED','INVALID_FORM_DRAFT','TASK_CAMPAIGN_DRAFT_REQUIRED','INVALID_CAMPAIGN_DRAFT','TASK_CAMPAIGN_GRAPHIC_REQUIRED'].includes(error.message)){
     decisionRepairs++;decisionFeedback=(/^TASK_(?:FORM_DRAFT|CAMPAIGN_)/.test(error.message)||error.message==='INVALID_CAMPAIGN_DRAFT')?require('./taskDraftReview').feedback(error.message):{code:error.message,instruction:'The proposed next step was rejected BEFORE execution. Keep the existing plan, step IDs, facts and completed effects unchanged. Select a dependency-ready step of the matching kind; use review for prepared artifacts, or blocked on a ready step when access is missing. Never repeat completed writes or infer approval.'};
     task.state.lastError=error.message;await checkpoint(task,lease);continue;
    }
    throw error;
   }
   decisionFeedback=null;
   delete task.state.lastError;delete task.state.errorDiagnostic;
   // Later model plans are ignored. Only validated next operations may advance the authoritative persisted plan.
   const n=decision.next;
   if(n.op==='review'){
    if(!task.state.steps.some(s=>s.status==='PREPARED'))throw Error('TASK_ARTIFACTS_REQUIRED');
    prepareReview(task);return await settle(task,lease,requestId);
   }
   if(n.op==='finish'){
    if(requiredOutcomes(task.request,task.state.planningMode).some(o=>!task.state.steps.some(s=>s.kind==='meta'&&s.status==='DONE'&&s.result?.verified&&o.intents.includes(s.intent)))||task.state.steps.some(s=>s.status!=='DONE')||!task.state.steps.some(s=>['draft','image','meta','read'].includes(s.kind)))throw Error('TASK_NOT_COMPLETE');
    task.status='COMPLETE';return await settle(task,lease,requestId);
   }
   const step=task.state.steps.find(s=>s.id===n.stepId);
   if(!step||step.status==='STALE'||step.status==='DONE'&&!(step.kind==='read'&&n.op==='read'&&step.lastReadTurn!==requestId)&&!(task.state.revising&&step.kind==='collect'&&n.op==='collect')||step.status==='WAITING_APPROVAL'||!dependenciesReady(task,step))throw Error('TASK_STEP_NOT_READY');
   if(n.op==='blocked'){task.state.reason=text(n.reason,600);step.reason=task.state.reason;task.status='BLOCKED';return await settle(task,lease,requestId);}
   if(OPS[n.op]!==step.kind)throw Error('TASK_OPERATION_MISMATCH');
   if(n.op==='ask'){task.state.question=text(n.question,600);step.status='WAITING_INPUT';task.status='WAITING_INPUT';return await settle(task,lease,requestId);}
   if(n.op==='collect'){
    const facts=collectedFacts;
    if(task.state.revising&&hash(facts)!==hash(task.state.facts)){for(const dependent of task.state.steps)if(dependent.kind==='draft'){dependent.status='PENDING';delete dependent.artifact;}if(task.state.steps.some(s=>s.kind==='image'&&s.result?.mediaId)){for(const imageStep of task.state.steps)if(imageStep.kind==='image'&&imageStep.result?.mediaId)imageStep.status='STALE';task.status='BLOCKED';task.state.reason='פרטי המשימה השתנו אחרי יצירת תמונה; יש לבדוק ולהכין מחדש את התמונה לפני שימוש בה';task.state.facts=facts;return await settle(task,lease,requestId);}}
    task.state.facts=facts;step.status='DONE';
   }else if(n.op==='draft'){
    const artifact={title:text(n.title,160),content:text(n.content,6000),reviewed:false};
    if(n.campaignDraft!==undefined){artifact.adContent=artifact.content;artifact.campaignDraft=require('./campaignPackage').checked(n.campaignDraft);artifact.content+=require('./campaignPackage').render(artifact.campaignDraft);}
    if(n.formDraft!==undefined){
     artifact.formDraft=require('./taskDraftReview').formDraft(n.formDraft);
     artifact.content+='\n\n'+artifact.formDraft.title+' — טיוטת טופס, טרם נוצר ב־Meta\n'+artifact.formDraft.questions.map((q,i)=>(i+1)+'. '+q).join('\n');
    }
    if(n.destination!==undefined){
     if(n.destination!=='landing_page')throw Error('UNSUPPORTED_DRAFT_DESTINATION');
     const payload=require('./landingDrafts').checked(JSON.parse(artifact.content));
     artifact.destination='landing_page';artifact.payload=payload;
     artifact.content=[payload.businessName,payload.title,payload.body,payload.cta,'טיוטה פרטית לדף נחיתה. אישור התוכן לא מפרסם אותה.'].join('\n\n');
    }
    artifact.hash=hash(artifact);step.artifact=artifact;step.status='PREPARED';
    if(task.state.steps.reduce((sum,s)=>sum+(s.artifact?.content.length||0),0)>18000)throw Error('TASK_ARTIFACT_LIMIT');
   }else if(n.op==='read'){
    if(!planner.READ_TOOLS.includes(n.tool)||!n.args||typeof n.args!=='object'||JSON.stringify(n.args).length>2000)throw Error('TASK_READ_TOOL_REJECTED');
    step.status='RUNNING';await checkpoint(task,lease);
    const scope={clientId,taskId:task.id,revision:task.revision,sources:[task.request,...task.state.messages.filter(m=>m.role==='user').map(m=>m.content)]};
    try{step.result=safe(await require('./professionalContext').run(scope,()=> (options.readTool||require('./gemini').runTool)(n.tool,n.args)));}
    catch(error){
     const question=n.tool==='analyze_business_case'?require('./businessCase').inputQuestion(error.message):null;
     if(!question)throw error;
     step.status='PENDING';step.result={status:'NEEDS_INPUT',reason:error.message};task.state.lastError=error.message;task.state.question=question;task.status='WAITING_INPUT';return await settle(task,lease,requestId);
    }
    step.status='DONE';step.lastReadTurn=requestId;
    if(n.tool==='analyze_business_case'&&step.result?.status==='NEEDS_INPUT'){step.status='PENDING';task.status='WAITING_INPUT';task.state.question=step.result.nextQuestion;return await settle(task,lease,requestId);}
   }else if(n.op==='image'){
    if(step.packageImage&&!require('./botCapabilities').describe().graphics.enabled){task.status='BLOCKED';task.state.reason='יצירת הגרפיקה אינה מוגדרת בשירות; חבילת הקמפיין עדיין אינה מלאה';return await settle(task,lease,requestId);}
    const prompt=text(n.prompt);
    if(n.referenceMediaId&&n.referenceMediaIds)throw Error('AMBIGUOUS_REFERENCE_IMAGES');
    const ids=n.referenceMediaIds===undefined?(n.referenceMediaId?[n.referenceMediaId]:[]):n.referenceMediaIds;
    if(!Array.isArray(ids)||ids.length>4||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'))throw Error('INVALID_REFERENCE_IMAGES');
    const referenceImages=[];
    for(const id of ids)referenceImages.push(await require('./mediaStore').readMedia(clientId,id));
    require('./graphicService').references({referenceImages});
    try{await options.onProgress?.(step.packageImage?'מכין את העיצוב לקמפיין. אשלח אותו יחד עם שאר הדברים שהכנתי לבדיקה.':'מכין את העיצוב. אשלח אותו לבדיקה כשהוא יהיה מוכן.');}catch{require('./logger').logger.warn('Task progress notice unavailable');}
    step.status='RUNNING';await checkpoint(task,lease);
    const output=await require('./whatsappDelivery').messageContext.run({eventId:'task:'+task.id+':'+step.id},()=>require('./graphicService').createGraphic(clientId,prompt,{...(options.imageOptions||{}),referenceImages}));
    if(!output?.id)throw Error('TASK_IMAGE_NOT_VERIFIED');
    step.result={mediaId:output.id,kind:'image',verified:true};step.artifact={title:step.label,content:'התמונה שנוצרה נשלחה כאן לבדיקה.',mediaId:output.id,...(n.imageText?{imageText:n.imageText}:{}),reviewed:false,hash:hash({mediaId:output.id,imageText:n.imageText||null})};step.status='PREPARED';task.newMedia=[...(task.newMedia||[]),output.id];
   }else if(n.op==='meta'){
    if(task.state.steps.some(s=>s.artifact&&!s.artifact.reviewed))throw Error('TASK_REVIEW_REQUIRED');
    if(n.proposal?.intent!==step.intent)throw Error('TASK_META_INTENT_MISMATCH');
    if(require('./campaignPackage').required(task.request,task.state.planningMode)){
     const image=task.state.steps.find(s=>s.packageImage),copy=task.state.steps.find(s=>s.artifact?.campaignDraft);
     if(step.packageUpload&&n.proposal?.parameters?.mediaId!==image?.artifact?.mediaId)throw Error('CAMPAIGN_IMAGE_NOT_REVIEWED');
     if(['CREATE_BUNDLE','CREATE_CREATIVE'].includes(step.intent)){
      const p=n.proposal.parameters,upload=task.state.steps.find(s=>s.kind==='meta'&&s.intent==='UPLOAD_IMAGE'&&s.status==='DONE'&&s.result?.sourceMediaId===image?.artifact?.mediaId);
      if(!copy?.artifact.reviewed||p.message!==copy.artifact.adContent||p.headline!==copy.artifact.campaignDraft.headline||!upload||p.imageHash!==upload.result.id)throw Error('CAMPAIGN_CONTENT_NOT_REVIEWED');
     }
    }
    const plan={...require('./actionPlan').createActionPlan(n.proposal),taskId:task.id,taskStepId:step.id,taskCreationLease:lease};
    step.status='RUNNING';await checkpoint(task,lease);
    const a=await require('./approvalEngine').createApprovalForClient(clientId,plan);
    step.result={approval:{actionId:a.actionId,planHash:require('./approvalPolicy').planHash(a.actionPlan),plan:a.actionPlan,codeCiphertext:meta.encrypt(a.code,clientId),expiresAt:a.expiresAt}};step.status='WAITING_APPROVAL';task.status='WAITING_APPROVAL';
    if(require('./scopedAuthority').enabled()){
     await checkpoint(task,lease);
     if(await require('./scopedAuthority').approveIfCovered(clientId,a.actionPlan)){
      const outcome=await require('./actionExecutor').executeApprovedForClient(clientId,a.actionPlan);
      if(!outcome.ok){
       if(outcome.blocked){task.status='BLOCKED';task.state.reason=outcome.message||'הכתיבה לחשבון חסומה';}
       else task.status='MANUAL_REVIEW';
       return await settle(task,lease,requestId);
      }
      await reconcile(task);task.status='RUNNING';await checkpoint(task,lease);continue;
     }
    }
    return await settle(task,lease,requestId);
   }
   // The backend owns the consent boundary. A ready package must be shown,
   // not sent around another model loop which can rewrite it indefinitely.
   if(task.state.reviewIssue&&!require('./taskDraftReview').issue(task))delete task.state.reviewIssue;
   if(reviewReady(task)){prepareReview(task);return await settle(task,lease,requestId);}
   await checkpoint(task,lease);
  }
  task.status='BLOCKED';task.state.reason='נדרשת חלוקה של המשימה לשלבים נוספים לפני המשך בטוח';return await settle(task,lease,requestId);
 }catch(error){
  if(error.message==='TASK_UNCERTAIN_SWITCH'){task.status='MANUAL_REVIEW';return await settle(task,lease,requestId);}
  if(error.message==='TASK_HUMAN_PAUSED'){await db.query("UPDATE agent_tasks SET state=$4::jsonb,status='HUMAN_PAUSED',lease_token=NULL,lease_until=NULL,revision=revision+1 WHERE id=$1 AND client_id=$2 AND lease_token=$3",[task.id,clientId,lease,JSON.stringify(task.state)]);return{handled:true,reply:'המשימה הושהתה למענה אנושי. ההתקדמות נשמרה.',externalActionsExecuted:false};}
  if(error.message==='TASK_LEASE_LOST')return{handled:true,reply:'המשימה השתנתה בזמן העבודה. ההמשך לא בוצע.',externalActionsExecuted:false};
  if(task.state.steps.some(s=>s.status==='RUNNING'&&['meta','image'].includes(s.kind)))task.status='MANUAL_REVIEW';else{for(const s of task.state.steps)if(s.status==='RUNNING')s.status='PENDING';task.status='ERROR';}
  task.state.lastError=error instanceof SyntaxError?'INVALID_TASK_JSON':/^[A-Z_]+$/.test(error.message)?error.message:'TASK_STEP_FAILED';
  task.state.errorDiagnostic={type:['SyntaxError','TypeError','ApiError','Error'].includes(error.name)?error.name:'Error',status:Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:null};
  try{return await settle(task,lease,requestId);}catch{return{handled:true,reply:'המשימה נעצרה. לא ניתן לאמת את שמירת התוצאה; נדרשת בדיקה לפני המשך.',externalActionsExecuted:false};}
 }
}
async function maybeHandle(clientId,input,options={}){
 if(!enabled())return null;
 if(process.env.TASK_AGENT_PILOT_ONLY==='true'){const c=(await db.query('SELECT phone FROM clients WHERE id=$1',[clientId])).rows[0];if(!String(process.env.AUTHORIZED_PHONE_NUMBERS||'').split(',').map(require('./auth').normalizePhone).includes(c?.phone))return null;}
 if(input.message.startsWith('/')||require('./conversationControl').isReset(input.message))return null;
 const intent=require('./conversationAnalysis').localAnalysis(input.message).intent;if(['connect','disconnect','renew','connection_status','select_account'].includes(intent))return null;
 const profile=await require('./marketingStore').load(clientId);if(profile?.connection?.status==='ACCOUNT_SELECTION_REQUIRED'&&/^\d+$/.test(input.message.trim()))return null;
 const task=await active(clientId);
 if(!task&&!/^(?:תיצור|תיצרי|צור|צרי|תכין|תכיני|בנה|בני|אני רוצה|אני צריך|אני צריכה|רוצה|תעשה|תעשי|תייצר|תייצרי|צריך|צריכה|create|build|generate)|לגייס עובדים|קמפיין דרושים/i.test(input.message.trim()))return null;
 return send(clientId,input,options);
}
module.exports={enabled,requiredOutcomes,validatePlan,view,current,active,send,maybeHandle,cancel,needsGoalClarification:vagueGoal,canPresentReview};
