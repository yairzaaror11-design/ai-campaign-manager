'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { openDatabase } = require('./helpers/database');

test('worker refuses a cross-tenant job even when its lifecycle UUID is supplied directly', async () => {
  const h = await openDatabase();
  const previous = { MOCK_META_ENABLED: process.env.MOCK_META_ENABLED, READ_ONLY: process.env.READ_ONLY };
  process.env.MOCK_META_ENABLED = 'true';
  process.env.READ_ONLY = 'true';
  try {
    const { getOrCreateClient } = require('../clientStore');
    const a = await getOrCreateClient('972501002001');
    const b = await getOrCreateClient('972501002002');
    const lifecycleId = randomUUID();
    const payload = { id: lifecycleId, tenantId: b.id, status: 'DRAFT_APPROVED', journal: [] };
    await h.db.query('INSERT INTO campaign_lifecycles (id,client_id,payload,status) VALUES ($1,$2,$3::jsonb,$4)', [lifecycleId,b.id,JSON.stringify(payload),'DRAFT_APPROVED']);
    await h.db.query("INSERT INTO workflow_jobs (client_id,lifecycle_id,kind) VALUES ($1,$2,'CREATE_PAUSED')", [a.id,lifecycleId]);
    const result = await require('../workflowWorker').runOne(lifecycleId);
    assert.equal(result.status, 'IDLE');
    const jobs = await h.db.query('SELECT client_id,status,attempts FROM workflow_jobs WHERE lifecycle_id=$1',[lifecycleId]);
    assert.equal(jobs.rows.length,1);
    assert.equal(String(jobs.rows[0].client_id),String(a.id));
    assert.equal(jobs.rows[0].status,'PENDING');
    assert.equal(Number(jobs.rows[0].attempts),0);
    const lifecycle = await h.db.query('SELECT status FROM campaign_lifecycles WHERE id=$1 AND client_id=$2',[lifecycleId,b.id]);
    assert.equal(lifecycle.rows[0].status,'DRAFT_APPROVED');
  } finally {
    for (const [key,value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key]=value;
    }
    await h.close();
  }
});
