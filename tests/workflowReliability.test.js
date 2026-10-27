const test = require('node:test');
const assert = require('node:assert/strict');
const { createLifecycle, approveStage, createPaused, activate } = require('../campaignLifecycle');

const fixture = () => ({ tenantId: 't1', brief: { id: 'b1', tenantId: 't1', status: 'APPROVED' }, strategy: { tenantId: 't1', briefId: 'b1' }, creatives: [{ headline: 'Title', copy: 'Copy', assetId: 'mock-asset' }] });
const objects = { campaignId: 'campaign-1', adSetIds: ['set-1'], creativeIds: ['creative-1'], adIds: ['ad-1'] };

test('retries with an idempotent adapter never duplicate mock campaign objects', async () => {
  const records = new Map();
  const adapter = {
    createPaused: async plan => { if (!records.has(plan.brief.id)) records.set(plan.brief.id, objects); return records.get(plan.brief.id); },
    verifyPaused: async value => value === objects,
    activate: async () => { records.set('active', true); },
    verifyActive: async () => records.get('active') === true
  };
  let flow = createLifecycle(fixture());
  flow = approveStage(flow, 'CREATE_PAUSED', 'owner', flow.planHash);
  const a = await createPaused(flow, adapter);
  const b = await createPaused(flow, adapter);
  assert.deepEqual(a.objects, b.objects);
  assert.equal(records.size, 1);
  flow = approveStage(a, 'ACTIVATE', 'owner', a.planHash);
  const result = await activate(flow, adapter);
  assert.equal(result.status, 'ACTIVE_VERIFIED');
});

test('plan hash cannot be replayed to approve a different stage', () => {
  const flow = createLifecycle(fixture());
  assert.throws(() => approveStage(flow, 'ACTIVATE', 'owner', flow.planHash), /Invalid approval stage/);
  const draft = approveStage(flow, 'CREATE_PAUSED', 'owner', flow.planHash);
  assert.throws(() => approveStage(draft, 'CREATE_PAUSED', 'owner', draft.planHash), /Invalid approval stage/);
});
