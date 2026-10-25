'use strict';
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { query, transaction } = require('./db');

function createDurableMockMetaAdapter(clientId, lifecycleId) {
  if (!clientId || !lifecycleId) throw Error('Mock scope required');
  const id = () => crypto.randomUUID();
  const fetch = async () => {
    const r = await query('SELECT objects,status FROM mock_meta_objects WHERE client_id=$1 AND lifecycle_id=$2', [clientId,lifecycleId]);
    return r.rows[0] || null;
  };
  return {
    async createPaused(plan) {
      if (String(plan.brief?.tenantId) !== String(clientId)) throw Error('Tenant mismatch');
      return transaction(async tx => {
        const prior = await tx('SELECT objects FROM mock_meta_objects WHERE client_id=$1 AND lifecycle_id=$2', [clientId,lifecycleId]);
        if (prior.rows.length) return prior.rows[0].objects;
        const objects = { campaignId: id(), adSetIds: [id()], creativeIds: plan.creatives.map(id), adIds: plan.creatives.map(id) };
        const r = await tx('INSERT INTO mock_meta_objects (client_id,lifecycle_id,objects,status) VALUES ($1,$2,$3::jsonb,$4) ON CONFLICT (lifecycle_id) DO NOTHING RETURNING objects', [clientId,lifecycleId,JSON.stringify(objects),'PAUSED']);
        if (r.rows.length) return r.rows[0].objects;
        const existing = await tx('SELECT objects FROM mock_meta_objects WHERE client_id=$1 AND lifecycle_id=$2', [clientId,lifecycleId]);
        if (!existing.rows.length) throw Error('Mock scope conflict');
        return existing.rows[0].objects;
      });
    },
    async verifyPaused(objects) {
      const row = await fetch();
      return !!row && row.status === 'PAUSED' && isDeepStrictEqual(row.objects, objects);
    },
    async activate(objects) {
      const r = await query("UPDATE mock_meta_objects SET status='ACTIVE',updated_at=NOW() WHERE client_id=$1 AND lifecycle_id=$2 AND objects=$3::jsonb AND status IN ('PAUSED','ACTIVE') RETURNING status", [clientId,lifecycleId,JSON.stringify(objects)]);
      if (!r.rows.length) throw Error('Mock state conflict');
    },
    async verifyActive(objects) {
      const row = await fetch();
      return !!row && row.status === 'ACTIVE' && isDeepStrictEqual(row.objects, objects);
    },
    async inspect() { return fetch(); }
  };
}
module.exports = { createDurableMockMetaAdapter };
