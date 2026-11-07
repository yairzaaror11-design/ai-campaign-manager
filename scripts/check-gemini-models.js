'use strict';
// Explicit opt-in only. One GET, no retries, no redirects, no pagination, no generateContent.
const { listModelsOnce, classifyError } = require('./gemini-probe-core');
async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error(JSON.stringify({ result: 'FAILED', category: 'MISSING_GEMINI_API_KEY' }));
    process.exitCode = 2;
    return;
  }
  try {
    const result = await listModelsOnce(process.env.GEMINI_API_KEY);
    console.log(JSON.stringify(result));
    if (!result.complete) console.log(JSON.stringify({ warning: 'PARTIAL_MODEL_LIST' }));
  } catch (error) {
    console.error(JSON.stringify(classifyError(error)));
    process.exitCode = 1;
  }
}
if (require.main === module) main().catch(() => { console.error('Model listing failed'); process.exitCode = 1; });
module.exports = { main };
