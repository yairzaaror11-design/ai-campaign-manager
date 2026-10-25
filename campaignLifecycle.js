'use strict';
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function createLifecycle({ tenantId, brief, strategy, creatives }) {
  if (!tenantId || tenantId !== brief?.tenantId || strategy?.tenantId !== tenantId) throw Error('Tenant mismatch');
  if (brief.status !== 'APPROVED' || strategy.briefId !== brief.id) throw Error('Approved brief required');
  if (!Array.isArray(creatives) || !creatives.length || creatives.some(c => !c.copy || !c.headline || !c.assetId)) throw Error('Complete creative assets required');
  return { id: crypto.randomUUID(), tenantId, status: 'AWAITING_DRAFT_APPROVAL', plan: { brief, strategy, creatives }, planHash: hash({ brief, strategy, creatives }), approvals: [], objects: null, journal: [] };
}

function approveStage(flow, stage, actorId, expectedHash) {
  if (!actorId || expectedHash !== flow.planHash) throw Error('Missing actor or stale plan');
  const required = stage === 'CREATE_PAUSED' ? 'AWAITING_DRAFT_APPROVAL' : stage === 'ACTIVATE' ? 'AWAITING_ACTIVATION_APPROVAL' : null;
  if (!required || flow.status !== required) throw Error('Invalid approval stage');
  const approval = { stage, actorId, planHash: flow.planHash, at: new Date().toISOString(), expiresAt: new Date(Date.now() + Math.max(1, Math.min(60, Number(process.env.APPROVAL_TTL_MINUTES || 10))) * 60000).toISOString(), id: crypto.randomUUID() };
  return { ...flow, status: stage === 'CREATE_PAUSED' ? 'DRAFT_APPROVED' : 'ACTIVATION_APPROVED', approvals: [...flow.approvals, approval], journal: [...flow.journal, { type: 'APPROVAL', ...approval }] };
}

async function createPaused(flow, adapter) {
  if (flow.status !== 'DRAFT_APPROVED') throw Error('Draft approval required');
  const approval = flow.approvals.findLast(a => a.stage === 'CREATE_PAUSED');
  if (!approval || Date.now() > Date.parse(approval.expiresAt)) throw Error('Draft approval expired');
  if (!adapter || typeof adapter.createPaused !== 'function' || typeof adapter.verifyPaused !== 'function') throw Error('Explicit adapter required');
  let objects;
  try {
    objects = await adapter.createPaused(flow.plan);
    const verified = await adapter.verifyPaused(objects);
    if (!verified || !objects?.campaignId || !Array.isArray(objects.adSetIds) || !objects.adSetIds.length || !Array.isArray(objects.adIds) || !objects.adIds.length) throw Error('Draft verification failed');
  } catch (error) {
    return { ...flow, status: 'NEEDS_RECONCILIATION', journal: [...flow.journal, { type: 'DRAFT_RESULT_UNKNOWN', reason: error.message }] };
  }
  return { ...flow, objects, status: 'AWAITING_ACTIVATION_APPROVAL', journal: [...flow.journal, { type: 'DRAFT_VERIFIED', objects }] };
}

async function activate(flow, adapter) {
  if (flow.status !== 'ACTIVATION_APPROVED' || !flow.approvals.some(a => a.stage === 'CREATE_PAUSED') || !flow.approvals.some(a => a.stage === 'ACTIVATE')) throw Error('Separate activation approval required');
  if (!adapter || typeof adapter.verifyPaused !== 'function' || typeof adapter.activate !== 'function' || typeof adapter.verifyActive !== 'function') throw Error('Explicit adapter required');
  const approval = flow.approvals.findLast(a => a.stage === 'ACTIVATE');
  if (!approval || Date.now() > Date.parse(approval.expiresAt)) throw Error('Activation approval expired');
  try {
    if (!(await adapter.verifyPaused(flow.objects))) throw Error('Current Meta state changed');
    await adapter.activate(flow.objects);
    if (!(await adapter.verifyActive(flow.objects))) throw Error('Activation not verified');
    return { ...flow, status: 'ACTIVE_VERIFIED', journal: [...flow.journal, { type: 'ACTIVATION_VERIFIED', at: new Date().toISOString() }] };
  } catch (error) {
    return { ...flow, status: 'NEEDS_RECONCILIATION', journal: [...flow.journal, { type: 'ACTIVATION_RESULT_UNKNOWN', reason: error.message }] };
  }
}

module.exports = { createLifecycle, approveStage, createPaused, activate };
