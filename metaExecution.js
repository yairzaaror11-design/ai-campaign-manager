'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const permit=new AsyncLocalStorage();
const {planHash,strictPlan}=require('./approvalPolicy');
const db=require('./db');
async function runApproved(clientId,input,work) {
  strictPlan(input);
  return db.transaction(async tx=>{
    const r=await tx(`SELECT p.*,c.meta_ad_account_id,c.meta_generation FROM action_plans p JOIN clients c ON c.id=p.client_id
      WHERE p.id=$1 AND p.client_id=$2 FOR UPDATE OF p,c`,[input.id,clientId]);
    const row=r.rows[0];
    if(!row || row.payload.metaAppId!==process.env.META_APP_ID || row.status!=='APPROVED' || row.plan_hash!==planHash(input) || row.plan_hash!==planHash(row.payload) || row.account_id!==row.meta_ad_account_id || String(row.connection_generation)!==String(row.meta_generation)) throw Error('APPROVED_ACTION_REQUIRED');
    if(input.taskId){const task=(await tx('SELECT * FROM agent_tasks WHERE id=$1 AND client_id=$2',[input.taskId,clientId])).rows[0];if(!task||['CANCELLED','COMPLETE','HUMAN_PAUSED','MANUAL_REVIEW'].includes(task.status)||!task.lease_token||new Date(task.lease_until)<=new Date()||!task.state.steps.some(s=>s.id===input.taskStepId&&s.status==='WAITING_APPROVAL'&&s.result?.approval?.actionId===input.id))throw Error('TASK_NOT_ACTIVE');}
    await require('./scopedAuthority').assertExecution(tx,clientId,input);
    const approved=await tx("SELECT id FROM approvals WHERE action_id=$1 AND client_id=$2 AND status='APPROVED' AND plan_hash=$3 AND expires_at>NOW()",[input.id,clientId,row.plan_hash]);
    if(!approved.rows.length) throw Error('APPROVAL_EXPIRED');
    const attempt=await tx("SELECT action_id FROM meta_execution_attempts WHERE action_id=$1 AND client_id=$2 AND status='CLAIMED'",[input.id,clientId]);
    if(!attempt.rows.length) throw Error('EXECUTION_CLAIM_REQUIRED');
    if((await tx('SELECT id FROM support_cases WHERE client_id=$1 AND bot_paused=true LIMIT 1',[clientId])).rows.length)throw Error('HUMAN_SUPPORT_PAUSED');
    const connection=await require('./metaConnection').credentials(clientId);
    const permissions=await require('./metaConnection').graph('/me/permissions',connection.token);
    if(!permissions.data?.some(p=>p.permission==='ads_management'&&p.status==='granted')) throw Error('ADS_MANAGEMENT_REQUIRED');
    // The row lock serializes disconnect/account selection with the entire mutation.
    // Persist EXECUTING in a separate committed claim before calling this function (executor).
    return permit.run({clientId:String(clientId),hash:row.plan_hash,plan:row.payload,token:connection.token},work);
  });
}
function assertPermit(plan) {
  const current=permit.getStore();
  if(!current || planHash(plan)!==current.hash || String(require('./metaConnection').context.getStore())!==current.clientId) throw Error('APPROVED_ACTION_REQUIRED');
  return current;
}
module.exports={runApproved,assertPermit};
