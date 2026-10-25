'use strict';
const { query, transaction } = require('./db');
const { save } = require('./lifecycleStore');
const { createPaused, activate } = require('./campaignLifecycle');
const { createDurableMockMetaAdapter } = require('./durableMockMetaAdapter');

async function runOne() {
  if (process.env.MOCK_META_ENABLED !== 'true') return { status: 'DISABLED' };
  const claimed = await transaction(async tx => {
    const r = await tx(`SELECT id,client_id,lifecycle_id,kind FROM workflow_jobs
      WHERE status IN ('PENDING','LEASED') AND (locked_until IS NULL OR locked_until < NOW())
      ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1`);
    if (!r.rows.length) return null;
    await tx("UPDATE workflow_jobs SET status='LEASED',attempts=attempts+1,locked_until=NOW()+INTERVAL '2 minutes',updated_at=NOW() WHERE id=$1", [r.rows[0].id]);
    return r.rows[0];
  });
  if (!claimed) return { status: 'IDLE' };
  const { id, client_id, lifecycle_id, kind } = claimed;
  try {
    const r = await query('SELECT payload,revision FROM campaign_lifecycles WHERE id=$1 AND client_id=$2', [lifecycle_id,client_id]);
    if (!r.rows.length) throw Error('Lifecycle not found');
    const row = r.rows[0], flow = row.payload;
    if (String(flow.tenantId) !== String(client_id)) throw Error('Tenant mismatch');
    const adapter = createDurableMockMetaAdapter(client_id,lifecycle_id);
    let next;
    if (kind === 'CREATE_PAUSED' && flow.status === 'DRAFT_APPROVED') next = await createPaused(flow,adapter);
    else if (kind === 'ACTIVATE' && flow.status === 'ACTIVATION_APPROVED') next = await activate(flow,adapter);
    else if (['AWAITING_ACTIVATION_APPROVAL','ACTIVE_VERIFIED'].includes(flow.status)) next = flow;
    else throw Error('State requires manual reconciliation');
    if (next !== flow) await save(client_id,next,row.revision);
    await query("UPDATE workflow_jobs SET status='DONE',locked_until=NULL,updated_at=NOW() WHERE id=$1", [id]);
    return { status: next.status, jobId: id };
  } catch (error) {
    await query("UPDATE workflow_jobs SET status='RECONCILE',locked_until=NULL,updated_at=NOW() WHERE id=$1", [id]);
    return { status: 'RECONCILE', jobId: id, reason: error.message };
  }
}
module.exports = { runOne };
