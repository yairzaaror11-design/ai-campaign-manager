'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { openDatabase } = require('./helpers/database');

test('manual-review jobs remain unclaimed even when due and explicitly targeted', async () => {
  const h = await openDatabase();
  const previous = { MOCK_META_ENABLED: process.env.MOCK_META_ENABLED, READ_ONLY: process.env.READ_ONLY };
  process.env.MOCK_META_ENABLED = 'true';
  process.env.READ_ONLY = 'true';
  try {
    const { getOrCreateClient } = require('../clientStore');
    const tenant = await getOrCreateClient('972501009903');
    const lifecycleId = randomUUID();
    const payload = { id: lifecycleId, tenantId: tenant.id, status: 'DRAFT_APPROVED', journal: [] };
    await h.db.query(
      'INSERT INTO campaign_lifecycles (id,client_id,payload,status) VALUES ($1,$2,$3::jsonb,$4)',
      [lifecycleId, tenant.id, JSON.stringify(payload), 'DRAFT_APPROVED']
    );
    await h.db.query(
      "INSERT INTO workflow_jobs (client_id,lifecycle_id,kind,status,available_at,locked_until) VALUES ($1,$2,'CREATE_PAUSED','MANUAL_REVIEW',NOW()-INTERVAL '1 minute',NOW()-INTERVAL '1 minute')",
      [tenant.id, lifecycleId]
    );
    const { runOne } = require('../workflowWorker');
    assert.equal((await runOne(lifecycleId)).status, 'IDLE');
    assert.equal((await runOne()).status, 'IDLE');
    const jobs = await h.db.query('SELECT status,attempts FROM workflow_jobs WHERE lifecycle_id=$1', [lifecycleId]);
    assert.equal(jobs.rows.length, 1);
    assert.equal(jobs.rows[0].status, 'MANUAL_REVIEW');
    assert.equal(Number(jobs.rows[0].attempts), 0);
    const lifecycle = await h.db.query('SELECT status FROM campaign_lifecycles WHERE id=$1 AND client_id=$2', [lifecycleId, tenant.id]);
    assert.equal(lifecycle.rows[0].status, 'DRAFT_APPROVED');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await h.close();
  }
});
