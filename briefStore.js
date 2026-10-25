'use strict';
const { query, configured } = require('./db');

async function loadBrief(clientId) {
  if (!configured()) throw Error('DATABASE_REQUIRED_FOR_BRIEFS');
  const result = await query('SELECT payload FROM campaign_briefs WHERE client_id = $1 AND status IN ($2,$3) ORDER BY updated_at DESC LIMIT 1', [clientId, 'COLLECTING', 'REVIEW']);
  return result.rows[0]?.payload || null;
}

async function saveBrief(clientId, brief) {
  if (!configured()) throw Error('DATABASE_REQUIRED_FOR_BRIEFS');
  const result = await query(`INSERT INTO campaign_briefs (id, client_id, payload, status, revision, updated_at)
    VALUES ($1,$2,$3::jsonb,$4,$5,NOW())
    ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload,status=EXCLUDED.status,revision=EXCLUDED.revision,updated_at=NOW()
    WHERE campaign_briefs.client_id=EXCLUDED.client_id AND campaign_briefs.revision <= EXCLUDED.revision
    RETURNING id`, [brief.id, clientId, JSON.stringify(brief), brief.status, brief.revision]);
  if (!result.rows.length) throw Error('STALE_BRIEF_UPDATE');
  return brief;
}

module.exports = { loadBrief, saveBrief };
