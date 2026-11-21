'use strict';
const crypto=require('node:crypto'),{AsyncLocalStorage}=require('node:async_hooks');
const db=require('./db'),meta=require('./metaConnection'),policy=require('./approvalPolicy');
const ownerContext=new AsyncLocalStorage();
// Spending/activation/budget changes deliberately remain exact per-action approvals.
const SUPPORTED=Object.freeze(['CREATE_CAMPAIGN','CREATE_LEAD_FORM','CREATE_ADSET','CREATE_AD','CREATE_CREATIVE','UPLOAD_IMAGE','CREATE_BUNDLE','PAUSE_CAMPAIGN','EDIT_CAMPAIGN']);
const enabled=()=>process.env.SCOPED_AUTOMATION_ENABLED==='true';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
function tenant(clientId){if(String(meta.context.getStore())!==String(clientId))throw Error('TENANT_CONTEXT_REQUIRED');}
function owner(clientId){tenant(clientId);const actor=ownerContext.getStore();if(actor?.role!=='OWNER'||String(actor.clientId)!==String(clientId)||!actor.actorId)throw Error('AUTHORITY_OWNER_REQUIRED');return actor.actorId;}
function keys(value,allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw Error('INVALID_AUTHORITY_INPUT');}
async function withPortalOwner(session,work){
 const row=(await db.query('SELECT client_id FROM portal_sessions WHERE token_hash=$1 AND client_id=$2 AND expires_at>NOW()',[session?.tokenHash,session?.clientId])).rows[0];
 if(!row)throw Error('AUTHORITY_OWNER_REQUIRED');
 return meta.context.run(String(row.client_id),()=>ownerContext.run({clientId:row.client_id,actorId:'portal-owner:'+row.client_id,role:'OWNER'},work));
}
async function binding(tx,clientId){
 const r=await tx('SELECT c.meta_ad_account_id,c.meta_generation,m.app_id FROM clients c JOIN meta_connections m ON m.client_id=c.id WHERE c.id=$1 AND m.app_id=$2 AND m.expires_at>NOW()',[clientId,process.env.META_APP_ID]);
 const c=r.rows[0];if(!c?.meta_ad_account_id)throw Error('AUTHORITY_CONNECTION_REQUIRED');
 return{accountId:c.meta_ad_account_id,connectionGeneration:String(c.meta_generation),appId:c.app_id};
}
function ids(value){if(value===undefined)return[];if(!Array.isArray(value)||value.length>100||value.some(id=>typeof id!=='string'||!/^\d+$/.test(id)))throw Error('INVALID_AUTHORITY_SCOPE');return[...new Set(value)].sort();}
function checked(input){
 keys(input,['requestId','label','intents','campaignIds','pageIds','currency','maxDailyBudgetMinor','maxActions','expiresAt']);
 if(!uuid(input.requestId)||typeof input.label!=='string'||!input.label.trim()||input.label.length>120)throw Error('INVALID_AUTHORITY_INPUT');
 if(!Array.isArray(input.intents)||!input.intents.length||input.intents.length>SUPPORTED.length||input.intents.some(i=>!SUPPORTED.includes(i)))throw Error('AUTHORITY_ACTION_UNSUPPORTED');
 if(!Number.isSafeInteger(input.maxActions)||input.maxActions<1||input.maxActions>1000||!['ILS','USD','EUR','GBP','CAD','AUD','JPY','KRW'].includes(input.currency))throw Error('INVALID_AUTHORITY_LIMIT');
 const expires=Date.parse(input.expiresAt);if(!Number.isFinite(expires)||expires<=Date.now()+60000||expires>Date.now()+30*86400000)throw Error('INVALID_AUTHORITY_EXPIRY');
 const cap=input.maxDailyBudgetMinor??null;
 if(cap!==null&&(!Number.isSafeInteger(cap)||cap<1)||input.intents.some(i=>['CREATE_BUNDLE','CREATE_ADSET'].includes(i))&&cap===null)throw Error('AUTHORITY_BUDGET_CAP_REQUIRED');
 return{label:input.label.trim(),intents:[...new Set(input.intents)].sort(),campaignIds:ids(input.campaignIds),pageIds:ids(input.pageIds),currency:input.currency,maxDailyBudgetMinor:cap,maxActions:input.maxActions,expiresAt:new Date(expires).toISOString()};
}
function view(row,used=0){const expired=Date.parse(row.policy.expiresAt)<=Date.now();return{id:row.id,policy:row.policy,hash:row.policy_hash,status:row.status,revision:row.revision,usedActions:Number(used),remainingActions:enabled()&&row.status==='ACTIVE'&&!expired?Math.max(0,row.policy.maxActions-Number(used)):0,approvedAt:row.approved_at||null,revokedAt:row.revoked_at||null,expired,spendingAuthorized:false};}
async function audit(tx,clientId,row,event,actor){await tx('INSERT INTO authority_audit(client_id,mandate_id,actor,event,revision) VALUES($1,$2,$3,$4,$5)',[clientId,row.id,actor,event,row.revision]);}
async function countedView(tx,row){const used=(await tx('SELECT COUNT(*) AS n FROM authority_uses WHERE client_id=$1 AND mandate_id=$2',[row.client_id,row.id])).rows[0].n;return view(row,used);}
async function propose(clientId,input){
 const actor=owner(clientId);if(!enabled())throw Error('SCOPED_AUTOMATION_DISABLED');const fields=checked(input),fingerprint=policy.planHash(fields);
 return db.transaction(async tx=>{
  await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[clientId]);
  const prior=(await tx('SELECT * FROM authority_requests WHERE client_id=$1 AND request_id=$2',[clientId,input.requestId])).rows[0];
  if(prior){if(prior.fingerprint!==fingerprint)throw Error('AUTHORITY_REQUEST_CONFLICT');return countedView(tx,(await tx('SELECT * FROM authority_mandates WHERE client_id=$1 AND id=$2',[clientId,prior.mandate_id])).rows[0]);}
  const id=crypto.randomUUID(),payload={...fields,id,clientId:String(clientId),provider:'meta',...await binding(tx,clientId)};
  const hash=policy.planHash(payload);
  const row=(await tx('INSERT INTO authority_mandates(id,client_id,policy,policy_hash) VALUES($1,$2,$3::jsonb,$4) RETURNING *',[id,clientId,JSON.stringify(payload),hash])).rows[0];
  await tx('INSERT INTO authority_requests(client_id,request_id,fingerprint,mandate_id) VALUES($1,$2,$3,$4)',[clientId,input.requestId,fingerprint,id]);await audit(tx,clientId,row,'PROPOSED',actor);return view(row);
 });
}
async function approve(clientId,id,input){
 const actor=owner(clientId);if(!enabled())throw Error('SCOPED_AUTOMATION_DISABLED');keys(input,['revision','confirmHash','confirmation']);
 if(!uuid(id)||!Number.isInteger(input.revision)||input.confirmation!=='APPROVE_SCOPED_AUTHORITY'||!/^[a-f0-9]{64}$/.test(input.confirmHash||''))throw Error('INVALID_AUTHORITY_CONFIRMATION');
 return db.transaction(async tx=>{
  await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[clientId]);
  const row=(await tx('SELECT * FROM authority_mandates WHERE client_id=$1 AND id=$2 FOR UPDATE',[clientId,id])).rows[0];
  if(!row||row.status!=='DRAFT'||row.revision!==input.revision||row.policy_hash!==input.confirmHash||policy.planHash(row.policy)!==row.policy_hash||Date.parse(row.policy.expiresAt)<=Date.now())throw Error('AUTHORITY_STALE');
  const current=await binding(tx,clientId);if(Object.keys(current).some(k=>current[k]!==row.policy[k]))throw Error('AUTHORITY_CONNECTION_CHANGED');
  const saved=(await tx("UPDATE authority_mandates SET status='ACTIVE',revision=revision+1,approved_by=$3,approved_at=NOW() WHERE client_id=$1 AND id=$2 RETURNING *",[clientId,id,actor])).rows[0];
  await audit(tx,clientId,saved,'APPROVED',actor);return view(saved);
 });
}
async function list(clientId){tenant(clientId);const r=await db.query("SELECT m.*,(SELECT COUNT(*) FROM authority_uses u WHERE u.client_id=m.client_id AND u.mandate_id=m.id) AS used FROM authority_mandates m WHERE m.client_id=$1 AND COALESCE(m.policy->>'kind','')<>'WORK_AGREEMENT' ORDER BY m.created_at DESC,m.id LIMIT 100",[clientId]);return{enabled:enabled(),supportedIntents:[...SUPPORTED],spendingAuthorized:false,mandates:r.rows.map(r=>view(r,r.used))};}
async function revoke(clientId,id,input){
 const actor=owner(clientId);keys(input,['revision']);if(!uuid(id)||!Number.isInteger(input.revision))throw Error('INVALID_AUTHORITY_INPUT');
 return db.transaction(async tx=>{
  await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[clientId]);
  const row=(await tx('SELECT * FROM authority_mandates WHERE client_id=$1 AND id=$2 FOR UPDATE',[clientId,id])).rows[0];
  if(!row||row.revision!==input.revision||row.status==='REVOKED')throw Error('AUTHORITY_STALE');
  const saved=(await tx("UPDATE authority_mandates SET status='REVOKED',revision=revision+1,revoked_at=NOW() WHERE client_id=$1 AND id=$2 RETURNING *",[clientId,id])).rows[0];
  await audit(tx,clientId,saved,'REVOKED',actor);return countedView(tx,saved);
 });
}
function covers(row,plan){
 const p=row.policy;
 if(p?.kind===AGREEMENT)return false; // a work agreement is checked by agreementDecision, never as a scoped mandate
 if(row.status!=='ACTIVE'||Date.parse(p.expiresAt)<=Date.now()||policy.planHash(p)!==row.policy_hash||!SUPPORTED.includes(plan.intent)||!p.intents.includes(plan.intent)||p.provider!=='meta'||String(p.clientId)!==String(plan.tenantId)||p.accountId!==plan.target.accountId||p.appId!==plan.metaAppId||p.connectionGeneration!==String(plan.connectionGeneration)||p.currency!==plan.review?.currency)return false;
 const campaign=plan.target.campaignId||plan.parameters.campaignId;
 if(p.campaignIds.length&&(!campaign||!p.campaignIds.includes(campaign)))return false;
 if(p.pageIds.length&&plan.parameters.pageId&&!p.pageIds.includes(plan.parameters.pageId))return false;
 if(['CREATE_BUNDLE','CREATE_ADSET'].includes(plan.intent)&&(!Number.isSafeInteger(plan.parameters.dailyBudgetMinor)||plan.parameters.dailyBudgetMinor>p.maxDailyBudgetMinor))return false;
 return true;
}
function reviewedContent(task,plan){
 const artifacts=task.state.steps.map(s=>s.artifact).filter(a=>a?.reviewed);
 if(plan.intent==='UPLOAD_IMAGE')return artifacts.some(a=>a.mediaId===plan.parameters.mediaId);
 if(['CREATE_LEAD_FORM','CREATE_CREATIVE','CREATE_BUNDLE','CREATE_AD'].includes(plan.intent)){
  const digest=policy.planHash(plan.parameters);
  return artifacts.some(a=>{try{return policy.planHash(JSON.parse(a.content))===digest;}catch{return false;}});
 }
 return true;
}
async function approveIfCovered(clientId,plan){
 tenant(clientId);if(!enabled()||process.env.READ_ONLY!=='false'||process.env.META_WRITES_ENABLED!=='true'||!SUPPORTED.includes(plan.intent)||!plan.taskId)return false;policy.strictPlan(plan);
 return db.transaction(async tx=>{
  await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[clientId]);
  const task=(await tx('SELECT * FROM agent_tasks WHERE client_id=$1 AND id=$2 FOR UPDATE',[clientId,plan.taskId])).rows[0];
  if(!task||task.status!=='WAITING_APPROVAL'||task.lease_token!==plan.taskCreationLease||new Date(task.lease_until)<=new Date()||task.state.steps.some(s=>s.artifact&&!s.artifact.reviewed)||!task.state.steps.some(s=>s.id===plan.taskStepId&&s.status==='WAITING_APPROVAL'&&s.result?.approval?.actionId===plan.id))return false;
  // A broad action scope is not permission to change the content after its review.
  if(!reviewedContent(task,plan))return false;
  const hash=policy.planHash(plan),action=(await tx('SELECT * FROM action_plans WHERE id=$1 AND client_id=$2 FOR UPDATE',[plan.id,clientId])).rows[0];
  if(!action||action.status!=='PROPOSED'||action.plan_hash!==hash||policy.planHash(action.payload)!==hash)return false;
  if((await tx('SELECT action_id FROM authority_uses WHERE action_id=$1',[plan.id])).rows.length)return false;
  const current=await binding(tx,clientId);if(current.accountId!==plan.target.accountId||current.appId!==plan.metaAppId||current.connectionGeneration!==String(plan.connectionGeneration))return false;
  const rows=(await tx("SELECT * FROM authority_mandates WHERE client_id=$1 AND status='ACTIVE' ORDER BY created_at,id FOR UPDATE",[clientId])).rows;
  for(const row of rows){
   if(!covers(row,plan))continue;
   const used=Number((await tx('SELECT COUNT(*) AS n FROM authority_uses WHERE client_id=$1 AND mandate_id=$2',[clientId,row.id])).rows[0].n);if(used>=row.policy.maxActions)continue;
   const approval=await tx("UPDATE approvals SET status='APPROVED',used_at=NOW() WHERE action_id=$1 AND client_id=$2 AND status='PENDING' AND plan_hash=$3 AND expires_at>NOW() RETURNING id",[plan.id,clientId,hash]);if(approval.rows.length!==1)return false;
   await tx('INSERT INTO authority_uses(action_id,client_id,mandate_id,mandate_revision,plan_hash) VALUES($1,$2,$3,$4,$5)',[plan.id,clientId,row.id,row.revision,hash]);
   await tx("UPDATE action_plans SET status='APPROVED',updated_at=NOW() WHERE id=$1 AND client_id=$2",[plan.id,clientId]);await audit(tx,clientId,row,'ACTION_AUTHORIZED','scoped-policy');return true;
  }
  return false;
 });
}
async function assertExecution(tx,clientId,plan){
 const use=(await tx('SELECT * FROM authority_uses WHERE action_id=$1 AND client_id=$2',[plan.id,clientId])).rows[0];if(!use)return;
 const row=(await tx('SELECT * FROM authority_mandates WHERE id=$1 AND client_id=$2',[use.mandate_id,clientId])).rows[0];
 if(row?.policy?.kind===AGREEMENT){
  // Pause-all or a new agreement after the authorization blocks the action before any write.
  if(row.status!=='ACTIVE'||row.revision!==use.mandate_revision||use.plan_hash!==policy.planHash(plan)||!agreementDecision(row,plan,{skipCeiling:true}).ok)throw Error('SCOPED_AUTHORITY_REVOKED_OR_STALE');
  return;
 }
 if(!enabled()||!row||row.revision!==use.mandate_revision||use.plan_hash!==policy.planHash(plan)||!covers(row,plan))throw Error('SCOPED_AUTHORITY_REVOKED_OR_STALE');
}
// ---- Work agreement (הסכם עבודה) ----
// One standing mandate the owner sets once (WhatsApp or dashboard). It is an authority_mandates
// row with policy.kind=WORK_AGREEMENT: same audit, same authority_uses ledger, same execution
// re-check. Inside it the agent acts and reports; outside it the agent asks. It never authorizes
// spend beyond the owner's monthly ceiling or per-campaign daily maximum.
const AGREEMENT='WORK_AGREEMENT';
const AGREEMENT_ALLOW=Object.freeze(['pauseLosing','lowerBudget','shiftBudget','refreshCreatives','organicPosts','answerLeads','activateNew']);
const ALWAYS_ASK=Object.freeze(['activateNewCampaign','raiseAboveCeiling','newFinancialCommitment','delete','irreversible']);
const CURRENCIES=['ILS','USD','EUR','GBP','CAD','AUD','JPY','KRW'];
const unit=cur=>['JPY','KRW'].includes(cur)?1:100;
function withWhatsAppOwner(clientId,work){
 // The WhatsApp sender was already authenticated as this business's owner by the inbound pipeline.
 return meta.context.run(String(clientId),()=>ownerContext.run({clientId,actorId:'whatsapp-owner:'+clientId,role:'OWNER'},work));
}
function agreementFields(input){
 keys(input,['monthlyCeiling','maxDailyPerCampaign','allow','styleNotes','forbiddenTopics','currency']);
 const amount=v=>{const n=Number(v);return Number.isFinite(n)&&n>0&&n<=10000000?Math.round(n*100)/100:null;};
 const monthly=amount(input.monthlyCeiling),daily=amount(input.maxDailyPerCampaign),currency=input.currency||'ILS';
 if(!monthly||!daily)throw Error('AGREEMENT_LIMITS_REQUIRED');
 if(daily>monthly)throw Error('AGREEMENT_DAILY_ABOVE_MONTHLY');
 if(!CURRENCIES.includes(currency))throw Error('INVALID_AGREEMENT_INPUT');
 const a=input.allow??{};
 if(!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).some(k=>!AGREEMENT_ALLOW.includes(k)||typeof a[k]!=='boolean'))throw Error('INVALID_AGREEMENT_INPUT');
 const allow=Object.fromEntries(AGREEMENT_ALLOW.map(k=>[k,a[k]===true]));
 const styleNotes=input.styleNotes==null?'':input.styleNotes;
 if(typeof styleNotes!=='string'||styleNotes.length>1000)throw Error('INVALID_AGREEMENT_INPUT');
 let topics=input.forbiddenTopics==null?[]:input.forbiddenTopics;
 if(typeof topics==='string')topics=topics.split(/[,\n،]/);
 if(!Array.isArray(topics)||topics.length>20||topics.some(t=>typeof t!=='string'||t.length>80))throw Error('INVALID_AGREEMENT_INPUT');
 topics=[...new Set(topics.map(t=>t.trim()).filter(Boolean))];
 return{kind:AGREEMENT,monthlyCeiling:monthly,maxDailyPerCampaign:daily,currency,allow,styleNotes:styleNotes.trim(),forbiddenTopics:topics,alwaysAsk:[...ALWAYS_ASK]};
}
function agreementView(row){
 if(!row)return null;const p=row.policy;
 return{id:row.id,status:row.status,paused:row.status==='PAUSED',revision:row.revision,setAt:row.approved_at||row.created_at,monthlyCeiling:p.monthlyCeiling,maxDailyPerCampaign:p.maxDailyPerCampaign,currency:p.currency,allow:{...p.allow},styleNotes:p.styleNotes,forbiddenTopics:[...p.forbiddenTopics],alwaysAsk:[...p.alwaysAsk]};
}
const LIVE="status IN ('ACTIVE','PAUSED') AND policy->>'kind'='WORK_AGREEMENT'";
async function agreementRow(clientId,q=db.query){return(await q('SELECT * FROM authority_mandates WHERE client_id=$1 AND '+LIVE+' ORDER BY created_at DESC LIMIT 1',[clientId])).rows[0]||null;}
async function getAgreement(clientId){return agreementView(await agreementRow(clientId));}
async function setAgreement(clientId,input){
 const actor=owner(clientId),fields=agreementFields(input);
 return db.transaction(async tx=>{
  await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[clientId]);
  const prior=await tx("UPDATE authority_mandates SET status='REVOKED',revision=revision+1,revoked_at=NOW() WHERE client_id=$1 AND "+LIVE+" RETURNING *",[clientId]);
  for(const r of prior.rows)await audit(tx,clientId,r,'REVOKED',actor);
  const id=crypto.randomUUID(),payload={...fields,id,clientId:String(clientId),provider:'meta'};
  const row=(await tx("INSERT INTO authority_mandates(id,client_id,policy,policy_hash,status,approved_by,approved_at) VALUES($1,$2,$3::jsonb,$4,'ACTIVE',$5,NOW()) RETURNING *",[id,clientId,JSON.stringify(payload),policy.planHash(payload),actor])).rows[0];
  await audit(tx,clientId,row,'AGREEMENT_SET',actor);return agreementView(row);
 });
}
// One tap: stop (or restart) every automatic action. Anything authorized but not yet executed is blocked.
async function setPaused(clientId,paused){
 const actor=owner(clientId);
 return db.transaction(async tx=>{
  await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[clientId]);
  const row=await agreementRow(clientId,tx);if(!row)throw Error('AGREEMENT_NOT_FOUND');
  if(row.status===(paused?'PAUSED':'ACTIVE'))return agreementView(row);
  const saved=(await tx('UPDATE authority_mandates SET status=$3,revision=revision+1 WHERE client_id=$1 AND id=$2 RETURNING *',[clientId,row.id,paused?'PAUSED':'ACTIVE'])).rows[0];
  await audit(tx,clientId,saved,paused?'PAUSED':'RESUMED',actor);return agreementView(saved);
 });
}
const pauseAll=clientId=>setPaused(clientId,true),resumeAll=clientId=>setPaused(clientId,false);
// Projected month spend = spent so far + (committed daily budgets + the change) × days left.
function withinCeiling(p,ctx,addMinor){
 if(!ctx||!Number.isFinite(ctx.monthSpend)||!Number.isFinite(ctx.committedDailyMinor)||!Number.isInteger(ctx.daysLeft)||ctx.daysLeft<1)return{ok:false,why:'SPEND_UNKNOWN'};
 const projected=Math.round((ctx.monthSpend+(ctx.committedDailyMinor+addMinor)/unit(p.currency)*ctx.daysLeft)*100)/100;
 return projected<=p.monthlyCeiling?{ok:true,projected}:{ok:false,why:'ABOVE_CEILING',projected};
}
// Pure: may the agent do this plan alone under this agreement row? {ok, why}
function agreementDecision(row,plan,ctx){
 ctx=ctx||{};const p=row?.policy;
 if(!row||p?.kind!==AGREEMENT)return{ok:false,why:'NO_AGREEMENT'};
 if(row.status!=='ACTIVE')return{ok:false,why:'PAUSED'};
 if(policy.planHash(p)!==row.policy_hash||String(p.clientId)!==String(plan?.tenantId))return{ok:false,why:'NO_AGREEMENT'};
 if(plan.review?.currency&&plan.review.currency!==p.currency)return{ok:false,why:'CURRENCY'};
 const a=p.allow,maxDaily=Math.round(p.maxDailyPerCampaign*unit(p.currency)),ceiling=add=>ctx.skipCeiling?{ok:true}:withinCeiling(p,ctx,add);
 if(['PAUSE_CAMPAIGN','PAUSE_AD'].includes(plan.intent))return a.pauseLosing?{ok:true,why:'PROTECTIVE'}:{ok:false,why:'NOT_ALLOWED'};
 if(plan.intent==='CHANGE_BUDGET'){
  const next=plan.parameters?.dailyBudgetMinor,cur=Number(plan.review?.currentDailyBudgetMinor);
  if(!Number.isSafeInteger(next)||!Number.isFinite(cur)||cur<=0)return{ok:false,why:'BUDGET_UNKNOWN'};
  if(next<cur)return a.lowerBudget?{ok:true,why:'PROTECTIVE'}:{ok:false,why:'NOT_ALLOWED'};
  if(!a.shiftBudget)return{ok:false,why:'NOT_ALLOWED'};
  if(next>maxDaily)return{ok:false,why:'ABOVE_DAILY'};
  return ceiling(next-cur);
 }
 if(['ACTIVATE_BUNDLE','RESUME_CAMPAIGN'].includes(plan.intent)){
  if(!a.activateNew)return{ok:false,why:'ALWAYS_ASK'};
  const daily=require('./spendCap').planDailyMinor(plan);
  if(!daily)return{ok:false,why:'BUDGET_UNKNOWN'};
  if(daily>maxDaily)return{ok:false,why:'ABOVE_DAILY'};
  return ceiling(daily);
 }
 // New campaigns, copies, audiences, edits, anything irreversible: always ask.
 return{ok:false,why:'ALWAYS_ASK'};
}
// Marks a prepared approval as authorized by the agreement (inside one locked transaction).
async function authorizeByAgreement(clientId,plan,ctx,reason){
 tenant(clientId);if(process.env.READ_ONLY!=='false'||process.env.META_WRITES_ENABLED!=='true'||plan.taskId)return false;policy.strictPlan(plan);
 return db.transaction(async tx=>{
  await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[clientId]);
  const row=(await tx("SELECT * FROM authority_mandates WHERE client_id=$1 AND status='ACTIVE' AND policy->>'kind'='WORK_AGREEMENT' FOR UPDATE",[clientId])).rows[0];
  if(!agreementDecision(row,plan,ctx).ok)return false;
  const hash=policy.planHash(plan),action=(await tx('SELECT * FROM action_plans WHERE id=$1 AND client_id=$2 FOR UPDATE',[plan.id,clientId])).rows[0];
  if(!action||action.status!=='PROPOSED'||action.plan_hash!==hash||policy.planHash(action.payload)!==hash)return false;
  if((await tx('SELECT action_id FROM authority_uses WHERE action_id=$1',[plan.id])).rows.length)return false;
  const approval=await tx("UPDATE approvals SET status='APPROVED',used_at=NOW() WHERE action_id=$1 AND client_id=$2 AND status='PENDING' AND plan_hash=$3 AND expires_at>NOW() RETURNING id",[plan.id,clientId,hash]);if(approval.rows.length!==1)return false;
  await tx('INSERT INTO authority_uses(action_id,client_id,mandate_id,mandate_revision,plan_hash,reason) VALUES($1,$2,$3,$4,$5,$6)',[plan.id,clientId,row.id,row.revision,hash,String(reason||plan.summary||'').slice(0,500)]);
  await tx("UPDATE action_plans SET status='APPROVED',updated_at=NOW() WHERE id=$1 AND client_id=$2",[plan.id,clientId]);
  await audit(tx,clientId,row,'ACTION_AUTHORIZED','work-agreement');return true;
 });
}
module.exports={SUPPORTED,enabled,withPortalOwner,withWhatsAppOwner,propose,approve,list,revoke,approveIfCovered,assertExecution,AGREEMENT,AGREEMENT_ALLOW,ALWAYS_ASK,agreementFields,getAgreement,setAgreement,pauseAll,resumeAll,agreementDecision,withinCeiling,authorizeByAgreement};
