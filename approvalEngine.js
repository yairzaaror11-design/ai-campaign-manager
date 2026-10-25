'use strict';
const crypto=require('node:crypto');
const db=require('./db');
const {getOrCreateClient}=require('./clientStore');
const policy=require('./approvalPolicy');
async function createApproval(phone,input) {
  if(!db.configured()) throw Error('DATABASE_REQUIRED_FOR_APPROVALS');
  if(!input?.requiresApproval || input.missing?.length) throw Error('INCOMPLETE_ACTION');
  const client=await getOrCreateClient(phone);
  const plan=await policy.preparePlan(client.id,input);
  const hash=policy.planHash(plan);
  const code=String(crypto.randomInt(100000,1000000));
  const minutes=Math.max(1,Math.min(30,Number(process.env.APPROVAL_TTL_MINUTES)||10));
  const expiresAt=new Date(Date.now()+minutes*60000);
  await db.transaction(async tx=>{
    await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[client.id]);
    await tx("UPDATE approvals SET status='SUPERSEDED' WHERE client_id=$1 AND status='PENDING'",[client.id]);
    const saved=await tx(`INSERT INTO action_plans(id,client_id,intent,payload,status,plan_hash,account_id,connection_generation)
      VALUES($1,$2,$3,$4::jsonb,'PROPOSED',$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,[plan.id,client.id,plan.intent,JSON.stringify(plan),hash,plan.target.accountId,plan.connectionGeneration]);
    if(!saved.rows.length) throw Error('ACTION_ALREADY_EXISTS');
    await tx('INSERT INTO approvals(client_id,action_id,code,expires_at,plan_hash) VALUES($1,$2,$3,$4,$5)',[client.id,plan.id,policy.codeDigest(client.id,code),expiresAt,hash]);
    await tx("INSERT INTO tenant_audit(client_id,action_id,event,result) VALUES($1,$2,'APPROVAL_CREATED','PENDING')",[client.id,plan.id]);
  });
  return {code,phone:client.phone,actionPlan:plan,actionId:plan.id,expiresAt};
}
async function consumeApproval(phone,code) {
  if(!/^\d{6}$/.test(code)) return {ok:false,reason:'NOT_FOUND'};
  const client=await getOrCreateClient(phone);
  if(!await require('./rateLimit').take('approval:'+client.id,8,600)) return {ok:false,reason:'RATE_LIMITED'};
  return db.transaction(async tx=>{
    const result=await tx(`SELECT a.*,p.payload,p.status AS plan_status,p.plan_hash AS stored_hash,p.account_id,p.connection_generation,
       c.meta_ad_account_id,c.meta_generation
       FROM approvals a JOIN action_plans p ON p.id=a.action_id AND p.client_id=a.client_id
       JOIN clients c ON c.id=a.client_id WHERE a.client_id=$1 AND a.code=$2 FOR UPDATE OF a,p,c`,[client.id,policy.codeDigest(client.id,code)]);
    const r=result.rows[0];
    if(!r) return {ok:false,reason:'NOT_FOUND'};
    if(r.status!=='PENDING'||r.used_at||r.plan_status!=='PROPOSED') return {ok:false,reason:'ALREADY_USED'};
    if(new Date(r.expires_at)<=new Date()) return {ok:false,reason:'EXPIRED'};
    if(r.account_id!==r.meta_ad_account_id || String(r.connection_generation)!==String(r.meta_generation) || r.plan_hash!==r.stored_hash || policy.planHash(r.payload)!==r.plan_hash) return {ok:false,reason:'STALE_PLAN'};
    policy.strictPlan(r.payload);
    await tx("UPDATE approvals SET status='APPROVED',used_at=NOW() WHERE id=$1",[r.id]);
    await tx("UPDATE action_plans SET status='APPROVED',updated_at=NOW() WHERE id=$1 AND client_id=$2",[r.action_id,client.id]);
    await tx("INSERT INTO tenant_audit(client_id,action_id,event,result) VALUES($1,$2,'APPROVAL_CONSUMED','APPROVED')",[client.id,r.action_id]);
    return {ok:true,approval:{actionId:r.action_id,actionPlan:r.payload,expiresAt:r.expires_at}};
  });
}
async function cancelPendingApprovals(phone) {
 const client=await getOrCreateClient(phone);
 await db.query("UPDATE approvals SET status='CANCELLED' WHERE client_id=$1 AND status='PENDING'",[client.id]);
}
module.exports={createApproval,consumeApproval,cancelPendingApprovals};
