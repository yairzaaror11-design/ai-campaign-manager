'use strict';
const db=require('./db');
function retentionDays() {
 const n=Number(process.env.DATA_RETENTION_DAYS || 90);
 if(!Number.isInteger(n)||n<1||n>3650) throw Error('INVALID_RETENTION_DAYS');
 return n;
}
async function maintain() {
 return db.transaction(async tx=>{
  const days=retentionDays();
  await tx("DELETE FROM worker_heartbeats WHERE last_success_at<NOW()-INTERVAL '1 day'");
  await tx('DELETE FROM meta_login_secrets WHERE expires_at<NOW()');
  await tx('DELETE FROM api_rate_limits WHERE expires_at<NOW()');
  await tx("UPDATE whatsapp_inbound_events SET status='MANUAL_REVIEW',payload='{}'::jsonb,last_error='RETENTION_EXPIRED',locked_until=NULL WHERE created_at<NOW()-($1::integer*INTERVAL '1 day') AND status IN ('PENDING','PROCESSING')",[days]);
  await tx("UPDATE whatsapp_outbox SET status='BLOCKED',payload='{}'::jsonb,error_code='RETENTION_EXPIRED' WHERE created_at<NOW()-($1::integer*INTERVAL '1 day') AND status IN ('PENDING','PROCESSING')",[days]);
  for(const table of ['conversation_messages','whatsapp_receipts','tenant_audit','deletion_receipts','performance_snapshots']) await tx(`DELETE FROM ${table} WHERE created_at<NOW()-($1::integer*INTERVAL '1 day')`,[days]);
  await tx('DELETE FROM tenant_media WHERE expires_at<NOW()');
  await tx('DELETE FROM telnyx_inbound_messages WHERE expires_at<NOW()');
 });
}
module.exports={maintain,retentionDays};
