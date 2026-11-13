const test = require('node:test');
const assert = require('node:assert/strict');
const { createLifecycle, approveStage, createPaused, activate } = require('../campaignLifecycle');
const plan = { tenantId: 't1', brief: { tenantId: 't1', id: 'b1', status: 'APPROVED' }, strategy: { tenantId: 't1', briefId: 'b1' }, creatives: [{ copy: 'Body', headline: 'Headline', assetId: 'asset1' }] };
const objects = { campaignId: '1', adSetIds: ['2'], adIds: ['3'] };
const mock = { createPaused: async () => objects, verifyPaused: async () => true, activate: async () => true, verifyActive: async () => true };

test('draft and activation require distinct approvals', async () => {
  let flow = createLifecycle(plan);
  await assert.rejects(createPaused(flow, mock), /Draft approval/);
  flow = approveStage(flow, 'CREATE_PAUSED', 'owner', flow.planHash);
  flow = await createPaused(flow, mock);
  assert.equal(flow.status, 'AWAITING_ACTIVATION_APPROVAL');
  await assert.rejects(activate(flow, mock), /Separate activation approval/);
  flow = approveStage(flow, 'ACTIVATE', 'owner', flow.planHash);
  flow = await activate(flow, mock);
  assert.equal(flow.status, 'ACTIVE_VERIFIED');
  assert.equal(flow.approvals.length, 2);
});

test('stale plan cannot be approved', () => {
  const flow = createLifecycle(plan);
  assert.throws(() => approveStage(flow, 'CREATE_PAUSED', 'owner', 'stale'), /stale/);
});

test('failed or uncertain verification stops lifecycle', async () => {
  let flow = createLifecycle(plan);
  flow = approveStage(flow, 'CREATE_PAUSED', 'owner', flow.planHash);
  flow = await createPaused(flow, { ...mock, verifyPaused: async () => false });
  assert.equal(flow.status, 'NEEDS_RECONCILIATION');
});

test('tenant mismatch blocks workflow', () => {
  assert.throws(() => createLifecycle({ ...plan, tenantId: 't2' }), /Tenant mismatch/);
});


test('integrated mock adapter creates paused objects and verifies activation', async () => {
  const { createMockMetaAdapter } = require('../mockMetaAdapter');
  const adapter = createMockMetaAdapter();
  let flow = createLifecycle(plan);
  flow = approveStage(flow, 'CREATE_PAUSED', 'tenant-owner', flow.planHash);
  flow = await createPaused(flow, adapter);
  assert.equal(flow.status, 'AWAITING_ACTIVATION_APPROVAL');
  assert.equal(flow.objects.creativeIds.length, 1);
  assert.equal(await adapter.verifyPaused(flow.objects), true);
  flow = approveStage(flow, 'ACTIVATE', 'tenant-owner', flow.planHash);
  flow = await activate(flow, adapter);
  assert.equal(flow.status, 'ACTIVE_VERIFIED');
  assert.equal(await adapter.verifyActive(flow.objects), true);
});

test('mutating plan after approval is blocked before mock writes', async () => {
  let flow = createLifecycle(plan);
  flow = approveStage(flow, 'CREATE_PAUSED', 'owner', flow.planHash);
  const altered = { ...flow, plan: { ...flow.plan, creatives: [{ ...flow.plan.creatives[0], copy: 'Changed after approval' }] } };
  await assert.rejects(createPaused(altered, mock), /Plan changed after approval/);
  assert.throws(() => approveStage({ ...flow, status: 'AWAITING_ACTIVATION_APPROVAL', plan: altered.plan }, 'ACTIVATE', 'owner', flow.planHash), /stale plan/);
});
