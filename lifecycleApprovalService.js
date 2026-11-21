'use strict';
const { transaction } = require('./db');
const { approveStage } = require('./campaignLifecycle');

/** Central approval transaction for lifecycle commands. No external effect occurs here. */
async function approveLifecycle({ clientId, actorId, adAccountId, lifecycleId, stage, planHash }) {
  if (!clientId || !actorId || !/^act_[0-9]+$/.test(String(adAccountId))) throw Error('Approval identity required');
  if (!['CREATE_PAUSED','ACTIVATE'].includes(stage)) throw Error('Invalid approval stage');
  return transaction(async tx => {
    const r = await tx('SELECT payload,revision FROM campaign_lifecycles WHERE id=$1 AND client_id=$2 FOR UPDATE', [lifecycleId,clientId]);
    if (!r.rows.length) throw Error('Lifecycle not found');
    const { payload: flow, revision } = r.rows[0];
    if (String(flow.tenantId) !== String(clientId) || flow.plan?.brief?.adAccountId !== adAccountId) throw Error('Approval scope mismatch');
    const owner = await tx('SELECT id FROM clients WHERE id=$1 AND meta_ad_account_id=$2 FOR SHARE', [clientId,adAccountId]);
    if (!owner.rows.length || String(actorId) !== String(clientId)) throw Error('Unauthorized actor');
    const approved = approveStage(flow,stage,String(actorId),planHash);
    const saved = await tx('UPDATE campaign_lifecycles SET payload=$3::jsonb,status=$4,revision=revision+1,updated_at=NOW() WHERE id=$1 AND client_id=$2 AND revision=$5 RETURNING revision', [lifecycleId,clientId,JSON.stringify(approved),approved.status,revision]);
    if (!saved.rows.length) throw Error('STALE_LIFECYCLE_UPDATE');
    await tx('INSERT INTO campaign_journal (client_id,lifecycle_id,event) VALUES ($1,$2,$3::jsonb)', [clientId,lifecycleId,JSON.stringify(approved.journal.at(-1))]);
    const jobKind = stage === 'CREATE_PAUSED' ? 'CREATE_PAUSED' : 'ACTIVATE';
    await tx('INSERT INTO workflow_jobs (client_id,lifecycle_id,kind) VALUES ($1,$2,$3) ON CONFLICT (lifecycle_id,kind) DO NOTHING', [clientId,lifecycleId,jobKind]);
    return { status: approved.status, lifecycleId, revision: saved.rows[0].revision };
  });
}
module.exports = { approveLifecycle };
