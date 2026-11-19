'use strict';
// Claude provider through the official Anthropic SDK. Same contract as gemini.js:
// returns {text, actionPlans}; tools are the shared read/propose tools only.
const gemini = require('./gemini');
const ledger = require('./usageLedger');

const DEFAULT_MODEL = 'claude-opus-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const REFUSAL_TEXT = 'לא אוכל לעזור בבקשה הזו. אפשר לנסח אותה אחרת?';

function lowerSchema(value) {
  if (Array.isArray(value)) return value.map(lowerSchema);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === 'type' && typeof v === 'string' ? v.toLowerCase() : lowerSchema(v)]));
  return value;
}

let sdkClient = null;
function sdk() {
  if (!sdkClient) {
    const Anthropic = require('@anthropic-ai/sdk').default;
    sdkClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2 });
  }
  return sdkClient;
}

// options.client ({create(body)}) is the test seam; production uses the SDK with
// server-side refusal fallbacks so a declined turn is retried on a fallback model.
function creator(options, timeout) {
  if (options.client) return (body) => options.client.create(body);
  return async (body) => {
    const Anthropic = require('@anthropic-ai/sdk').default;
    const send = (b) => sdk().beta.messages.create({ ...b, betas: [FALLBACK_BETA], fallbacks: 'default' }, { timeout });
    try {
      return await send(body);
    } catch (error) {
      // A schema the constrained decoder does not accept falls back to prompt-only JSON.
      if (error instanceof Anthropic.BadRequestError && body.output_config?.format) {
        const { format, ...rest } = body.output_config;
        try { return await send({ ...body, output_config: rest }); } catch (retry) { if (retry instanceof Anthropic.APIError) throw Error('AI_REQUEST_FAILED'); throw retry; }
      }
      if (error instanceof Anthropic.APIError) throw Error('AI_REQUEST_FAILED');
      throw error;
    }
  };
}

function model(options = {}) { return options.model || process.env.CLAUDE_MODEL || DEFAULT_MODEL; }

function meter(response, name, kind) {
  if (response?.usage) void ledger.record({ provider: 'claude', model: name, kind, ...ledger.fromClaude(response.usage) });
  return response;
}

const textOf = (response) => (response.content || []).filter((p) => p.type === 'text').map((p) => p.text).join('\n').trim();
const stripFences = (text) => text.replace(/^```(?:json)?\s*|\s*```$/g, '');

function systemFor(options) {
  if (options.routingOnly) return require('./conversationRouter').SYSTEM;
  if (options.taskPlanning) {
    const base = require('./taskPlanner').SYSTEM;
    return options.taskPlanningSchema
      ? base + '\n\nReturn exactly one JSON object and nothing else (no prose, no code fences). It must validate against this JSON Schema:\n' + JSON.stringify(options.taskPlanningSchema)
      : base + '\n\nReturn exactly one JSON object and nothing else (no prose, no code fences).';
  }
  return require('./marketingPrompt').withMarketingContext(
    gemini.SYSTEM + (options.creativeDraft ? '\n' + require('./creativeGeneration').SYSTEM : '') +
    (options.planningOnly ? '\nPlanning conversation only. No tools or actions are available. Use supplied dashboard context to answer, explain and suggest; never claim to save, publish, send, book, delete or execute.' : ''),
    options.marketingContext);
}

// Routing and short chat stay fast at low effort; planning gets medium.
const effortFor = (options) => (options.taskPlanning ? (['low','medium','high'].includes(process.env.CLAUDE_PLANNING_EFFORT) ? process.env.CLAUDE_PLANNING_EFFORT : 'medium') : 'low');

async function processWithClaude(text, history = [], options = {}) {
  if (!process.env.ANTHROPIC_API_KEY && !options.client) throw Error('ANTHROPIC_API_KEY_REQUIRED');
  if (!options.model && !process.env.CLAUDE_MODEL) throw Error('CLAUDE_MODEL_REQUIRED');
  const name = model(options);
  const create = creator(options, options.taskPlanning ? 90000 : 45000);
  const messages = [...history.slice(-12).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 12000) })), { role: 'user', content: text }];
  const tools = options.planningOnly ? undefined : gemini.functionDeclarations.map((f) => ({ name: f.name, description: f.description, input_schema: lowerSchema(f.parameters) }));
  const plans = [];
  for (let round = 0; round < 6; round++) {
    const response = meter(await create({
      model: name,
      max_tokens: 16000,
      cache_control: { type: 'ephemeral' },
      output_config: { effort: effortFor(options), ...(options.taskPlanning && options.taskPlanningSchema && process.env.CLAUDE_STRUCTURED_PLANNING !== 'false' ? { format: { type: 'json_schema', schema: options.taskPlanningSchema } } : {}) },
      system: systemFor(options),
      messages,
      ...(tools ? { tools } : {})
    }), name, 'text');
    if (response.stop_reason === 'refusal') return { text: REFUSAL_TEXT, actionPlans: plans };
    const calls = (response.content || []).filter((p) => p.type === 'tool_use');
    if (options.planningOnly && calls.length) throw Error('PLANNING_TOOL_CALL_REJECTED');
    if (!calls.length) {
      const out = textOf(response);
      return { text: options.taskPlanning ? stripFences(out) : out, actionPlans: plans };
    }
    if (calls.length > 5) throw Error('AI_TOOL_LIMIT');
    // Keep the full content (thinking blocks included) so the next turn stays valid.
    messages.push({ role: 'assistant', content: response.content });
    const results = [];
    for (const call of calls) {
      try {
        const result = await gemini.runTool(call.name, call.input || {});
        if (result?.actionPlan) plans.push(result.actionPlan);
        results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result) });
      } catch {
        results.push({ type: 'tool_result', tool_use_id: call.id, content: 'Tool request rejected', is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  throw Error('AI_TOOL_LIMIT');
}

async function analyzeConversation(text, context = {}, options = {}) {
  if (!process.env.CLAUDE_MODEL || (!options.client && !process.env.ANTHROPIC_API_KEY)) throw Error('CLAUDE_CONFIGURATION_REQUIRED');
  const name = model(options);
  const response = meter(await creator(options, 20000)({
    model: name,
    max_tokens: 8000,
    cache_control: { type: 'ephemeral' },
    output_config: { effort: 'low' },
    system: require('./conversationAnalysis').ANALYSIS_SYSTEM + '\n\nReturn exactly one JSON object and nothing else.',
    messages: [{ role: 'user', content: JSON.stringify({ context, currentUserMessage: text }) }]
  }), name, 'analysis');
  if (response.stop_reason === 'refusal') throw Error('ANALYSIS_UNAVAILABLE');
  return JSON.parse(stripFences(textOf(response)));
}

module.exports = { processWithClaude, analyzeConversation, DEFAULT_MODEL };
