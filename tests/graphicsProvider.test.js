'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const g = require('../graphicService');

const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(32)]);
const withEnv = (vars, work) => async () => {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { await work(); } finally { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

test('OpenAI is used only when selected and configured', withEnv({ GRAPHICS_PROVIDER: 'openai', OPENAI_API_KEY: undefined, OPENAI_IMAGE_MODEL: undefined }, async () => {
  assert.equal(g.graphicsProvider(), 'openai');
  assert.equal(g.graphicsConfigured(), false);
  process.env.OPENAI_API_KEY = 'sk-test';
  assert.equal(g.graphicsConfigured(), true);
  process.env.GRAPHICS_PROVIDER = 'gemini';
  assert.equal(g.graphicsProvider(), 'gemini');
}));

test('OpenAI generations and reference edits send the right request and return a checked PNG', withEnv({ GRAPHICS_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test', OPENAI_IMAGE_MODEL: 'gpt-image-2.6-sunburst', OPENAI_IMAGE_QUALITY: undefined }, async () => {
  const post = axios.post; const calls = [];
  axios.post = async (url, body, opts) => { calls.push({ url, body, opts }); return { data: { data: [{ b64_json: PNG.toString('base64') }], usage: { input_tokens: 100, output_tokens: 1000 } } }; };
  try {
    const image = await g.generate('מבצע למספרה');
    assert.equal(image.mimeType, 'image/png');
    assert.equal(calls[0].url, 'https://api.openai.com/v1/images/generations');
    assert.equal(calls[0].body.model, 'gpt-image-2.6-sunburst');
    assert.equal(calls[0].body.quality, 'medium');
    assert.match(calls[0].body.prompt, /Do not draw buttons/);
    assert.match(calls[0].body.prompt, /מבצע למספרה$/);
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer sk-test');
    await g.generate('אותו מוצר', { referenceImage: { buffer: PNG, mimeType: 'image/png' } });
    assert.equal(calls[1].url, 'https://api.openai.com/v1/images/edits');
    assert.match(calls[1].body.images[0].image_url, /^data:image\/png;base64,/);
    axios.post = async () => ({ data: { data: [{}] } });
    await assert.rejects(g.generate('x'), /GRAPHIC_IMAGE_REQUIRED/);
    axios.post = async () => { throw Error('500'); };
    await assert.rejects(g.generate('x'), /GRAPHIC_PROVIDER_FAILED/);
  } finally { axios.post = post; }
}));
