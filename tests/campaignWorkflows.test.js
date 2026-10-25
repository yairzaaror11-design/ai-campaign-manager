const test = require('node:test');
const assert = require('node:assert/strict');
const { WORKFLOWS, newBrief, updateBrief, nextQuestion, reviewBrief, approveBrief, cancelBrief, draftStrategy } = require('../campaignWorkflows');
const base = { tenantId: 'tenant-1', adAccountId: 'act_123' };

test('all nine campaign types have separate declared requirements', () => {
  assert.equal(Object.keys(WORKFLOWS).length, 9);
  for (const type of Object.keys(WORKFLOWS)) {
    const brief = newBrief({ ...base, type, dailyBudget: 100 });
    assert.ok(nextQuestion(brief));
    assert.ok(WORKFLOWS[type].objective);
  }
});

test('brief is collected, reviewed and revision-bound approved', () => {
  let b = newBrief({ ...base, type: 'TRAFFIC', dailyBudget: 100 });
  b = updateBrief(b, { businessName: 'Example', product: 'Consulting', audience: 'Adults', geography: 'Israel', websiteUrl: 'https://example.org' });
  b = reviewBrief(b);
  assert.throws(() => approveBrief(b, b.revision - 1), /Stale/);
  const approved = approveBrief(b, b.revision);
  assert.equal(draftStrategy(approved).objective, 'OUTCOME_TRAFFIC');
  assert.throws(() => updateBrief(approved, { product: 'Changed' }), /immutable/);
});

test('cancelled briefs cannot be approved', () => {
  const b = cancelBrief(newBrief({ ...base, type: 'AWARENESS' }));
  assert.throws(() => approveBrief(b, b.revision), /Stale/);
});

test('invalid budgets and account identifiers are rejected', () => {
  assert.throws(() => newBrief({ ...base, adAccountId: '123', type: 'TRAFFIC' }), /Invalid/);
  assert.throws(() => newBrief({ ...base, type: 'TRAFFIC', dailyBudget: -5 }), /Invalid budget/);
});

test('Meta account regex accepts digit-only act_ IDs and rejects malformed identifiers', () => {
  for (const id of ['act_1', 'act_123456789012345']) {
    assert.equal(newBrief({ ...base, adAccountId: id, type: 'TRAFFIC' }).adAccountId, id);
  }
  for (const id of ['act_abc', 'act_123x', '123', 'act_', 'act_123\\n']) {
    assert.throws(() => newBrief({ ...base, adAccountId: id, type: 'TRAFFIC' }), /Invalid/);
  }
});
