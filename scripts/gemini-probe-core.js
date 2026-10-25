'use strict';
// Pure helpers. Never include raw SDK error messages, URLs, headers or credentials in logs.
const MODEL = 'gemini-2.5-flash';
function classifyError(error) {
  const raw = error && (error.status ?? error.code);
  const status = Number(raw);
  const httpStatus = [400, 401, 403, 404, 429, 500, 502, 503, 504].includes(status) ? status : null;
  const category = status === 403 ? 'ACCESS_DENIED' : status === 404 ? 'MODEL_OR_API_VERSION_NOT_FOUND' : status === 429 ? 'RATE_LIMIT_OR_QUOTA' : status === 401 ? 'AUTHENTICATION_FAILED' : 'API_ERROR';
  return { result: 'FAILED', category, httpStatus };
}
function summarizeGeneration(response, model = MODEL) {
  const answer = typeof response?.text === 'string' ? response.text.trim() : '';
  if (!answer) throw new Error('EMPTY_MODEL_RESPONSE');
  const usage = response.usageMetadata || {};
  const safeCount = n => Number.isSafeInteger(n) && n >= 0 ? n : null;
  return { result: 'SUCCESS', model, response: answer.slice(0, 350), inputTokens: safeCount(usage.promptTokenCount), outputTokens: safeCount(usage.candidatesTokenCount) };
}
function normalizeModelName(name) {
  return typeof name === 'string' ? name.replace(/^models\//, '') : '';
}
function inspectModels(models, target = MODEL) {
  const entry = models.find(m => normalizeModelName(m.name) === target);
  const supported = entry?.supportedGenerationMethods ?? entry?.supportedActions ?? [];
  return { result: 'SUCCESS', model: target, listed: Boolean(entry), supportsGenerateContent: Boolean(entry) && Array.isArray(supported) && supported.some(x => x === 'generateContent') };
}
async function listModels(client, target = MODEL) {
  // SDK returns a pager that is async-iterable; exhaust pages before declaring a model absent.
  const pager = await client.models.list({ config: { pageSize: 100 } });
  const models = [];
  for await (const model of pager) {
    models.push({ name: model.name, supportedGenerationMethods: model.supportedGenerationMethods, supportedActions: model.supportedActions });
    if (models.length > 1000) throw new Error('MODEL_LIST_TOO_LARGE');
  }
  return inspectModels(models, target);
}
module.exports = { MODEL, classifyError, summarizeGeneration, normalizeModelName, inspectModels, listModels };
