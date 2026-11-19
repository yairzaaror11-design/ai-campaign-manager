'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ai = require('../aiService');

const env = (vars, work) => async () => {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { await work(); } finally { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

test('a failing primary provider is answered once by the configured fallback', env({ AI_PROVIDER: 'fb_primary', AI_FALLBACK_PROVIDER: 'fb_backup' }, async () => {
  let primary = 0, backup = 0;
  ai.registerProvider('fb_primary', async () => { primary++; throw Error('AI_REQUEST_FAILED'); });
  ai.registerProvider('fb_backup', async () => { backup++; return { text: 'תשובה מהגיבוי', actionPlans: [] }; });
  assert.equal((await ai.processMessage('שלום')).text, 'תשובה מהגיבוי');
  assert.deepEqual([primary, backup], [1, 1]);
}));

test('request errors and explicit providers never fall back', env({ AI_PROVIDER: 'fb_primary', AI_FALLBACK_PROVIDER: 'fb_backup' }, async () => {
  let backup = 0;
  ai.registerProvider('fb_primary', async () => { throw Error('PLANNING_TOOL_CALL_REJECTED'); });
  ai.registerProvider('fb_backup', async () => { backup++; return { text: 'x', actionPlans: [] }; });
  await assert.rejects(ai.processMessage('שלום'), /PLANNING_TOOL_CALL_REJECTED/);
  ai.registerProvider('fb_primary', async () => { throw Error('AI_REQUEST_FAILED'); });
  await assert.rejects(ai.processMessage('שלום', [], { provider: 'fb_primary' }), /AI_REQUEST_FAILED/);
  assert.equal(backup, 0);
}));

test('the fallback output passes the same validation as the primary', env({ AI_PROVIDER: 'fb_primary', AI_FALLBACK_PROVIDER: 'fb_backup' }, async () => {
  ai.registerProvider('fb_primary', async () => { throw Error('timeout'); });
  ai.registerProvider('fb_backup', async () => ({ text: 'x', actionPlans: [{ intent: 'DELETE_EVERYTHING', requiresApproval: true, id: 'x' }] }));
  await assert.rejects(ai.processMessage('שלום'), /INVALID_AI_PLAN/);
}));

test('Claude is only a fallback when it is fully configured', env({ AI_FALLBACK_PROVIDER: 'claude', ANTHROPIC_API_KEY: undefined, CLAUDE_MODEL: 'claude-haiku-5-5' }, async () => {
  assert.equal(ai.fallbackFor('gemini', {}), null);
  process.env.ANTHROPIC_API_KEY = 'test-key';
  assert.equal(ai.fallbackFor('gemini', {}), 'claude');
  assert.equal(ai.fallbackFor('claude', {}), null, 'a provider is never its own fallback');
}));
