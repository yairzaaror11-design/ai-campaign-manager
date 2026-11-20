'use strict';
// Per-customer monthly AI cost cap. Off unless AI_COST_CAP_USD_PER_CLIENT is set.
// Levels, by this month's AI spend for the customer:
//   ok       below 80% of the cap
//   warn     80%+     the operator is told; nothing changes for the customer
//   degrade  100%+    conversations use a cheaper model, one image per request, no video
//   block    150%+    (AI_COST_CAP_BLOCK_RATIO) no new images or videos; chat keeps working
// Chat is never blocked, so the business owner is never left without an answer.
const { logger } = require('./logger');

const LEVELS = ['ok', 'warn', 'degrade', 'block'];
const CACHE_MS = 60000;
const cache = new Map();

function capUsd() {
  const raw = process.env.AI_COST_CAP_USD_PER_CLIENT;
  if (raw === undefined || raw === '' || raw === 'off') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function blockRatio() {
  const n = Number(process.env.AI_COST_CAP_BLOCK_RATIO || 1.5);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : 1.5;
}
function levelFor(spentUsd) {
  const cap = capUsd();
  if (cap === null) return 'ok';
  const ratio = Number(spentUsd) / cap;
  if (ratio >= blockRatio()) return 'block';
  if (ratio >= 1) return 'degrade';
  if (ratio >= 0.8) return 'warn';
  return 'ok';
}
const monthKey = (now = new Date()) => now.toISOString().slice(0, 7);

// Keeps the cached total current between DB reads (called by the usage ledger).
function noteSpend(clientId, usd) {
  const entry = cache.get(String(clientId));
  if (entry && entry.month === monthKey() && Number.isFinite(Number(usd))) entry.usd += Number(usd);
}

async function spent(clientId) {
  const key = String(clientId), month = monthKey();
  const entry = cache.get(key);
  if (entry && entry.month === month && Date.now() - entry.at < CACHE_MS) return entry.usd;
  const usd = await require('./usageLedger').monthSpend(key);
  cache.set(key, { usd, at: Date.now(), month });
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
  return usd;
}

const MESSAGES = {
  warn: (id, usd, cap) => `💡 לקוח ${id} הגיע ל־80% מתקציב ה־AI החודשי (${usd.toFixed(2)}$ מתוך ${cap}$). עדיין לא שיניתי כלום אצלו. אם זה צפוי, אפשר להעלות את התקרה.`,
  degrade: (id, usd, cap) => `⚠️ לקוח ${id} עבר את תקציב ה־AI החודשי (${usd.toFixed(2)}$ מתוך ${cap}$). מעכשיו: מודל זול יותר בשיחה, גרפיקה אחת לבקשה ובלי סרטונים. הצ׳אט ממשיך לעבוד.`,
  block: (id, usd, cap) => `🛑 לקוח ${id} הגיע ל־${usd.toFixed(2)}$ החודש (תקרה ${cap}$). עצרתי אצלו יצירת גרפיקות וסרטונים חדשים עד תחילת החודש הבא. הצ׳אט ממשיך לעבוד. להעלאת התקרה: AI_COST_CAP_USD_PER_CLIENT.`
};

// Current level for a customer; tells the operator once per month per level.
async function level(clientId) {
  const cap = capUsd();
  if (cap === null || !/^[1-9]\d*$/.test(String(clientId || ''))) return 'ok';
  let usd;
  try { usd = await spent(clientId); } catch { return 'ok'; } // a ledger outage never blocks a customer
  const current = levelFor(usd);
  if (current !== 'ok') {
    void require('./opsAlerts').once(`ai-cap:${clientId}:${monthKey()}:${current}`, MESSAGES[current](String(clientId), usd, cap))
      .catch(() => logger.warn('AI cap alert not recorded'));
  }
  return current;
}
const atLeast = (current, wanted) => LEVELS.indexOf(current) >= LEVELS.indexOf(wanted);

function cheaperModel(provider) {
  if (provider === 'claude') return process.env.AI_CAP_CLAUDE_MODEL || 'claude-haiku-5-5';
  if (provider === 'gemini') return process.env.AI_CAP_GEMINI_MODEL || 'gemini-3.5-flash-lite';
  return undefined;
}
// Options for a text call: the cheaper model once the customer is over the cap.
async function textOptions(provider, options = {}) {
  if (options.provider || options.model) return options; // explicit choices (evaluation) are kept
  const clientId = require('./usageLedger').scope.getStore()?.clientId || require('./metaConnection').context.getStore();
  if (!atLeast(await level(clientId), 'degrade')) return options;
  const model = cheaperModel(provider);
  return model ? { ...options, model } : options;
}
// How many images a request may make now (0 = none).
async function imageLimit(clientId, requested) {
  const current = await level(clientId);
  if (current === 'block') return 0;
  if (current === 'degrade') return Math.min(1, requested);
  return requested;
}
async function videoAllowed(clientId) { return !atLeast(await level(clientId), 'degrade'); }

function reset() { cache.clear(); }

module.exports = { capUsd, blockRatio, levelFor, level, noteSpend, textOptions, imageLimit, videoAllowed, cheaperModel, reset, LEVELS };
