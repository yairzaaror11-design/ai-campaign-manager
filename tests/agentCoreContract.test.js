'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planAction, LEVELS, OPERATIONS } = require('../agentCore/actionContract');
test('new agent contract plans without executing any provider or mutation', () => {
  const plan = planAction({tenantId:'tenant-A',actorId:'user-A',operation:'campaign.draft.create',inputs:{objective:'leads'}});
  assert.equal(plan.tenantId,'tenant-A');
  assert.equal(plan.policy,LEVELS.DRAFT);
  assert.equal(plan.executable,false);
  assert.equal(plan.requiresApproval,false);
  assert.equal(plan.schemaVersion,1);
});
test('all money and publishing changes require approval or are blocked', () => {
  for (const operation of ['campaign.publish','campaign.budget.change','campaign.pause','campaign.resume','crm.leads.delete']) {
    const p=planAction({tenantId:'A',actorId:'U',operation});
    assert.equal(p.requiresApproval,true,operation);
    assert.equal(p.executable,false);
  }
  assert.equal(OPERATIONS['billing.charge'],LEVELS.BLOCKED);
});
test('tenant ID spoofing and missing identity are rejected', () => {
  assert.throws(()=>planAction({tenantId:'A',actorId:'U',operation:'crm.leads.read',inputs:{tenantId:'B'}}),/TENANT_MISMATCH/);
  assert.throws(()=>planAction({tenantId:'',actorId:'U',operation:'crm.leads.read'}),/IDENTITY_REQUIRED/);
  assert.throws(()=>planAction({tenantId:'A',actorId:'',operation:'crm.leads.read'}),/IDENTITY_REQUIRED/);
});
test('unregistered operations are denied by default', () => {
  assert.throws(()=>planAction({tenantId:'A',actorId:'U',operation:'meta.execute.anything'}),/UNREGISTERED_OPERATION/);
});
test('input values are detached from caller to prevent post-plan mutation', () => {
  const inputs={campaign:{name:'original'}};
  const p=planAction({tenantId:'A',actorId:'U',operation:'campaign.draft.create',inputs});
  inputs.campaign.name='tampered';
  assert.equal(p.inputs.campaign.name,'original');
});
