'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('./helpers/isolatedDatabase');
const ledger = require('../usageLedger');

test('token cost separates cached input and counts thinking as output', () => {
  const usage = ledger.fromGemini({ promptTokenCount: 10000, candidatesTokenCount: 500, thoughtsTokenCount: 500, cachedContentTokenCount: 4000 });
  assert.deepEqual(usage, { inputTokens: 10000, outputTokens: 1000, cachedTokens: 4000 });
  // 6000 uncached * 1.5 + 4000 cached * 0.15 + 1000 out * 9, per million
  assert.equal(ledger.cost({ model: 'gemini-3.5-flash', ...usage }).toFixed(4), (0.009 + 0.0006 + 0.009).toFixed(4));
});

test('Claude usage adds cache reads and cache writes to input', () => {
  const usage = ledger.fromClaude({ input_tokens: 1000, cache_read_input_tokens: 9000, cache_creation_input_tokens: 500, output_tokens: 800 });
  assert.deepEqual(usage, { inputTokens: 10500, outputTokens: 800, cachedTokens: 9000 });
  assert.ok(ledger.cost({ model: 'claude-sonnet-5-5', ...usage }) > 0);
});

test('unknown models cost zero and price overrides apply', () => {
  assert.equal(ledger.cost({ model: 'unknown-model', inputTokens: 1e6 }), 0);
  const before = process.env.USAGE_PRICES_JSON;
  process.env.USAGE_PRICES_JSON = JSON.stringify({ 'unknown-model': { input: 2, output: 0 } });
  try { assert.equal(ledger.cost({ model: 'unknown-model', inputTokens: 1e6 }), 2); }
  finally { if (before === undefined) delete process.env.USAGE_PRICES_JSON; else process.env.USAGE_PRICES_JSON = before; }
});

test('usage is stored per tenant from the request context and summarized per client', async () => {
  const { db, close } = await openDatabase();
  try {
    const a = (await db.query("INSERT INTO clients(phone) VALUES('972500000071') RETURNING id")).rows[0].id;
    const b = (await db.query("INSERT INTO clients(phone) VALUES('972500000072') RETURNING id")).rows[0].id;
    const tenant = require('../metaConnection').context;
    await tenant.run(String(a), () => ledger.record({ provider: 'gemini', model: 'gemini-3.5-flash', kind: 'text', inputTokens: 1e6, outputTokens: 0 }));
    await tenant.run(String(a), () => ledger.record({ provider: 'gemini', model: 'gemini-nano-banana-2.1', kind: 'image', units: 2 }));
    await tenant.run(String(b), () => ledger.record({ provider: 'gemini', model: 'veo-3.1-fast-generate-001', kind: 'video', units: 8 }));
    await ledger.record({ provider: 'gemini', model: 'gemini-3.5-flash', kind: 'analysis', inputTokens: 100 });
    assert.equal(await ledger.record({ provider: 'gemini', model: 'x', kind: 'not-a-kind' }), null);

    const all = await ledger.summary({ since: '2000-01-01', until: '2100-01-01' });
    const byId = Object.fromEntries(all.clients.map(c => [c.clientId, c]));
    assert.equal(byId[String(a)].costUsd.toFixed(2), '1.58');
    assert.equal(byId[String(a)].byKind.image.units, 2);
    assert.equal(byId[String(b)].costUsd.toFixed(2), '0.96');
    assert.ok(byId.system, 'calls without a tenant are kept as system usage');

    const one = await ledger.summary({ clientId: b, since: '2000-01-01', until: '2100-01-01' });
    assert.equal(one.clients.length, 1);
  } finally { await close(); }
});

test('a failing database never breaks the conversation', async () => {
  const { db, close } = await openDatabase();
  const original = db.query;
  try {
    db.query = async () => { throw Error('DB_DOWN'); };
    assert.equal(await ledger.record({ provider: 'gemini', model: 'gemini-3.5-flash', kind: 'text', inputTokens: 5 }), null);
  } finally { db.query = original; await close(); }
});
