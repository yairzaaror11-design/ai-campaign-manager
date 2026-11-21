'use strict';
// Manual workflow entry point: a durable claim MUST succeed before any Google request.
const { claimOnce } = require('./gemini-once-lock');
const { listModelsOnce, classifyError } = require('./gemini-probe-core');
async function main({ claim = claimOnce, list = listModelsOnce, env = process.env, log = console.log, errorLog = console.error } = {}) {
  // Fail closed before claiming if credentials/configuration are missing.
  if (!env.GEMINI_API_KEY || !env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY || !env.GITHUB_SHA) {
    errorLog(JSON.stringify({ result: 'BLOCKED', reason: 'MISSING_REQUIRED_CONFIGURATION' }));
    return 2;
  }
  const lock = await claim({ token: env.GITHUB_TOKEN, repository: env.GITHUB_REPOSITORY, sha: env.GITHUB_SHA });
  if (!lock.claimed) {
    errorLog(JSON.stringify({ result: 'BLOCKED', reason: lock.reason }));
    return 2;
  }
  // No retries on errors, timeouts, partial lists, or process failure after claim.
  try {
    const result = await list(env.GEMINI_API_KEY);
    log(JSON.stringify(result));
    return 0;
  } catch (error) {
    errorLog(JSON.stringify(classifyError(error)));
    return 1;
  }
}
if (require.main === module) main().then(code => { process.exitCode = code; }).catch(() => { console.error('LOCK_OR_PROBE_FAILURE'); process.exitCode = 2; });
module.exports = { main };
