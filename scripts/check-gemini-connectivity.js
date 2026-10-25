'use strict';
// Isolated, single-request Gemini connectivity probe. No WhatsApp or Meta imports.
const { GoogleGenAI } = require('@google/genai');
async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY secret is not configured in GitHub Actions');
    process.exitCode = 2;
    return;
  }
  const model = 'gemini-2.5-flash';
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  try {
    const response = await ai.models.generateContent({
      model,
      contents: 'ענה בעברית במשפט קצר אחד: איזה מידע דרוש כדי להכין קמפיין לידים בפייסבוק?',
      config: { maxOutputTokens: 64, temperature: 0, thinkingConfig: { thinkingBudget: 0 }, httpOptions: { timeout: 12000 } }
    });
    const text = (response.text || '').trim();
    if (!text) throw new Error('Model returned no text');
    const usage = response.usageMetadata || {};
    console.log(JSON.stringify({ result: 'SUCCESS', model, response: text.slice(0, 350), inputTokens: usage.promptTokenCount ?? null, outputTokens: usage.candidatesTokenCount ?? null }));
  } catch (err) {
    // Do not log SDK error objects: they may include request headers or other secrets.
    const code = Number(err.status || err.code);
    console.error(JSON.stringify({ result: 'FAILED', category: code === 401 || code === 403 ? 'AUTH_OR_ACCESS' : code === 429 ? 'QUOTA_OR_RATE_LIMIT' : code === 404 ? 'MODEL_UNAVAILABLE' : 'API_ERROR', httpStatus: Number.isInteger(code) ? code : null }));
    process.exitCode = 1;
  }
}
main().catch(() => { console.error('Unexpected connectivity probe failure'); process.exitCode = 1; });
