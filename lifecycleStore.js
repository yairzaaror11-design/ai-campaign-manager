'use strict';
const { query, transaction, configured } = require('./db');
async function latest(clientId) {
  if (!configured()) throw Error('DATABASE_REQUIRED');
  const r = await query('SELECT payload, revision FROM campaign_lifecycles WHERE client_id=$1 ORDER BY updated_at DESC LIMIT 1', [clientId]);
  return r.rows[0] || null;
}
async function save(clientId, flow, previousRevision = null) {
  if (!configured()) throw Error('DATABASE_REQUIRED');
  return transaction(async tx => {
    const r = previousRevision === null
      ? await tx('INSERT INTO campaign_lifecycles (id,client_id,payload,status) VALUES ($1,$2,$3::jsonb,$4) ON CONFLICT DO NOTHING RETURNING revision', [flow.id,clientId,JSON.stringify(flow),flow.status])
      : await tx('UPDATE campaign_lifecycles SET payload=$3::jsonb,status=$4,revision=revision+1,updated_at=NOW() WHERE id=$1 AND client_id=$2 AND revision=$5 RETURNING revision', [flow.id,clientId,JSON.stringify(flow),flow.status,previousRevision]);
    if (!r.rows.length) throw Error('STALE_LIFECYCLE_UPDATE');
    const events = previousRevision === null ? (flow.journal || []) : (flow.journal || []).slice(-1);
    for (const event of events) {
      await tx('INSERT INTO campaign_journal (client_id,lifecycle_id,event) VALUES ($1,$2,$3::jsonb)', [clientId,flow.id,JSON.stringify(event)]);
    }
    if (flow.status === 'DRAFT_APPROVED' || flow.status === 'ACTIVATION_APPROVED') {
      const kind = flow.status === 'DRAFT_APPROVED' ? 'CREATE_PAUSED' : 'ACTIVATE';
      await tx('INSERT INTO workflow_jobs (client_id,lifecycle_id,kind) VALUES ($1,$2,$3) ON CONFLICT (lifecycle_id,kind) DO NOTHING', [clientId,flow.id,kind]);
    }
    return r.rows[0].revision;
  });
}
module.exports = { latest, save };
