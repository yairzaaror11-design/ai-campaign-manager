'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { initializeDatabase, transaction, query, closeDatabase } = require('../db');
const { createLifecycle } = require('../campaignLifecycle');
const { save } = require('../lifecycleStore');
const { approveLifecycle } = require('../lifecycleApprovalService');
const { runOne } = require('../workflowWorker');
const { createDurableMockMetaAdapter } = require('../durableMockMetaAdapter');

const enabled = !!process.env.TEST_DATABASE_URL;
test('PostgreSQL transaction, optimistic locking, stage approval, durable mock and worker restart', { skip: !enabled }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DB_SSL = 'false';
  process.env.READ_ONLY = 'true';
  process.env.MOCK_META_ENABLED = 'true';
  await initializeDatabase();
  const phone = '+1999' + String(Date.now()).slice(-9);
  const inserted = await query("INSERT INTO clients(phone,meta_ad_account_id) VALUES ($1,'act_12345') RETURNING id", [phone]);
  const clientId = inserted.rows[0].id;
  try {
    await assert.rejects(transaction(async tx => { await tx('UPDATE clients SET display_name=$2 WHERE id=$1',[clientId,'rolled back']); throw Error('forced rollback'); }), /forced rollback/);
    const unchanged = await query('SELECT display_name FROM clients WHERE id=$1',[clientId]);
    assert.equal(unchanged.rows[0].display_name,null);
    const tenantId = String(clientId);
    const brief = { id:'brief-1',tenantId,adAccountId:'act_12345',status:'APPROVED' };
    const flow = createLifecycle({ tenantId,brief,strategy:{briefId:brief.id,tenantId},creatives:[{headline:'Headline',copy:'Body',assetId:'mock-asset'}] });
    const initialRevision = await save(clientId,flow);
    assert.equal(initialRevision,1);
    const concurrent = await Promise.allSettled([save(clientId,{...flow,status:'ONE'},1),save(clientId,{...flow,status:'TWO'},1)]);
    assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(concurrent.filter(x=>x.status==='rejected' && x.reason.message==='STALE_LIFECYCLE_UPDATE').length,1);
    // Restore state before approval.
    const reset = await query('SELECT revision FROM campaign_lifecycles WHERE id=$1',[flow.id]);
    await save(clientId,flow,reset.rows[0].revision);
    await assert.rejects(approveLifecycle({clientId,actorId:'unauthorized',adAccountId:'act_12345',lifecycleId:flow.id,stage:'CREATE_PAUSED',planHash:flow.planHash}), /Unauthorized actor/);
    await assert.rejects(approveLifecycle({clientId,actorId:tenantId,adAccountId:'act_99999',lifecycleId:flow.id,stage:'CREATE_PAUSED',planHash:flow.planHash}), /Approval scope mismatch/);
    const approved = await Promise.allSettled([approveLifecycle({clientId,actorId:tenantId,adAccountId:'act_12345',lifecycleId:flow.id,stage:'CREATE_PAUSED',planHash:flow.planHash}),approveLifecycle({clientId,actorId:tenantId,adAccountId:'act_12345',lifecycleId:flow.id,stage:'CREATE_PAUSED',planHash:flow.planHash})]);
    assert.equal(approved.filter(x=>x.status==='fulfilled').length,1, JSON.stringify(approved.map(x=>x.status==='rejected'?x.reason.message:x.value)));
    const draft = await runOne(flow.id);
    assert.equal(draft.status,'AWAITING_ACTIVATION_APPROVAL');
    const adapter = createDurableMockMetaAdapter(clientId,flow.id);
    const savedObjects = await adapter.inspect();
    assert.equal(savedObjects.status,'PAUSED');
    const secondAdapter = createDurableMockMetaAdapter(clientId,flow.id);
    assert.deepEqual((await secondAdapter.inspect()).objects,savedObjects.objects);
    const pending = await query('SELECT payload FROM campaign_lifecycles WHERE id=$1',[flow.id]);
    await approveLifecycle({clientId,actorId:tenantId,adAccountId:'act_12345',lifecycleId:flow.id,stage:'ACTIVATE',planHash:pending.rows[0].payload.planHash});
    const activation = await runOne(flow.id);
    assert.equal(activation.status,'ACTIVE_VERIFIED');
    assert.equal((await secondAdapter.inspect()).status,'ACTIVE');
    assert.equal((await runOne(flow.id)).status,'IDLE');
    const jobs = await query('SELECT kind,status FROM workflow_jobs WHERE lifecycle_id=$1',[flow.id]);
    assert.equal(jobs.rows.length,2);
    assert.ok(jobs.rows.every(row=>row.status==='DONE'));
    const journal = await query('SELECT event FROM campaign_journal WHERE lifecycle_id=$1',[flow.id]);
    assert.ok(journal.rows.length >= 4);
  } finally {
    try {
      await query('DELETE FROM campaign_journal WHERE client_id=$1',[clientId]);
      await query('DELETE FROM clients WHERE id=$1',[clientId]);
    } finally { await closeDatabase(); }
  }
});
