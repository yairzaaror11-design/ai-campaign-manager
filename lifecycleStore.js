'use strict';
const { query, configured } = require('./db');
async function latest(clientId) {
  if (!configured()) throw Error('DATABASE_REQUIRED');
  const r = await query('SELECT payload, revision FROM campaign_lifecycles WHERE client_id=$1 ORDER BY updated_at DESC LIMIT 1', [clientId]);
  return r.rows[0] || null;
}
async function save(clientId, flow, previousRevision = null) {
  if (!configured()) throw Error('DATABASE_REQUIRED');
  let r;
  if (previousRevision === null) {
    r = await query('INSERT INTO campaign_lifecycles (id,client_id,payload,status) VALUES ($1,$2,$3::jsonb,$4) ON CONFLICT DO NOTHING RETURNING revision', [flow.id,clientId,JSON.stringify(flow),flow.status]);
  } else {
    r = await query('UPDATE campaign_lifecycles SET payload=$3::jsonb,status=$4,revision=revision+1,updated_at=NOW() WHERE id=$1 AND client_id=$2 AND revision=$5 RETURNING revision', [flow.id,clientId,JSON.stringify(flow),flow.status,previousRevision]);
  }
  if (!r.rows.length) throw Error('STALE_LIFECYCLE_UPDATE');
  for (const event of flow.journal || []) {
    await query('INSERT INTO campaign_journal (client_id,lifecycle_id,event) VALUES ($1,$2,$3::jsonb)', [clientId,flow.id,JSON.stringify(event)]);
  }
  return r.rows[0].revision;
}
module.exports = { latest, save };
