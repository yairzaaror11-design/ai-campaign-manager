'use strict';
const db=require('./db');
const policy=require('./approvalPolicy');
const meta=require('./metaConnection');
const write=require('./metaWrite');
const handlers={CREATE_LEAD_FORM:write.createLeadForm,CREATE_BUNDLE:write.createBundle,ACTIVATE_BUNDLE:write.activateBundle,UPLOAD_IMAGE:write.uploadImage,CREATE_CAMPAIGN:write.createCampaign,CREATE_ADSET:write.createAdSet,CREATE_CREATIVE:write.createCreative,CREATE_AD:write.createAd,CHANGE_BUDGET:write.changeBudget,DUPLICATE_CAMPAIGN:write.duplicateCampaign,PAUSE_CAMPAIGN:write.pauseCampaign,PAUSE_AD:write.pauseAd,RESUME_CAMPAIGN:write.resumeCampaign,EDIT_CAMPAIGN:write.editCampaign,SYNC_BUYER_AUDIENCE:write.syncBuyerAudience,CREATE_LOOKALIKE:write.createLookalike};
async function executeApprovedAction(phone,plan){if(process.env.READ_ONLY!=='false'||process.env.META_WRITES_ENABLED!=='true')return executeApprovedForClient(null,plan);const client=await require('./clientStore').getOrCreateClient(phone);return executeApprovedForClient(client.id,plan);}
// What makes two plans "the same change": intent, target object and the parameters the owner sees.
function fingerprint(plan){const t=plan.target||{},p={...(plan.parameters||{})};delete p.currency;return policy.planHash({intent:plan.intent,campaignId:t.campaignId||null,adsetId:t.adsetId||null,...(t.adId?{adId:t.adId}:{}),parameters:p});}
// Actions that create a budget or turn spend on: a repeat could charge twice.
const MONEY=['CREATE_BUNDLE','CREATE_ADSET','ACTIVATE_BUNDLE','RESUME_CAMPAIGN','CHANGE_BUDGET','DUPLICATE_CAMPAIGN'];
async function duplicateOf(clientId,plan){
  if(!MONEY.includes(plan.intent)&&!['PAUSE_CAMPAIGN','PAUSE_AD'].includes(plan.intent))return null;
  const rows=(await db.query(`SELECT id,intent,payload,status,updated_at FROM action_plans WHERE client_id=$1 AND id<>$2 AND updated_at>NOW()-INTERVAL '1 day'
    AND status IN ('APPROVED','MANUAL_REVIEW','VERIFIED') ORDER BY updated_at DESC LIMIT 50`,[clientId,plan.id])).rows;
  const mine=fingerprint(plan),campaign=plan.target?.campaignId;
  for(const r of rows){
    const recent=Date.now()-new Date(r.updated_at).getTime()<30*60000;
    // Re-trying a pause whose first attempt is uncertain is safe (it cannot cost money); everything else stops.
    if(r.intent===plan.intent&&fingerprint(r.payload)===mine&&(r.status==='APPROVED'||recent&&r.status==='VERIFIED'||r.status==='MANUAL_REVIEW'&&!['PAUSE_CAMPAIGN','PAUSE_AD'].includes(plan.intent)))
      return r.status==='VERIFIED'?'עצרתי: בדיוק אותה פעולה כבר בוצעה ואומתה לפני כמה דקות. כדי לא לבצע (ולחייב) פעמיים, לא ביצעתי אותה שוב.'
        :r.status==='APPROVED'?'עצרתי: אותה פעולה בדיוק נמצאת עכשיו בביצוע. לא אריץ אותה פעמיים.'
        :'עצרתי: ניסיון קודם של אותה פעולה לא הסתיים בוודאות. כדי לא לחייב פעמיים אני לא מנסה שוב לפני שבודקים ב־Meta מה קרה.';
    // A money action on a campaign whose previous change is uncertain: stop rather than stack another one.
    if(MONEY.includes(plan.intent)&&campaign&&r.status==='MANUAL_REVIEW'&&r.payload?.target?.campaignId===campaign)
      return 'עצרתי: שינוי קודם בקמפיין הזה לא הסתיים בוודאות. לפני כל שינוי שעולה כסף צריך לבדוק ב־Meta מה קרה, כדי לא לחייב פעמיים.';
  }
  return null;
}
async function executeApprovedForClient(clientId,plan) {
  let claimedFor=null;
  if(process.env.READ_ONLY!=='false'||process.env.META_WRITES_ENABLED!=='true') return {ok:false,blocked:true,reason:'READ_ONLY',message:'האישור נקלט, אך כתיבה ל־Meta נעולה. לא בוצע שינוי.'};
  try {
    policy.strictPlan(plan);
    const client=(await db.query('SELECT id FROM clients WHERE id=$1',[clientId])).rows[0];if(!client)throw Error('CLIENT_NOT_FOUND');
    if(String(meta.context.getStore())!==String(client.id)||String(plan.tenantId)!==String(client.id)) throw Error('TENANT_CONTEXT_REQUIRED');
    // Duplicate protection: the same change already done, in flight or uncertain -> stop, never repeat it.
    const duplicate=await duplicateOf(client.id,plan);
    if(duplicate){
      await db.query("UPDATE action_plans SET status='BLOCKED',updated_at=NOW() WHERE id=$1 AND client_id=$2 AND status='APPROVED'",[plan.id,client.id]);
      await db.query("INSERT INTO tenant_audit(client_id,action_id,event,result) VALUES($1,$2,'META_EXECUTION','DUPLICATE_BLOCKED')",[client.id,plan.id]);
      return{ok:false,blocked:true,reason:'DUPLICATE_ACTION',message:duplicate};
    }
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
    } catch (error) {
      if(error.message==='SCOPED_AUTHORITY_REVOKED_OR_STALE'){
        await db.query("UPDATE meta_execution_attempts SET status='BLOCKED',updated_at=NOW() WHERE action_id=$1 AND client_id=$2",[plan.id,client.id]);
        await db.query("UPDATE action_plans SET status='BLOCKED',updated_at=NOW() WHERE id=$1 AND client_id=$2",[plan.id,client.id]);
        return{ok:false,blocked:true,reason:'SCOPED_AUTHORITY_BLOCKED',message:'מסגרת ההרשאה השתנתה או בוטלה. הפעולה נחסמה לפני ביצוע שינוי בפלטפורמה.'};
      }
      if(error.message==='CUSTOM_AUDIENCE_TOS_REQUIRED'){
        // Meta definitively refused: the Custom Audience terms are not accepted yet.
        await db.query("UPDATE meta_execution_attempts SET status='BLOCKED',updated_at=NOW() WHERE action_id=$1 AND client_id=$2",[plan.id,client.id]);
        await db.query("UPDATE action_plans SET status='BLOCKED',updated_at=NOW() WHERE id=$1 AND client_id=$2",[plan.id,client.id]);
        return{ok:false,blocked:true,reason:'CUSTOM_AUDIENCE_TOS_REQUIRED',message:require('./buyerAudiences').tosMessage(plan.target.accountId)};
      }
      await db.query("UPDATE meta_execution_attempts SET status='MANUAL_REVIEW',updated_at=NOW() WHERE action_id=$1 AND client_id=$2",[plan.id,client.id]);
      await db.query("UPDATE action_plans SET status='MANUAL_REVIEW',updated_at=NOW() WHERE id=$1 AND client_id=$2",[plan.id,client.id]);
      return {ok:false,reason:'MANUAL_REVIEW',message:'הפעולה דורשת בדיקה ידנית. אין לנסות שוב לפני בירור המצב ב־Meta.'};
    }
    await db.transaction(async tx=>{
      await tx("UPDATE meta_execution_attempts SET status='VERIFIED',updated_at=NOW() WHERE action_id=$1 AND client_id=$2",[plan.id,client.id]);
      await tx("UPDATE action_plans SET status='VERIFIED',execution_result=$3::jsonb,updated_at=NOW() WHERE id=$1 AND client_id=$2",[plan.id,client.id,JSON.stringify(result)]);
      await tx("INSERT INTO tenant_audit(client_id,action_id,event,result) VALUES($1,$2,'META_EXECUTION','VERIFIED')",[client.id,plan.id]);
    });
    // A form SCORPIO created starts feeding Lead Ads leads into the CRM (best effort, never fails the action).
    if(plan.intent==='CREATE_LEAD_FORM'&&/^\d+$/.test(String(result.id||'')))await require('./metaLeadImport').registerCreatedForm(client.id,plan.parameters.pageId,String(result.id)).catch(()=>{});
    return {ok:true,message:'הפעולה בוצעה ואומתה מול Meta. מזהים: '+JSON.stringify(result),writeResult:result};
  } catch {
    if(claimedFor) {
      try {await db.query("UPDATE meta_execution_attempts SET status='MANUAL_REVIEW',updated_at=NOW() WHERE action_id=$1 AND client_id=$2",[claimedFor.actionId,claimedFor.clientId]);} catch {}
      return {ok:false,reason:'MANUAL_REVIEW',message:'לא ניתן לקבוע שהפעולה הושלמה או נחסמה. נדרשת בדיקה ידנית ב־Meta לפני כל ניסיון נוסף.'};
    }
    return {ok:false,blocked:true,reason:'APPROVAL_REJECTED',message:'הפעולה נחסמה. נדרש אישור חדש התואם לחשבון ולתוכנית.'};
  }
}
module.exports={executeApprovedAction,executeApprovedForClient,fingerprint,duplicateOf};
