'use strict';
const crypto=require('node:crypto'),db=require('./db'),meta=require('./metaConnection'),planner=require('./taskPlanner');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const KINDS=['collect','read','draft','image','meta'];
const OPS={ask:'collect',collect:'collect',read:'read',draft:'draft',image:'image',meta:'meta'};
const enabled=()=>process.env.TASK_AGENT_ENABLED==='true'&&(process.env.TASK_AGENT_REQUIRE_EVAL!=='true'||require('./taskEvaluation').ready());
function text(value,max=2000){if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('INVALID_TASK_TEXT');return value.trim();}
function safe(value,limit=4000){
 const json=JSON.stringify(value,((key,v)=>/token|secret|password|authorization|cookie|ciphertext|paging/i.test(key)?undefined:v));
 if(!json)return null;
 return json.length<=limit?JSON.parse(json):{excerpt:json.slice(0,limit),truncated:true};
}
function requiredOutcomes(request){
 const localOnly=/^(?:(?:תכין|תכיני|הכן|תיצור|צור|אני רוצה)(?:\s+לי)?\s+)?(?:רק\s+)?(?:טיוטה|טיוטת|נוסח|שאלות לטופס|תוכנית|תכנית|תכנון|אסטרטגיה)/.test(request.trim())||/רק\s+(?:טיוטה|טיוטת|נוסח|תכנון)/.test(request);
 if(localOnly)return[];
 const outcomes=[];
 if(/קמפיין/.test(request)&&/תיצור|תיצרי|צור|צרי|תכין|תכיני|בנה|בני|תקים|להקים|לבנות/.test(request))outcomes.push({label:'קמפיין בחשבון Meta',intents:/מסגרת|קמפיין ריק/.test(request)?['CREATE_CAMPAIGN','CREATE_BUNDLE']:['CREATE_BUNDLE']});
 if(/טופס/.test(request)&&!/טופס\s+(?:קיים|שכבר)|טופס.*שיש/.test(request)&&/תיצור|תיצרי|צור|צרי|תכין|תכיני|בנה|בני|תקים/.test(request))outcomes.push({label:'טופס לידים ב-Meta',intents:['CREATE_LEAD_FORM']});
 if(/פרסם|תפרסם|תפרסמי|תפעיל|הפעל|תעלי? לאוויר/.test(request)&&!/(?:לא|בלי|ללא)\s+(?:לפרסם|פרסום|תפרסם|הפעלה)/.test(request))outcomes.push({label:'הפעלה מאושרת',intents:['ACTIVATE_BUNDLE','RESUME_CAMPAIGN']});
 return outcomes;
}
function validatePlan(plan,request=''){

 if(!Array.isArray(plan)||!plan.length||plan.length>12)throw Error('INVALID_TASK_PLAN');
 const seen=new Set();
 const steps=plan.map(p=>{
  if(!p||!/^[a-z][a-z0-9_]{0,39}$/.test(p.id||'')||seen.has(p.id)||!KINDS.includes(p.kind)||!Array.isArray(p.dependsOn)||p.dependsOn.some(id=>!seen.has(id)))throw Error('INVALID_TASK_PLAN');
  if(p.kind==='meta'&&!require('./actionPlan').WRITE_INTENTS.has(p.intent))throw Error('UNSUPPORTED_TASK_CAPABILITY');
  seen.add(p.id);return{id:p.id,label:text(p.label,160),kind:p.kind,dependsOn:[...new Set(p.dependsOn)],...(p.kind==='meta'?{intent:p.intent}:{}),status:'PENDING'};
 });
 if(requiredOutcomes(request).some(o=>!steps.some(s=>s.kind==='meta'&&o.intents.includes(s.intent))))throw Error('TASK_PLAN_MISSING_OUTCOME');
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
 if(task.status==='WAITING_INPUT')return s.question;
 if(task.status==='WAITING_REVIEW')return (s.steps||[]).filter(x=>x.status==='PREPARED').map(x=>x.artifact.title+'\n'+x.artifact.content).join('\n\n')+'\n\nזו החבילה לבדיקה שלך. אפשר לבקש תיקונים, או לכתוב ״מאשר את החבילה״. אישור החבילה אינו אישור לפרסום או להוצאה כספית.';
 const waiting=s.steps?.find(x=>x.status==='WAITING_APPROVAL');
 if(waiting){const a=waiting.result.approval;return require('./actionPlan').formatActionPlan(a.plan)+'\n\nכדי לאשר את הפעולה המדויקת, שלח: אשר '+meta.decrypt(a.codeCiphertext,task.client_id)+'\nהאישור תקף עד '+a.expiresAt+'. האישור מתייחס רק לפעולה הזו.';}
 if(task.status==='COMPLETE')return 'השלמתי את כל השלבים בתוכנית שנבדקה. '+((s.steps||[]).some(x=>x.kind==='meta')?'הפעולות החיצוניות המסומנות כהושלמו אומתו מול Meta.':'התוצרים הוכנו ואושרו; לא בוצעה פעולה חיצונית.')+'\n'+(s.steps||[]).filter(x=>x.artifact).map(x=>x.artifact.title+'\n'+x.artifact.content).join('\n\n');
 if(task.status==='CANCELLED')return 'המשך העבודה על המשימה בוטל והאישורים הממתינים בוטלו. פעולות שכבר בוצעו אינן מתבטלות אוטומטית.';
 if(task.status==='MANUAL_REVIEW')return 'המשימה נעצרה לבדיקה: לא ניתן לקבוע בביטחון אם פעולה הושלמה. לא אבצע אותה שוב עד לבירור התוצאה.';
 if(task.status==='PAUSED')return 'עצרתי את המשימה. ההתקדמות נשמרה; אפשר לכתוב ״המשך במשימה״.';
 if(task.status==='BLOCKED')return 'כדי להשלים את המשימה צריך לפתור את החלק הבא: '+(s.reason||'יכולת שלא זמינה כרגע')+'. שאר ההתקדמות נשמרה.';
 if(task.status==='HUMAN_PAUSED')return 'המענה האוטומטי והמשימה הושהו למענה אנושי.';
 return 'ההתקדמות נשמרה, אבל לא הצלחתי להשלים את הצעד הבא כרגע. אפשר לנסות שוב; פעולה חיצונית לא תבוצע מחדש אם תוצאתה אינה ודאית.';
}
async function settle(task,lease,requestId){
 await checkpoint(task,lease);
 const result={handled:true,reply:task.customReply||replyFor(task),mediaIds:task.newMedia||[],task:view(task),externalActionsExecuted:view(task).externalActionsExecuted};
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
async function claim(clientId,{message,requestId,channel,taskRevision}){
 return db.transaction(async tx=>{
  const owner=await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[clientId]);if(!owner.rows.length)throw Error('CLIENT_NOT_FOUND');
  const fingerprint=hash({message,channel,taskRevision});
  const prior=(await tx('SELECT * FROM agent_task_turns WHERE client_id=$1 AND request_id=$2',[clientId,requestId])).rows[0];
  if(prior?.fingerprint!==undefined&&prior.fingerprint!==fingerprint)throw Error('TASK_REQUEST_CONFLICT');
  if(prior?.result){const cached={...prior.result};if(cached.replyCiphertext){cached.reply=meta.decrypt(cached.replyCiphertext,clientId);delete cached.replyCiphertext;}return{cached};}
  let task=prior?(await tx('SELECT * FROM agent_tasks WHERE id=$1 AND client_id=$2 FOR UPDATE',[prior.task_id,clientId])).rows[0]:(await tx("SELECT * FROM agent_tasks WHERE client_id=$1 AND status NOT IN ('COMPLETE','CANCELLED') FOR UPDATE",[clientId])).rows[0];
  if(taskRevision!==undefined&&(!Number.isInteger(taskRevision)||taskRevision!==task?.revision))throw Error('TASK_STALE');
  if(task?.lease_until&&new Date(task.lease_until)>new Date())return{cached:{handled:true,reply:'אני עדיין עובד על המשימה. ההתקדמות נשמרת; לא התחלתי עותק נוסף.',task:view(task),busy:true,externalActionsExecuted:false}};
  if(!task){task={id:crypto.randomUUID(),client_id:clientId,request:message,status:'READY',revision:1,state:{steps:[],facts:{},messages:[]}};await tx('INSERT INTO agent_tasks(id,client_id,request,state) VALUES($1,$2,$3,$4::jsonb)',[task.id,clientId,message,JSON.stringify(task.state)]);}
  if(!prior)task.state.messages=[...(task.state.messages||[]),{role:'user',content:message}].slice(-12);
  if((task.state.steps||[]).some(s=>s.status==='RUNNING'&&['image','meta'].includes(s.kind)))task.status='MANUAL_REVIEW';
  else for(const s of task.state.steps||[])if(s.status==='RUNNING')s.status='PENDING';
  const lease=crypto.randomUUID();
  await tx("UPDATE agent_tasks SET lease_token=$2,lease_until=NOW()+INTERVAL '5 minutes',state=$3::jsonb,status=$4 WHERE id=$1",[task.id,lease,JSON.stringify(task.state),task.status]);
  if(!prior)await tx('INSERT INTO agent_task_turns(client_id,request_id,task_id,fingerprint) VALUES($1,$2,$3,$4)',[clientId,requestId,task.id,fingerprint]);
  return{task,lease};
 });
}
async function reconcile(task){
 for(const step of task.state.steps||[]){
  if(step.status!=='WAITING_APPROVAL')continue;
  const a=step.result.approval,row=(await db.query('SELECT status,plan_hash,execution_result FROM action_plans WHERE id=$1 AND client_id=$2',[a.actionId,task.client_id])).rows[0];
  if(row?.plan_hash!==a.planHash)throw Error('TASK_APPROVAL_CHANGED');
  if(row.status==='VERIFIED'&&row.execution_result?.verified){step.status='DONE';step.result={...row.execution_result,actionId:a.actionId,verified:true};}
  else if(['APPROVED','MANUAL_REVIEW'].includes(row.status)){task.status='MANUAL_REVIEW';return;}
  else if(row.status!=='PROPOSED'||new Date(a.expiresAt)<=new Date()){step.status='PENDING';delete step.result;}
 }
}
function contextFor(task,known){
 return{request:task.request,requiredOutcomes:requiredOutcomes(task.request),lastError:task.state.lastError||null,pendingQuestion:task.state.question||null,plan:task.state.steps.map(s=>({...s,result:s.result?.approval?{awaitingExactApproval:true}:safe(s.result,1500)})),facts:task.state.facts,messages:task.state.messages.slice(-6),knownBusiness:known,readTools:planner.READ_TOOLS,writeSchema:require('./gemini').functionDeclarations.find(t=>t.name==='propose_action').parameters,notes:'Only DONE is completed. PREPARED drafts await local review; WAITING_APPROVAL Meta actions have not executed.'};
}
function dependenciesReady(task,step){return step.dependsOn.every(id=>{const dep=task.state.steps.find(s=>s.id===id);return dep.status==='DONE'||step.kind!=='meta'&&dep.status==='PREPARED';});}
async function send(clientId,{message,requestId,channel='PORTAL',taskRevision}={},options={}){
 text(message);text(requestId,200);if(!['PORTAL','WHATSAPP'].includes(channel))throw Error('INVALID_TASK_CHANNEL');
 if(String(meta.context.getStore())!==String(clientId))throw Error('TENANT_CONTEXT_REQUIRED');
 if((await require('./humanSupport').current(clientId))?.bot_paused)return{handled:true,reply:'המענה האוטומטי מושהה למענה אנושי.',externalActionsExecuted:false};
 if(/^(בטל את המשימה|בטלי את המשימה)$/.test(message.trim()))return await cancel(clientId)||{handled:true,reply:'אין משימה פתוחה לביטול.',externalActionsExecuted:false};
 const claimed=await claim(clientId,{message:message.trim(),requestId,channel,taskRevision});if(claimed.cached)return claimed.cached;
 const {task,lease}=claimed;
 try{
  if(/^(מצב המשימה|מה מצב המשימה|איפה עומדים|מה כבר עשית)$/.test(message.trim())){const labels={DONE:'הושלם',PREPARED:'מוכן לבדיקה',WAITING_INPUT:'ממתין לפרט ממך',WAITING_APPROVAL:'ממתין לאישור פעולה',PENDING:'טרם בוצע',RUNNING:'בתהליך'};task.customReply='היעד: '+task.request+'\n'+task.state.steps.map(s=>s.label+': '+(labels[s.status]||s.status)).join('\n');return await settle(task,lease,requestId);}
  if(task.status==='MANUAL_REVIEW')return await settle(task,lease,requestId);
  if(task.status==='PAUSED'&&!/^(המשך במשימה|נמשיך|המשך|תמשיך)$/.test(message.trim()))return await settle(task,lease,requestId);
  if(/^(עצור|עצירה|עצור את המשימה)$/.test(message.trim())){task.status='PAUSED';return await settle(task,lease,requestId);}
  // A paused task resumes only on a new explicit user message, never by a timer.
  await reconcile(task);if(task.status==='MANUAL_REVIEW')return await settle(task,lease,requestId);
  const revisionRequested=/^(?:שנה|שני|תשנה|תשני|תקן|תקני|תתקן|תתקני|עדכן|עדכני|תעדכן|תעדכני|קצר|קצרי|תוסיף|תוסיפי|במקום|בעצם|לא אהבתי)(?:\s|$)/.test(message.trim());
  if(revisionRequested){
   if(task.state.steps.some(s=>s.kind==='meta'&&s.status==='DONE')){task.status='BLOCKED';task.state.reason='כבר בוצעה פעולה בחשבון; נדרשת תוכנית עדכון נפרדת כדי שלא ליצור עותק או לשנות פעולה שכבר אושרה';return await settle(task,lease,requestId);}
   for(const step of task.state.steps){
    if(step.status==='WAITING_APPROVAL'){const id=step.result.approval.actionId;await db.query("UPDATE approvals SET status='CANCELLED' WHERE action_id=$1 AND client_id=$2 AND status='PENDING'",[id,clientId]);await db.query("UPDATE action_plans SET status='CANCELLED' WHERE id=$1 AND client_id=$2 AND status='PROPOSED'",[id,clientId]);step.status='PENDING';delete step.result;}
    if(step.artifact){step.status='PREPARED';step.artifact.reviewed=false;}
   }
   task.state.revising=true;delete task.state.reviewHash;
  }
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
  if(task.status==='WAITING_REVIEW'&&/^(כן|לא|מאשר|מאשרת|אוקיי)$/.test(message.trim()))return await settle(task,lease,requestId);
  if(task.status==='WAITING_REVIEW'&&/^(מאשר את החבילה|מאשרת את החבילה)$/.test(message.trim())){
   if(task.state.reviewHash!==hash(task.state.steps.filter(s=>s.status==='PREPARED').map(s=>[s.id,s.artifact.hash])))throw Error('TASK_REVIEW_CHANGED');
   for(const step of task.state.steps)if(step.status==='PREPARED'){step.status='DONE';step.artifact.reviewed=true;}
   delete task.state.reviewHash;delete task.state.revising;
  }
  task.status='RUNNING';await checkpoint(task,lease);
  const known=await require('./marketingStore').context(clientId)||{};
  for(let round=0;round<16;round++){
   if((task.state.plannerCalls||0)>=64||!await require('./rateLimit').take('task-planner:'+clientId,60,3600)){task.status='BLOCKED';task.state.reason='המשימה הגיעה למגבלת התכנון כדי לעצור לולאה או עלות לא צפויה';return await settle(task,lease,requestId);}
   task.state.plannerCalls=(task.state.plannerCalls||0)+1;await checkpoint(task,lease);
   const decision=await planner.decide(contextFor(task,known),options);
   if(!decision||typeof decision!=='object'||!decision.next)throw Error('INVALID_TASK_DECISION');
   if(!task.state.steps.length)task.state.steps=validatePlan(decision.plan,task.request);
   else if(decision.plan!==undefined)throw Error('TASK_PLAN_ALREADY_SET');
   const n=decision.next;
   if(n.op==='review'){
    if(!task.state.steps.some(s=>s.status==='PREPARED'))throw Error('TASK_ARTIFACTS_REQUIRED');
    task.state.reviewHash=hash(task.state.steps.filter(s=>s.status==='PREPARED').map(s=>[s.id,s.artifact.hash]));task.status='WAITING_REVIEW';return await settle(task,lease,requestId);
   }
   if(n.op==='finish'){
    if(requiredOutcomes(task.request).some(o=>!task.state.steps.some(s=>s.kind==='meta'&&s.status==='DONE'&&s.result?.verified&&o.intents.includes(s.intent)))||task.state.steps.some(s=>s.status!=='DONE')||!task.state.steps.some(s=>['draft','image','meta','read'].includes(s.kind)))throw Error('TASK_NOT_COMPLETE');
    task.status='COMPLETE';return await settle(task,lease,requestId);
   }
   const step=task.state.steps.find(s=>s.id===n.stepId);
   if(!step||step.status==='STALE'||step.status==='DONE'&&!(step.kind==='read'&&n.op==='read'&&step.lastReadTurn!==requestId)&&!(task.state.revising&&step.kind==='collect'&&n.op==='collect')||step.status==='WAITING_APPROVAL'||!dependenciesReady(task,step))throw Error('TASK_STEP_NOT_READY');
   if(n.op==='blocked'){task.state.reason=text(n.reason,600);step.reason=task.state.reason;task.status='BLOCKED';return await settle(task,lease,requestId);}
   if(OPS[n.op]!==step.kind)throw Error('TASK_OPERATION_MISMATCH');
   if(n.op==='ask'){task.state.question=text(n.question,600);step.status='WAITING_INPUT';task.status='WAITING_INPUT';return await settle(task,lease,requestId);}
   if(n.op==='collect'){
    if(!Array.isArray(n.facts)||n.facts.length>12||!Array.isArray(n.knownFields||[]))throw Error('INVALID_TASK_FACTS');
    const facts={...task.state.facts},sources=[task.request,...task.state.messages.filter(m=>m.role==='user').map(m=>m.content)];
    for(const f of n.facts){if(!/^[a-z][a-z0-9_]{0,49}$/.test(f.key||'')||typeof f.evidence!=='string'||!sources.some(s=>s.includes(f.evidence))||!f.evidence.includes(text(f.value,1000)))throw Error('UNGROUNDED_TASK_FACT');facts[f.key]={value:f.value,evidence:f.evidence};}
    for(const field of n.knownFields||[]){if(!known.facts?.[field]?.value)throw Error('UNKNOWN_TASK_FACT');facts[field]={value:known.facts[field].value,source:'known_business'};}
    if(!n.facts.length&&!n.knownFields?.length||JSON.stringify(facts).length>10000)throw Error('INVALID_TASK_FACTS');
    if(task.state.revising&&hash(facts)!==hash(task.state.facts)){for(const dependent of task.state.steps)if(dependent.kind==='draft'){dependent.status='PENDING';delete dependent.artifact;}if(task.state.steps.some(s=>s.kind==='image'&&s.result?.mediaId)){for(const imageStep of task.state.steps)if(imageStep.kind==='image'&&imageStep.result?.mediaId)imageStep.status='STALE';task.status='BLOCKED';task.state.reason='פרטי המשימה השתנו אחרי יצירת תמונה; יש לבדוק ולהכין מחדש את התמונה לפני שימוש בה';task.state.facts=facts;return await settle(task,lease,requestId);}}
    task.state.facts=facts;step.status='DONE';
   }else if(n.op==='draft'){
    const artifact={title:text(n.title,160),content:text(n.content,6000),reviewed:false};artifact.hash=hash(artifact);step.artifact=artifact;step.status='PREPARED';
    if(task.state.steps.reduce((sum,s)=>sum+(s.artifact?.content.length||0),0)>18000)throw Error('TASK_ARTIFACT_LIMIT');
   }else if(n.op==='read'){
    if(!planner.READ_TOOLS.includes(n.tool)||!n.args||typeof n.args!=='object'||JSON.stringify(n.args).length>2000)throw Error('TASK_READ_TOOL_REJECTED');
    step.status='RUNNING';await checkpoint(task,lease);
    step.result=safe(await (options.readTool||require('./gemini').runTool)(n.tool,n.args));step.status='DONE';step.lastReadTurn=requestId;
   }else if(n.op==='image'){
    const prompt=text(n.prompt);
    if(n.referenceMediaId&&n.referenceMediaIds)throw Error('AMBIGUOUS_REFERENCE_IMAGES');
    const ids=n.referenceMediaIds===undefined?(n.referenceMediaId?[n.referenceMediaId]:[]):n.referenceMediaIds;
    if(!Array.isArray(ids)||ids.length>4||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'))throw Error('INVALID_REFERENCE_IMAGES');
    const referenceImages=[];
    for(const id of ids)referenceImages.push(await require('./mediaStore').readMedia(clientId,id));
    require('./graphicService').references({referenceImages});
    step.status='RUNNING';await checkpoint(task,lease);
    const output=await require('./whatsappDelivery').messageContext.run({eventId:'task:'+task.id+':'+step.id},()=>require('./graphicService').createGraphic(clientId,prompt,{...(options.imageOptions||{}),referenceImages}));
    if(!output?.id)throw Error('TASK_IMAGE_NOT_VERIFIED');
    step.result={mediaId:output.id,kind:'image',verified:true};step.artifact={title:step.label,content:'התמונה שנוצרה נשלחה כאן לבדיקה.',mediaId:output.id,reviewed:false,hash:hash({mediaId:output.id})};step.status='PREPARED';task.newMedia=[...(task.newMedia||[]),output.id];
   }else if(n.op==='meta'){
    if(task.state.steps.some(s=>s.artifact&&!s.artifact.reviewed))throw Error('TASK_REVIEW_REQUIRED');
    if(n.proposal?.intent!==step.intent)throw Error('TASK_META_INTENT_MISMATCH');
    const plan={...require('./actionPlan').createActionPlan(n.proposal),taskId:task.id,taskStepId:step.id,taskCreationLease:lease};
    step.status='RUNNING';await checkpoint(task,lease);
    const a=await require('./approvalEngine').createApprovalForClient(clientId,plan);
    step.result={approval:{actionId:a.actionId,planHash:require('./approvalPolicy').planHash(a.actionPlan),plan:a.actionPlan,codeCiphertext:meta.encrypt(a.code,clientId),expiresAt:a.expiresAt}};step.status='WAITING_APPROVAL';task.status='WAITING_APPROVAL';return await settle(task,lease,requestId);
   }
   await checkpoint(task,lease);
  }
  task.status='BLOCKED';task.state.reason='נדרשת חלוקה של המשימה לשלבים נוספים לפני המשך בטוח';return await settle(task,lease,requestId);
 }catch(error){
  if(error.message==='TASK_HUMAN_PAUSED'){await db.query("UPDATE agent_tasks SET state=$4::jsonb,status='HUMAN_PAUSED',lease_token=NULL,lease_until=NULL,revision=revision+1 WHERE id=$1 AND client_id=$2 AND lease_token=$3",[task.id,clientId,lease,JSON.stringify(task.state)]);return{handled:true,reply:'המשימה הושהתה למענה אנושי. ההתקדמות נשמרה.',externalActionsExecuted:false};}
  if(error.message==='TASK_LEASE_LOST')return{handled:true,reply:'המשימה השתנתה בזמן העבודה. ההמשך לא בוצע.',externalActionsExecuted:false};
  if(task.state.steps.some(s=>s.status==='RUNNING'&&['meta','image'].includes(s.kind)))task.status='MANUAL_REVIEW';else{for(const s of task.state.steps)if(s.status==='RUNNING')s.status='PENDING';task.status='ERROR';}
  task.state.lastError=/^[A-Z_]+$/.test(error.message)?error.message:'TASK_STEP_FAILED';
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
module.exports={enabled,requiredOutcomes,validatePlan,view,current,active,send,maybeHandle,cancel};
