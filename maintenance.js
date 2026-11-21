'use strict';
const db=require('./db');
function retentionDays() {
 const n=Number(process.env.DATA_RETENTION_DAYS || 90);
 if(!Number.isInteger(n)||n<1||n>3650) throw Error('INVALID_RETENTION_DAYS');
 return n;
}
// Audit events that only describe a session, not a decision; deleted with conversation content.
const ROUTINE_AUDIT_EVENTS=['CONVERSATION_STATE','PORTAL_LOGIN','PORTAL_LINK','WORKSPACE_CONTENT'];
async function maintain() {
 return db.transaction(async tx=>{
  const days=retentionDays();
  await tx("DELETE FROM agent_task_turns WHERE created_at<NOW()-($1::integer*INTERVAL '1 day')",[days]);
  await tx("DELETE FROM agent_tasks WHERE updated_at<NOW()-($1::integer*INTERVAL '1 day')",[days]);
  await tx("DELETE FROM support_messages WHERE created_at<NOW()-($1::integer*INTERVAL '1 day')",[days]);
  await tx("UPDATE support_cases SET context='[]'::jsonb,reason='הקשר הפנייה הוסר לפי מדיניות השמירה' WHERE created_at<NOW()-($1::integer*INTERVAL '1 day')",[days]);
  await tx("DELETE FROM worker_heartbeats WHERE last_success_at<NOW()-INTERVAL '1 day'");
  await tx('DELETE FROM portal_login_tickets WHERE expires_at<NOW()');
  await tx('DELETE FROM portal_sessions WHERE expires_at<NOW()');
  await tx('DELETE FROM meta_login_secrets WHERE expires_at<NOW()');
  await tx('DELETE FROM api_rate_limits WHERE expires_at<NOW()');
  await tx("UPDATE whatsapp_inbound_events SET status='MANUAL_REVIEW',payload='{}'::jsonb,last_error='RETENTION_EXPIRED',locked_until=NULL WHERE created_at<NOW()-($1::integer*INTERVAL '1 day') AND status IN ('PENDING','PROCESSING')",[days]);
  await tx("UPDATE whatsapp_outbox SET status='BLOCKED',payload='{}'::jsonb,error_code='RETENTION_EXPIRED' WHERE created_at<NOW()-($1::integer*INTERVAL '1 day') AND status IN ('PENDING','PROCESSING')",[days]);
  for(const table of ['conversation_messages','whatsapp_receipts','deletion_receipts','performance_snapshots']) await tx(`DELETE FROM ${table} WHERE created_at<NOW()-($1::integer*INTERVAL '1 day')`,[days]);
  // The audit record (who approved what, when; no message content) is kept for
  // AUDIT_RETENTION_DAYS (7 years). Routine session noise goes with the content.
  const retention=require('./dataRetention');
  await tx(`DELETE FROM tenant_audit WHERE created_at<NOW()-($1::integer*INTERVAL '1 day') AND event = ANY($2::text[])`,[days,ROUTINE_AUDIT_EVENTS]);
  await tx("DELETE FROM tenant_audit WHERE created_at<NOW()-($1::integer*INTERVAL '1 day')",[retention.auditRetentionDays()]);
  await tx("DELETE FROM approvals WHERE created_at<NOW()-($1::integer*INTERVAL '1 day')",[retention.auditRetentionDays()]);
  await tx('DELETE FROM graphic_jobs WHERE expires_at<NOW()');
  // Inactive profiles go only after the owner was warned 7+ days earlier (dataRetention.warnDue).
  await retention.deleteExpired(tx,days);
  await tx('DELETE FROM tenant_media WHERE expires_at<NOW()');
  await tx('DELETE FROM telnyx_inbound_messages WHERE expires_at<NOW()');
 });
}
module.exports={maintain,retentionDays,ROUTINE_AUDIT_EVENTS};
