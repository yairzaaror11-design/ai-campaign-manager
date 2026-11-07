'use strict';
// Isolated, single-request Gemini connectivity probe. No WhatsApp or Meta imports.
const { GoogleGenAI } = require('@google/genai');
const { MODEL, classifyError, summarizeGeneration } = require('./gemini-probe-core');
async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY secret is not configured in GitHub Actions');
    process.exitCode = 2;
    return;
  }
  const model = MODEL;
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  try {
    const response = await ai.models.generateContent({
      model,
      contents: 'ענה בעברית במשפט קצר אחד: איזה מידע דרוש כדי להכין קמפיין לידים בפייסבוק?',
      config: { maxOutputTokens: 64, temperature: 0, thinkingConfig: { thinkingBudget: 0 }, httpOptions: { timeout: 12000 } }
    });
    console.log(JSON.stringify(summarizeGeneration(response, model)));
  } catch (err) {
    console.error(JSON.stringify(classifyError(err)));
    process.exitCode = 1;
  }
}
main().catch(() => { console.error('Unexpected connectivity probe failure'); process.exitCode = 1; });
