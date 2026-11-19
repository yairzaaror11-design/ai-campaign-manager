'use strict';
// Minimal Higgsfield API client (https://docs.higgsfield.ai): submit, poll, upload, estimate.
// Credentials: HF_CREDENTIALS="<key id>:<key secret>". Never logged.
const axios = require('axios');
const crypto = require('node:crypto');

const BASE = 'https://api.higgsfield.ai';
const TERMINAL = new Set(['completed', 'failed', 'nsfw', 'canceled']);

function credentials() {
  const value = process.env.HF_CREDENTIALS || '';
  if (!/^[^:\s]+:[^:\s]+$/.test(value)) throw Error('HIGGSFIELD_NOT_CONFIGURED');
  return value;
}
const configured = () => { try { credentials(); return true; } catch { return false; } };

function headers(extra = {}) {
  return { Authorization: 'Key ' + credentials(), 'Content-Type': 'application/json', ...extra };
}

function failure(error) {
  const status = error?.response?.status;
  if (status === 403) return Error('HIGGSFIELD_INSUFFICIENT_BALANCE');
  if (status === 401) return Error('HIGGSFIELD_AUTH_FAILED');
  if (status === 429 || status === 503 || status >= 500) return Error('HIGGSFIELD_BUSY');
  if (status === 400 || status === 422) return Error('HIGGSFIELD_INVALID_REQUEST');
  return Error('HIGGSFIELD_REQUEST_FAILED');
}

// Submits a generation; the idempotency key makes a retried submit safe.
async function submit(modelPath, body, { idempotencyKey = crypto.randomUUID(), http = axios } = {}) {
  if (!/^[a-z0-9][a-z0-9./-]{2,120}$/.test(modelPath)) throw Error('INVALID_MODEL_PATH');
  try {
    const r = (await http.post(`${BASE}/${modelPath}`, body, { headers: headers({ 'Idempotency-Key': idempotencyKey }), timeout: 30000, maxRedirects: 0 })).data;
    if (!/^[\w-]{6,}$/.test(r?.request_id || '')) throw Error('HIGGSFIELD_INVALID_RESPONSE');
    return { requestId: r.request_id, status: r.status || 'queued' };
  } catch (error) { if (/^HIGGSFIELD_/.test(error.message)) throw error; throw failure(error); }
}

async function status(requestId, { http = axios } = {}) {
  if (!/^[\w-]{6,}$/.test(requestId || '')) throw Error('INVALID_REQUEST_ID');
  try {
    const r = (await http.get(`${BASE}/requests/${requestId}/status`, { headers: headers(), timeout: 20000, maxRedirects: 0 })).data;
    return { status: r?.status, terminal: TERMINAL.has(r?.status), videoUrl: r?.video?.url || null, imageUrls: (r?.images || []).map((i) => i?.url).filter(Boolean), raw: r };
  } catch (error) { throw failure(error); }
}

// Polls with 2s -> x1.5 -> 10s backoff until terminal or the deadline.
async function wait(requestId, { maxMs = 8 * 60 * 1000, http = axios, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const deadline = Date.now() + maxMs;
  let delay = 2000;
  for (;;) {
    let s;
    try { s = await status(requestId, { http }); } catch (error) { if (error.message !== 'HIGGSFIELD_BUSY') throw error; }
    if (s?.terminal) return s;
    if (Date.now() + delay > deadline) throw Error('HIGGSFIELD_TIMEOUT');
    await sleep(delay + Math.floor(Math.random() * 500));
    delay = Math.min(10000, Math.round(delay * 1.5));
  }
}

// Uploads an input image and returns its public URL for image_url fields.
async function uploadImage(buffer, contentType, { http = axios } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 10 * 1024 * 1024) throw Error('INVALID_UPLOAD');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) throw Error('INVALID_UPLOAD_TYPE');
  try {
    const r = (await http.post(`${BASE}/files/generate-upload-url`, { content_type: contentType }, { headers: headers(), timeout: 20000, maxRedirects: 0 })).data;
    if (!/^https:\/\//.test(r?.upload_url || '') || !/^https:\/\//.test(r?.public_url || '')) throw Error('HIGGSFIELD_INVALID_RESPONSE');
    // Presigned URL: send only the returned headers, never our credentials.
    await http.put(r.upload_url, buffer, { headers: { ...(r.upload_headers || { 'Content-Type': contentType }) }, timeout: 60000, maxRedirects: 0, maxBodyLength: 11 * 1024 * 1024 });
    return r.public_url;
  } catch (error) { if (/^HIGGSFIELD_/.test(error.message)) throw error; throw failure(error); }
}

// Returns the provider's USD estimate, or null when unavailable.
async function estimate(modelPath, body, { http = axios } = {}) {
  try {
    const r = (await http.post(`${BASE}/estimate/${modelPath}`, body, { headers: headers(), timeout: 15000, maxRedirects: 0 })).data;
    const usd = Number(r?.usd);
    return Number.isFinite(usd) && usd >= 0 ? usd : null;
  } catch { return null; }
}

// Downloads a finished output from the provider CDN with a hard size cap.
async function download(url, { maxBytes, http = axios } = {}) {
  if (!/^https:\/\//.test(url || '')) throw Error('INVALID_OUTPUT_URL');
  try {
    const r = await http.get(url, { responseType: 'arraybuffer', timeout: 120000, maxRedirects: 3, maxContentLength: maxBytes });
    return { buffer: Buffer.from(r.data), contentType: String(r.headers?.['content-type'] || '') };
  } catch (error) {
    if (error?.code === 'ERR_BAD_RESPONSE' || /maxContentLength/i.test(error?.message || '')) throw Error('OUTPUT_TOO_LARGE');
    throw Error('OUTPUT_DOWNLOAD_FAILED');
  }
}

module.exports = { configured, submit, status, wait, uploadImage, estimate, download, TERMINAL };
