'use strict';
const { query, transaction } = require('./db');
const { save } = require('./lifecycleStore');
const { createDurableMockMetaAdapter } = require('./durableMockMetaAdapter');

async function reconcileOne(job) {
  const { id, client_id, lifecycle_id, kind } = job;
  const adapter = createDurableMockMetaAdapter(client_id, lifecycle_id);
  const r = await query('SELECT payload,revision FROM campaign_lifecycles WHERE id=$1 AND client_id=$2', [lifecycle_id,client_id]);
  if (!r.rows.length) throw Error('Lifecycle not found');
  const { payload: flow, revision } = r.rows[0];
  if (String(flow.tenantId) !== String(client_id)) throw Error('Tenant mismatch');
  const state = await adapter.inspect();
  let next;
  if (kind === 'CREATE_PAUSED' && state?.status === 'PAUSED') {
    if (flow.status === 'AWAITING_ACTIVATION_APPROVAL') next = flow;
    else if (['DRAFT_APPROVED','NEEDS_RECONCILIATION'].includes(flow.status)) {
      next = { ...flow, objects: state.objects, status: 'AWAITING_ACTIVATION_APPROVAL', journal: [...flow.journal, { type: 'DRAFT_RECONCILED', at: new Date().toISOString() }] };
    }
  } else if (kind === 'ACTIVATE' && state?.status === 'ACTIVE') {
    if (flow.status === 'ACTIVE_VERIFIED') next = flow;
    else if (['ACTIVATION_APPROVED','NEEDS_RECONCILIATION'].includes(flow.status) && JSON.stringify(flow.objects) === JSON.stringify(state.objects)) {
      next = { ...flow, status: 'ACTIVE_VERIFIED', journal: [...flow.journal, { type: 'ACTIVATION_RECONCILED', at: new Date().toISOString() }] };
    }
  } else if (kind === 'CREATE_PAUSED' && !state && flow.status === 'DRAFT_APPROVED') {
    return { status: 'RETRY', reason: 'No mock object persisted; safe to retry idempotent creation' };
  } else if (kind === 'ACTIVATE' && state?.status === 'PAUSED' && flow.status === 'ACTIVATION_APPROVED') {
    return { status: 'RETRY', reason: 'Mock remains paused; safe to retry idempotent activation' };
  }
  if (!next) return { status: 'MANUAL_REVIEW', reason: 'Unexpected mock or lifecycle state' };
  if (next !== flow) await save(client_id,next,revision);
  await query("UPDATE workflow_jobs SET status='DONE',locked_until=NULL,last_error=NULL,updated_at=NOW() WHERE id=$1", [id]);
  return { status: next.status, jobId: id };
}
module.exports = { reconcileOne };
