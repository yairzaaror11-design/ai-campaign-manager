'use strict';
// Versioned decision contract for the future agent. No provider calls or side effects.
const crypto = require('node:crypto');
const LEVELS = Object.freeze({ READ: 'READ', DRAFT: 'DRAFT', APPROVAL: 'APPROVAL', BLOCKED: 'BLOCKED' });
const OPERATIONS = Object.freeze({
  'crm.leads.read': LEVELS.READ,
  'crm.leads.draft': LEVELS.DRAFT,
  'campaign.report.read': LEVELS.READ,
  'campaign.draft.create': LEVELS.DRAFT,
  'creative.draft.create': LEVELS.DRAFT,
  'campaign.publish': LEVELS.APPROVAL,
  'campaign.budget.change': LEVELS.APPROVAL,
  'campaign.pause': LEVELS.APPROVAL,
  'campaign.resume': LEVELS.APPROVAL,
  'crm.leads.delete': LEVELS.APPROVAL,
  'billing.charge': LEVELS.BLOCKED,
  'tenant.cross_access': LEVELS.BLOCKED
});
function planAction({ tenantId, operation, actorId, inputs = {} } = {}) {
  if (typeof tenantId !== 'string' || !tenantId.trim() || typeof actorId !== 'string' || !actorId.trim()) throw Error('IDENTITY_REQUIRED');
  if (typeof operation !== 'string' || !Object.hasOwn(OPERATIONS, operation)) throw Error('UNREGISTERED_OPERATION');
  if (inputs === null || Array.isArray(inputs) || typeof inputs !== 'object') throw Error('INVALID_INPUTS');
  if (Object.hasOwn(inputs, 'tenantId') && inputs.tenantId !== tenantId) throw Error('TENANT_MISMATCH');
  const policy = OPERATIONS[operation];
  return Object.freeze({
    id: crypto.randomUUID(), schemaVersion: 1, tenantId, actorId, operation,
    policy, requiresApproval: policy === LEVELS.APPROVAL,
    executable: false, // Planner must never directly execute even READ operations.
    inputs: structuredClone(inputs)
  });
}
module.exports = { LEVELS, OPERATIONS, planAction };
