'use strict';
const db=require('./db');
const policy=require('./approvalPolicy');
const meta=require('./metaConnection');
const write=require('./metaWrite');
const handlers={CREATE_BUNDLE:write.createBundle,ACTIVATE_BUNDLE:write.activateBundle,UPLOAD_IMAGE:write.uploadImage,CREATE_CAMPAIGN:write.createCampaign,CREATE_ADSET:write.createAdSet,CREATE_CREATIVE:write.createCreative,CREATE_AD:write.createAd,CHANGE_BUDGET:write.changeBudget,PAUSE_CAMPAIGN:write.pauseCampaign,RESUME_CAMPAIGN:write.resumeCampaign,EDIT_CAMPAIGN:write.editCampaign};
async function executeApprovedAction(phone,plan) {
  let claimedFor=null;
  if(process.env.READ_ONLY!=='false'||process.env.META_WRITES_ENABLED!=='true') return {ok:false,blocked:true,reason:'READ_ONLY',message:'האישור נקלט, אך כתיבה ל־Meta נעולה. לא בוצע שינוי.'};
  try {
    policy.strictPlan(plan);
    const client=await require('./clientStore').getOrCreateClient(phone);
    if(String(meta.context.getStore())!==String(client.id)||String(plan.tenantId)!==String(client.id)) throw Error('TENANT_CONTEXT_REQUIRED');
    // Commit the claim before external effects. Never retry an interrupted/uncertain write.
    const claimed=await db.query(`INSERT INTO meta_execution_attempts(action_id,client_id,status)
      SELECT id,client_id,'CLAIMED' FROM action_plans WHERE id=$1 AND client_id=$2 AND status='APPROVED' AND plan_hash=$3
      ON CONFLICT DO NOTHING RETURNING action_id`,[plan.id,client.id,policy.planHash(plan)]);
    if(!claimed.rows.length) throw Error('ACTION_ALREADY_CLAIMED');
    claimedFor={clientId:client.id,actionId:plan.id};
    let result;
    try {
      result=await require('./metaExecution').runApproved(client.id,plan,async()=>{
        const written=await handlers[plan.intent](plan);
        const verified=await require('./metaVerify').verifyAction(plan,written);
        if(!verified.verified) throw Error('POST_WRITE_VERIFICATION_FAILED');
        return {id:written.id || plan.target.campaignId,...(written.objects?{objects:written.objects}:{}),verified:true};
      });
    } catch {
      await db.query("UPDATE meta_execution_attempts SET status='MANUAL_REVIEW',updated_at=NOW() WHERE action_id=$1 AND client_id=$2",[plan.id,client.id]);
      await db.query("UPDATE action_plans SET status='MANUAL_REVIEW',updated_at=NOW() WHERE id=$1 AND client_id=$2",[plan.id,client.id]);
      return {ok:false,reason:'MANUAL_REVIEW',message:'הפעולה דורשת בדיקה ידנית. אין לנסות שוב לפני בירור המצב ב־Meta.'};
    }
    await db.transaction(async tx=>{
      await tx("UPDATE meta_execution_attempts SET status='VERIFIED',updated_at=NOW() WHERE action_id=$1 AND client_id=$2",[plan.id,client.id]);
      await tx("UPDATE action_plans SET status='VERIFIED',execution_result=$3::jsonb,updated_at=NOW() WHERE id=$1 AND client_id=$2",[plan.id,client.id,JSON.stringify(result)]);
      await tx("INSERT INTO tenant_audit(client_id,action_id,event,result) VALUES($1,$2,'META_EXECUTION','VERIFIED')",[client.id,plan.id]);
    });
    return {ok:true,message:'הפעולה בוצעה ואומתה מול Meta. מזהים: '+JSON.stringify(result),writeResult:result};
  } catch {
    if(claimedFor) {
      try {await db.query("UPDATE meta_execution_attempts SET status='MANUAL_REVIEW',updated_at=NOW() WHERE action_id=$1 AND client_id=$2",[claimedFor.actionId,claimedFor.clientId]);} catch {}
      return {ok:false,reason:'MANUAL_REVIEW',message:'לא ניתן לקבוע שהפעולה הושלמה או נחסמה. נדרשת בדיקה ידנית ב־Meta לפני כל ניסיון נוסף.'};
    }
    return {ok:false,blocked:true,reason:'APPROVAL_REJECTED',message:'הפעולה נחסמה. נדרש אישור חדש התואם לחשבון ולתוכנית.'};
  }
}
module.exports={executeApprovedAction};
