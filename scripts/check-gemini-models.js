'use strict';
// Opt-in ONLY: no workflow invokes this script automatically.
// models.list reads metadata; it does not invoke generateContent.
const { GoogleGenAI } = require('@google/genai');
const { MODEL, listModels, classifyError } = require('./gemini-probe-core');
async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error(JSON.stringify({ result:'FAILED', category:'MISSING_GEMINI_API_KEY' }));
    process.exitCode = 2;
    return;
  }
  try {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const result = await listModels(client, MODEL);
    console.log(JSON.stringify(result));
    if (!result.listed || !result.supportsGenerateContent) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify(classifyError(error)));
    process.exitCode = 1;
  }
}
if (require.main === module) main().catch(() => { console.error('Model listing failed'); process.exitCode = 1; });
module.exports = { main };
