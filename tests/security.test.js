const test = require('node:test');
const assert = require('node:assert/strict');
const { validateActionPlan } = require('../actionValidator');
const { isAuthorized } = require('../auth');

function plan(intent, parameters = {}) {
  return { id: 'test-1', intent, target: { accountId: 'act_123', campaignId: '456' }, parameters, missing: [] };
}

test('budget writes fail closed without minor-unit conversion', () => {
  const result = validateActionPlan(plan('CHANGE_BUDGET', { dailyBudget: 100 }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /minor units/);
});

test('valid explicitly converted budget passes structural validation', () => {
  const result = validateActionPlan(plan('CHANGE_BUDGET', { dailyBudget: 100, dailyBudgetMinor: 10000, currency: 'ILS' }));
  assert.equal(result.ok, true);
});

test('unknown intent is rejected', () => {
  assert.equal(validateActionPlan(plan('DELETE_ALL_CAMPAIGNS')).ok, false);
});

test('authorization is denied without an allowlist', () => {
  const before = process.env.AUTHORIZED_PHONE_NUMBERS;
  delete process.env.AUTHORIZED_PHONE_NUMBERS;
  try { assert.equal(isAuthorized('972501234567'), false); }
  finally { if (before === undefined) delete process.env.AUTHORIZED_PHONE_NUMBERS; else process.env.AUTHORIZED_PHONE_NUMBERS = before; }
});
