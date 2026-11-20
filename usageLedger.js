'use strict';
// Records what each AI call costs, per client, so pricing can be checked
// against real spend. Recording never breaks a conversation: failures are logged.
const { logger } = require('./logger');

// USD list prices. Token prices are per 1M tokens; image is per image; video per second.
// Override any entry with USAGE_PRICES_JSON, e.g. {"gemini-3.5-flash":{"input":1.5,"output":9}}.
const DEFAULT_PRICES = {
  'gemini-3.5-flash': { input: 1.5, output: 9, cached: 0.15 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5, cached: 0.03 },
  'gemini-3.5-transcribe': { input: 1.5, output: 9, cached: 0.15 },
  'claude-opus-5-5': { input: 4, output: 20, cached: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cached: 0.1 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cached: 0.01 },
  'gemini-nano-banana-2.1': { perImage: 0.04 },
  // GPT Image is billed by tokens: text input $5, image output $30 per 1M.
  'gpt-image-2.6-sunburst': { input: 5, output: 30 },
  'gpt-image-2.6-flare': { input: 5, output: 30 },
  'gpt-image-2.5-sunburst': { input: 5, output: 30 },
  'veo-3.1-fast-generate-001': { perSecond: 0.12 },
  'veo-3.1-lite-generate-001': { perSecond: 0.08 },
  'veo-3.1-generate-001': { perSecond: 0.4 },
  'kling-video/v3.0/std/text-to-video': { perSecond: 0.126 },
  'kling-video/v3.0/std/image-to-video': { perSecond: 0.126 }
};
const KINDS = new Set(['text', 'analysis', 'image', 'video', 'transcription', 'system']);
const { AsyncLocalStorage } = require('node:async_hooks');
// Who an AI call is for, when the Meta tenant context is not set (background
// jobs, model checks). {clientId} bills a customer; {purpose} marks system work.
const scope = new AsyncLocalStorage();
const PURPOSE = /^[a-z][a-z0-9_]{1,59}$/;
function forClient(clientId, work) { return scope.run({ clientId: String(clientId) }, work); }
function system(purpose, work) {
  if (!PURPOSE.test(String(purpose))) throw Error('INVALID_USAGE_PURPOSE');
  return scope.run({ purpose }, work);
}
let lastUnattributedWarning = 0;

function prices() {
  if (!process.env.USAGE_PRICES_JSON) return DEFAULT_PRICES;
  try {
    const extra = JSON.parse(process.env.USAGE_PRICES_JSON);
    return { ...DEFAULT_PRICES, ...(extra && typeof extra === 'object' ? extra : {}) };
  } catch { return DEFAULT_PRICES; }
}

const count = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.round(Number(value)) : 0);

function cost({ model, inputTokens = 0, outputTokens = 0, cachedTokens = 0, units = 0 }) {
  const price = prices()[model];
  if (!price) return 0;
  if (price.perImage) return price.perImage * units;
  if (price.perSecond) return price.perSecond * units;
  const uncached = Math.max(0, inputTokens - cachedTokens);
  return (uncached * (price.input || 0) + cachedTokens * (price.cached ?? price.input ?? 0) + outputTokens * (price.output || 0)) / 1e6;
}

// Normalizes the usage shapes of the Gemini and Claude SDKs.
function fromGemini(usageMetadata = {}) {
  return {
    inputTokens: count(usageMetadata.promptTokenCount),
    outputTokens: count(usageMetadata.candidatesTokenCount) + count(usageMetadata.thoughtsTokenCount),
    cachedTokens: count(usageMetadata.cachedContentTokenCount)
  };
}
function fromClaude(usage = {}) {
  const cachedTokens = count(usage.cache_read_input_tokens);
  return {
    inputTokens: count(usage.input_tokens) + cachedTokens + count(usage.cache_creation_input_tokens),
    outputTokens: count(usage.output_tokens),
    cachedTokens
  };
}

const numericId = (id) => (/^[1-9]\d*$/.test(String(id || '')) ? String(id) : null);
function currentClientId() {
  return numericId(scope.getStore()?.clientId) || numericId(require('./metaConnection').context.getStore());
}
// Resolves who pays for a call: explicit id, then usage scope, then tenant context.
// A call with no customer is recorded as kind 'system' with its purpose.
function attribution(clientId, kind) {
  const id = clientId === undefined ? currentClientId() : numericId(clientId);
  if (id) return { clientId: id, kind, purpose: null };
  const purpose = scope.getStore()?.purpose;
  if (purpose) return { clientId: null, kind: 'system', purpose };
  if (Date.now() - lastUnattributedWarning > 60000) { lastUnattributedWarning = Date.now(); logger.warn('AI call without a customer or system purpose', { kind }); }
  return { clientId: null, kind: 'system', purpose: 'unattributed' };
}

async function record({ provider, model, kind, inputTokens = 0, outputTokens = 0, cachedTokens = 0, units = 0, clientId, costUsd } = {}) {
  try {
    const db = require('./db');
    if (!db.configured() || !provider || !model || !KINDS.has(kind)) return null;
    const who = attribution(clientId, kind);
    const row = {
      clientId: who.clientId,
      inputTokens: count(inputTokens), outputTokens: count(outputTokens), cachedTokens: count(cachedTokens),
      units: Number.isFinite(Number(units)) && Number(units) > 0 ? Number(units) : 0
    };
    // A provider-quoted cost (e.g. a video estimate) wins over the list price.
    const usd = Number.isFinite(Number(costUsd)) && costUsd !== null && Number(costUsd) >= 0 ? Number(costUsd) : cost({ model, ...row });
    await db.query(
      'INSERT INTO ai_usage(client_id,provider,model,kind,input_tokens,output_tokens,cached_tokens,units,cost_usd,purpose) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [row.clientId, String(provider).slice(0, 40), String(model).slice(0, 120), who.kind, row.inputTokens, row.outputTokens, row.cachedTokens, row.units, usd.toFixed(6), who.purpose]
    );
    if (row.clientId) require('./aiCostCap').noteSpend(row.clientId, usd);
    return usd;
  } catch (error) {
    logger.warn('AI usage was not recorded', { error: error.message });
    return null;
  }
}

// Spend per client for a period, newest-first by cost. clientId optional.
async function summary({ clientId, since, until } = {}) {
  const db = require('./db');
  const from = since ? new Date(since) : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const to = until ? new Date(until) : new Date();
  const params = [from.toISOString(), to.toISOString()];
  let filter = '';
  if (clientId !== undefined) { params.push(String(clientId)); filter = ' AND client_id=$3'; }
  const r = await db.query(
    `SELECT client_id, kind, COUNT(*)::int AS calls, SUM(input_tokens)::bigint AS input_tokens,
            SUM(output_tokens)::bigint AS output_tokens, SUM(units)::numeric AS units, SUM(cost_usd)::numeric AS cost_usd
       FROM ai_usage WHERE created_at >= $1 AND created_at < $2${filter}
      GROUP BY client_id, kind ORDER BY client_id NULLS LAST, kind`, params);
  const clients = new Map();
  for (const row of r.rows) {
    const key = row.client_id === null ? 'system' : String(row.client_id);
    const entry = clients.get(key) || { clientId: key, costUsd: 0, byKind: {} };
    entry.byKind[row.kind] = { calls: Number(row.calls), inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens), units: Number(row.units), costUsd: Number(row.cost_usd) };
    entry.costUsd += Number(row.cost_usd);
    clients.set(key, entry);
  }
  return { from: from.toISOString(), to: to.toISOString(), clients: [...clients.values()].sort((a, b) => b.costUsd - a.costUsd) };
}

const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

// This calendar month's AI spend for one customer, in USD.
async function monthSpend(clientId, now = new Date()) {
  const r = await require('./db').query('SELECT COALESCE(SUM(cost_usd),0)::numeric AS usd FROM ai_usage WHERE client_id=$1 AND created_at>=$2', [String(clientId), monthStart(now).toISOString()]);
  return Number(r.rows[0].usd);
}

const round = (n) => Math.round(Number(n) * 100) / 100;
const KIND_LABELS = { text: 'שיחה ותכנון', analysis: 'הבנת הודעות', image: 'גרפיקות', video: 'סרטונים', transcription: 'הודעות קוליות' };

// The owner's own view: what the AI work for their business cost this month.
async function ownerSummary(clientId, now = new Date()) {
  const r = await require('./db').query(
    `SELECT kind, COUNT(*)::int AS calls, SUM(units)::numeric AS units, SUM(cost_usd)::numeric AS usd
       FROM ai_usage WHERE client_id=$1 AND created_at>=$2 GROUP BY kind ORDER BY kind`, [String(clientId), monthStart(now).toISOString()]);
  const items = r.rows.map((row) => ({ kind: row.kind, label: KIND_LABELS[row.kind] || row.kind, calls: Number(row.calls), units: Number(row.units), costUsd: round(row.usd) }));
  const costUsd = round(items.reduce((sum, i) => sum + i.costUsd, 0));
  const cap = require('./aiCostCap');
  const capUsd = cap.capUsd();
  return { month: monthStart(now).toISOString().slice(0, 7), costUsd, items, cap: capUsd === null ? null : { usd: capUsd, level: cap.levelFor(costUsd), usedPercent: Math.round((costUsd / capUsd) * 100) } };
}

// The operator's view: spend per customer and per system purpose this month.
async function operatorSummary(now = new Date()) {
  const db = require('./db');
  const from = monthStart(now).toISOString();
  const clients = await db.query(
    `SELECT client_id, COUNT(*)::int AS calls, SUM(cost_usd)::numeric AS usd FROM ai_usage
      WHERE created_at>=$1 AND client_id IS NOT NULL GROUP BY client_id ORDER BY usd DESC LIMIT 200`, [from]);
  const systemRows = await db.query(
    `SELECT COALESCE(purpose,'unattributed') AS purpose, COUNT(*)::int AS calls, SUM(cost_usd)::numeric AS usd FROM ai_usage
      WHERE created_at>=$1 AND client_id IS NULL GROUP BY 1 ORDER BY usd DESC`, [from]);
  const cap = require('./aiCostCap');
  const perClient = clients.rows.map((row) => ({ clientId: String(row.client_id), calls: Number(row.calls), costUsd: round(row.usd), level: cap.levelFor(Number(row.usd)) }));
  const system = systemRows.rows.map((row) => ({ purpose: row.purpose, calls: Number(row.calls), costUsd: round(row.usd) }));
  const customersUsd = round(perClient.reduce((s, c) => s + c.costUsd, 0));
  const systemUsd = round(system.reduce((s, c) => s + c.costUsd, 0));
  return { month: from.slice(0, 7), totalUsd: round(customersUsd + systemUsd), customersUsd, systemUsd, capUsd: cap.capUsd(), perClient, system };
}

module.exports = { record, summary, cost, fromGemini, fromClaude, prices, DEFAULT_PRICES, forClient, system, scope, monthSpend, ownerSummary, operatorSummary, monthStart };
