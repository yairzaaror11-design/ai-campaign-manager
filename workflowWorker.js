'use strict';
const { query, transaction } = require('./db');
const { save } = require('./lifecycleStore');
const { createPaused, activate } = require('./campaignLifecycle');
const { createDurableMockMetaAdapter } = require('./durableMockMetaAdapter');
const { reconcileOne } = require('./workflowReconciliation');
const MAX_ATTEMPTS = 5;
const backoffSeconds = attempts => Math.min(900, 5 * Math.pow(2, Math.min(8, attempts - 1)));

async function runOne(targetLifecycleId = null) {
  if (process.env.MOCK_META_ENABLED !== 'true' || process.env.READ_ONLY !== 'true') return { status: 'DISABLED' };
  const claimed = await transaction(async tx => {
    const r = await tx(`SELECT id,client_id,lifecycle_id,kind,status,attempts FROM workflow_jobs
      WHERE status IN ('PENDING','LEASED','RECONCILE') AND available_at <= NOW() AND (locked_until IS NULL OR locked_until < NOW()) AND ($1::uuid IS NULL OR lifecycle_id=$1::uuid)
      ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1`, [targetLifecycleId]);
    if (!r.rows.length) return null;
    await tx("UPDATE workflow_jobs SET status='LEASED',attempts=attempts+1,locked_until=NOW()+INTERVAL '2 minutes',updated_at=NOW() WHERE id=$1", [r.rows[0].id]);
    return r.rows[0];
  });
  if (!claimed) return { status: 'IDLE' };
  const { id, client_id, lifecycle_id, kind } = claimed;
  try {
    if (claimed.status === 'LEASED' || claimed.status === 'RECONCILE') {
      const recovered = await reconcileOne(claimed);
      if (recovered.status !== 'RETRY') {
        if (recovered.status === 'MANUAL_REVIEW') await query("UPDATE workflow_jobs SET status='MANUAL_REVIEW',last_error=$2,locked_until=NULL WHERE id=$1", [id,recovered.reason]);
        return recovered;
      }
    }
    const r = await query('SELECT payload,revision FROM campaign_lifecycles WHERE id=$1 AND client_id=$2', [lifecycle_id,client_id]);
    if (!r.rows.length) throw Error('Lifecycle not found');
    const row = r.rows[0], flow = row.payload;
    if (String(flow.tenantId) !== String(client_id)) throw Error('Tenant mismatch');
    const adapter = createDurableMockMetaAdapter(client_id,lifecycle_id);
    let next;
    if (kind === 'CREATE_PAUSED' && flow.status === 'DRAFT_APPROVED') next = await createPaused(flow,adapter);
    else if (kind === 'ACTIVATE' && flow.status === 'ACTIVATION_APPROVED') next = await activate(flow,adapter);
    else if ((kind === 'CREATE_PAUSED' && flow.status === 'AWAITING_ACTIVATION_APPROVAL') || (kind === 'ACTIVATE' && flow.status === 'ACTIVE_VERIFIED')) next = flow;
    else throw Error('State requires manual reconciliation');
    if (next !== flow) await save(client_id,next,row.revision);
    if (next.status === 'NEEDS_RECONCILIATION') throw Error('Operation result unknown; reconcile persisted mock state');
    await query("UPDATE workflow_jobs SET status='DONE',locked_until=NULL,updated_at=NOW() WHERE id=$1", [id]);
    return { status: next.status, jobId: id };
  } catch (error) {
    const attempts = Number(claimed.attempts) + 1;
    const final = attempts >= MAX_ATTEMPTS;
    await query(`UPDATE workflow_jobs SET status=$2,last_error=$3,locked_until=NULL,
      available_at=NOW()+($4::integer * INTERVAL '1 second'),updated_at=NOW() WHERE id=$1`,
      [id, final ? 'MANUAL_REVIEW' : 'RECONCILE', String(error.message).slice(0,1000), backoffSeconds(attempts)]);
    return { status: final ? 'MANUAL_REVIEW' : 'RECONCILE', jobId: id, reason: error.message };
  }
}
module.exports = { runOne };
