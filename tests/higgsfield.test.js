'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const hf = require('../higgsfield');

const withCreds = (work) => async () => {
  const before = process.env.HF_CREDENTIALS;
  process.env.HF_CREDENTIALS = 'keyid:keysecret';
  try { await work(); } finally { if (before === undefined) delete process.env.HF_CREDENTIALS; else process.env.HF_CREDENTIALS = before; }
};

test('credentials are required and sent as a Key header with an idempotency key', withCreds(async () => {
  let seen;
  const http = { post: async (url, body, opts) => { seen = { url, body, opts }; return { data: { status: 'queued', request_id: 'req_000001' } }; } };
  const r = await hf.submit('kling-video/v3.0/std/text-to-video', { prompt: 'x' }, { idempotencyKey: 'job-1', http });
  assert.equal(r.requestId, 'req_000001');
  assert.equal(seen.url, 'https://api.higgsfield.ai/kling-video/v3.0/std/text-to-video');
  assert.equal(seen.opts.headers.Authorization, 'Key keyid:keysecret');
  assert.equal(seen.opts.headers['Idempotency-Key'], 'job-1');
  delete process.env.HF_CREDENTIALS;
  assert.equal(hf.configured(), false);
  await assert.rejects(hf.submit('a/b/c', {}, { http }), /HIGGSFIELD_NOT_CONFIGURED/);
}));

test('provider errors map to stable codes and bad paths are refused', withCreds(async () => {
  const fail = (status) => ({ post: async () => { const e = Error('x'); e.response = { status }; throw e; } });
  await assert.rejects(hf.submit('a/b/c', {}, { http: fail(403) }), /HIGGSFIELD_INSUFFICIENT_BALANCE/);
  await assert.rejects(hf.submit('a/b/c', {}, { http: fail(429) }), /HIGGSFIELD_BUSY/);
  await assert.rejects(hf.submit('a/b/c', {}, { http: fail(422) }), /HIGGSFIELD_INVALID_REQUEST/);
  await assert.rejects(hf.submit('../../evil', {}, { http: fail(200) }), /INVALID_MODEL_PATH/);
}));

test('wait polls with backoff until a terminal status and honors the deadline', withCreds(async () => {
  let n = 0;
  const http = { get: async () => ({ data: ++n < 3 ? { status: 'in_progress' } : { status: 'completed', video: { url: 'https://cdn/v.mp4' } } }) };
  const sleeps = [];
  const done = await hf.wait('req_000001', { http, sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(done.videoUrl, 'https://cdn/v.mp4');
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[1] > sleeps[0]);
  const never = { get: async () => ({ data: { status: 'queued' } }) };
  await assert.rejects(hf.wait('req_000001', { http: never, maxMs: 1, sleep: async () => {} }), /HIGGSFIELD_TIMEOUT/);
}));

test('uploads never send our credentials to the presigned URL', withCreds(async () => {
  let putHeaders;
  const http = {
    post: async () => ({ data: { upload_url: 'https://s3.example/put', public_url: 'https://cdn.example/in.jpg', upload_headers: { 'Content-Type': 'image/jpeg' } } }),
    put: async (url, body, opts) => { putHeaders = opts.headers; return {}; }
  };
  assert.equal(await hf.uploadImage(Buffer.from('jpg'), 'image/jpeg', { http }), 'https://cdn.example/in.jpg');
  assert.equal(putHeaders.Authorization, undefined);
  await assert.rejects(hf.uploadImage(Buffer.from('x'), 'image/gif', { http }), /INVALID_UPLOAD_TYPE/);
}));
