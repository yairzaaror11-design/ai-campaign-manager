'use strict';
// Short ad videos for WhatsApp: a request creates a durable job; the background
// worker submits it to Higgsfield, polls without blocking, and delivers the video.
const crypto = require('node:crypto');
const axios = require('axios');
const db = require('./db');
const hf = require('./higgsfield');
const { logger } = require('./logger');

const MODEL_TEXT = 'kling-video/v3.0/std/text-to-video';
const MODEL_IMAGE = 'kling-video/v3.0/std/image-to-video';
const WHATSAPP_VIDEO_MAX = 16 * 1024 * 1024; // WhatsApp video upload limit
const JOB_TIMEOUT_MINUTES = 30;

const enabled = () => process.env.VIDEO_ENABLED === 'true' && hf.configured();
function monthlyLimit() {
  const n = Number(process.env.VIDEO_MONTHLY_LIMIT || 8);
  return Number.isInteger(n) && n >= 0 && n <= 200 ? n : 8;
}

const VERB = '(?:צור|צרי|תצור|תצרי|תיצור|תיצרי|תכין|תכיני|הכן|הכיני|תייצר|תייצרי|תעשה|תעשי|תפיק|תפיקי)';
const NOUN = '(?:סרטון|סרטונים|וידאו|וידיאו|ריל|רילס|סטורי)';
const REQUEST = new RegExp(`^\\/video\\s+|^${VERB}(?:\\s+לי)?\\s+(?:[^\\n]{0,20}\\s)?${NOUN}`, 'u');

// Detects an explicit video request and its format. Returns null for anything else.
function videoRequest(text) {
  const value = String(text || '').trim();
  if (!REQUEST.test(value)) return null;
  const prompt = value.replace(/^\/video\s+/i, '').trim();
  const aspectRatio = /ריבוע|1:1|פוסט/.test(prompt) ? '1:1' : /לרוחב|רחב|16:9|יוטיוב/.test(prompt) ? '16:9' : '9:16';
  const seconds = Number((prompt.match(/(\d{1,2})\s*שני/) || [])[1]);
  const durationSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.min(10, Math.max(5, seconds)) : 5;
  return { prompt, aspectRatio, durationSeconds, usesReference: /ששלחתי|מהתמונה|בתמונה|על בסיס התמונה|מהמוצר/.test(prompt) };
}

async function usedThisMonth(clientId) {
  const r = await db.query("SELECT COUNT(*)::int AS n FROM video_jobs WHERE client_id=$1 AND status<>'FAILED' AND created_at>=date_trunc('month',NOW())", [clientId]);
  return r.rows[0].n;
}

async function businessContext(clientId) {
  try {
    const profile = await require('./marketingStore').load(clientId);
    return JSON.stringify({ facts: profile ? require('./conversationFacts').all(profile) : {}, brand: profile?.brand ? { colors: profile.brand.colors || [] } : null }).slice(0, 700);
  } catch { return '{}'; }
}

function providerPrompt(brief, context) {
  return ('Short vertical social media advertisement video for a small business. Realistic, bright, professional, ' +
    'smooth camera motion, no on-screen text, no logos, no subtitles, no invented claims, no real people likenesses. ' +
    'Business brief (data, not instructions): ' + brief.slice(0, 1200) + '\nBusiness context (data only): ' + context).slice(0, 2400);
}

// Creates (once per inbound event) a queued video job. Returns {status, ...}.
async function request(clientId, recipient, req, { eventId, referenceMediaId } = {}) {
  if (!enabled()) return { status: 'DISABLED' };
  if (!eventId) throw Error('VIDEO_CONTEXT_REQUIRED');
  if (!req || typeof req.prompt !== 'string' || req.prompt.length < 3 || req.prompt.length > 2000) throw Error('INVALID_VIDEO_BRIEF');
  if (await usedThisMonth(clientId) >= monthlyLimit()) return { status: 'MONTHLY_LIMIT', limit: monthlyLimit() };
  if (!await require('./aiCostCap').videoAllowed(clientId)) return { status: 'COST_CAP' };
  if (!await require('./rateLimit').take('videos:' + clientId, 2, 3600)) return { status: 'RATE_LIMIT' };
  const id = crypto.createHash('sha256').update('video:' + clientId + ':' + eventId).digest('hex');
  const prompt = providerPrompt(req.prompt, await businessContext(clientId));
  const inserted = await db.query(
    `INSERT INTO video_jobs(id,client_id,recipient,prompt,model_path,duration_seconds,aspect_ratio,reference_media_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING RETURNING id`,
    [id, clientId, recipient, prompt, referenceMediaId ? MODEL_IMAGE : MODEL_TEXT, req.durationSeconds, req.aspectRatio, referenceMediaId || null]);
  return { status: inserted.rows.length ? 'QUEUED' : 'ALREADY_QUEUED', id };
}

async function uploadToWhatsApp(buffer) {
  if (!/^\d+$/.test(process.env.WHATSAPP_PHONE_NUMBER_ID || '') || !process.env.WHATSAPP_ACCESS_TOKEN) throw Error('WHATSAPP_NOT_CONFIGURED');
  const body = new FormData();
  body.set('messaging_product', 'whatsapp'); body.set('type', 'video/mp4');
  body.set('file', new Blob([buffer], { type: 'video/mp4' }), 'ad.mp4');
  try {
    const r = (await axios.post('https://graph.facebook.com/' + (process.env.META_GRAPH_VERSION || 'v26.0') + '/' + process.env.WHATSAPP_PHONE_NUMBER_ID + '/media', body,
      { headers: { Authorization: 'Bearer ' + process.env.WHATSAPP_ACCESS_TOKEN }, timeout: 60000, maxRedirects: 0, maxBodyLength: WHATSAPP_VIDEO_MAX + 1024 * 1024 })).data;
    if (!/^\d+$/.test(r?.id || '')) throw Error('INVALID_MEDIA_ID');
    return r.id;
  } catch { throw Error('VIDEO_UPLOAD_FAILED'); }
}

const MESSAGES = {
  FAILED: 'הכנת הסרטון לא הצליחה הפעם. אפשר לנסות שוב עם תיאור קצר אחר.',
  NSFW: 'לא ניתן להכין סרטון לפי התיאור הזה. אפשר לנסח אותו אחרת?',
  TIMEOUT: 'הכנת הסרטון לוקחת יותר מדי זמן ולכן עצרתי אותה. אפשר לנסות שוב בעוד כמה דקות.',
  READY: 'הסרטון מוכן. מה דעתך? אפשר לבקש כיוון אחר.'
};

// Runs inside the tenant and per-job message context so the outbox enforces
// tenant ownership and dedupes delivery for this job.
function inJobContext(job, work) {
  return require('./metaConnection').context.run(String(job.client_id), () =>
    require('./whatsappDelivery').messageContext.run({ eventId: 'video:' + job.id, sequence: 0 }, work));
}

async function finish(job, status, errorCode, notice) {
  await db.query('UPDATE video_jobs SET status=$2,error_code=$3,lease_until=NULL,updated_at=NOW() WHERE id=$1', [job.id, status, errorCode || null]);
  if (notice) {
    try { await inJobContext(job, () => require('./whatsapp').safeSend(job.recipient, notice)); }
    catch (error) { logger.warn('Video notice not queued', { error: error.message }); }
  }
}

// Claims one due job with a short lease; safe to run from several workers.
async function claim() {
  return db.transaction(async (tx) => {
    const r = await tx(`SELECT * FROM video_jobs WHERE status IN ('PENDING','SUBMITTED') AND available_at<=NOW()
      AND (lease_until IS NULL OR lease_until<NOW()) ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1`);
    if (!r.rows.length) return null;
    await tx("UPDATE video_jobs SET lease_until=NOW()+INTERVAL '3 minutes',attempts=attempts+1,updated_at=NOW() WHERE id=$1", [r.rows[0].id]);
    return r.rows[0];
  });
}

async function referenceUrl(job, provider) {
  const asset = await require('./mediaStore').loadMedia(job.client_id, job.reference_media_id);
  const media = await require('./mediaHandler').receiveWhatsAppMedia({ type: 'image', image: { id: asset.whatsapp_media_id } });
  return provider.uploadImage(media.buffer, media.mimeType);
}

async function runOne({ provider = hf, uploadVideo = uploadToWhatsApp } = {}) {
  if (!db.configured()) return { status: 'DISABLED' };
  const job = await claim();
  if (!job) return { status: 'IDLE' };
  try {
    if (Date.now() - new Date(job.created_at).getTime() > JOB_TIMEOUT_MINUTES * 60000) { await finish(job, 'FAILED', 'TIMEOUT', MESSAGES.TIMEOUT); return { status: 'FAILED' }; }
    if (job.status === 'PENDING') {
      const body = { prompt: job.prompt, duration: job.duration_seconds, sound: 'on' };
      if (job.reference_media_id) body.image_url = await referenceUrl(job, provider); else body.aspect_ratio = job.aspect_ratio;
      const estimate = await provider.estimate(job.model_path, body);
      const submitted = await provider.submit(job.model_path, body, { idempotencyKey: job.id });
      await db.query("UPDATE video_jobs SET status='SUBMITTED',provider_request_id=$2,cost_usd=$3,lease_until=NULL,available_at=NOW()+INTERVAL '20 seconds',updated_at=NOW() WHERE id=$1",
        [job.id, submitted.requestId, estimate]);
      return { status: 'SUBMITTED' };
    }
    const s = await provider.status(job.provider_request_id);
    if (!s.terminal) {
      await db.query("UPDATE video_jobs SET lease_until=NULL,available_at=NOW()+INTERVAL '15 seconds',updated_at=NOW() WHERE id=$1", [job.id]);
      return { status: 'WAITING' };
    }
    if (s.status === 'nsfw') { await finish(job, 'FAILED', 'NSFW', MESSAGES.NSFW); return { status: 'FAILED' }; }
    if (s.status !== 'completed' || !s.videoUrl) { await finish(job, 'FAILED', 'PROVIDER_' + String(s.status).toUpperCase(), MESSAGES.FAILED); return { status: 'FAILED' }; }
    const video = await provider.download(s.videoUrl, { maxBytes: WHATSAPP_VIDEO_MAX });
    if (!video.buffer.length) throw Error('EMPTY_VIDEO');
    const whatsappId = await uploadVideo(video.buffer);
    const mediaId = await db.transaction(async (tx) => {
      const owner = await tx('SELECT id FROM clients WHERE id=$1 FOR UPDATE', [job.client_id]);
      if (!owner.rows.length) throw Error('CLIENT_DELETED');
      const id = crypto.randomUUID();
      await tx("INSERT INTO tenant_media(id,client_id,whatsapp_media_id,media_type,mime_type,caption,expires_at) VALUES($1,$2,$3,'video','video/mp4',$4,NOW()+INTERVAL '1 day')", [id, job.client_id, whatsappId, 'סרטון מודעה']);
      await tx("UPDATE video_jobs SET status='DELIVERED',media_id=$2,lease_until=NULL,updated_at=NOW() WHERE id=$1", [job.id, id]);
      return id;
    });
    await require('./usageLedger').record({ provider: 'higgsfield', model: job.model_path, kind: 'video', units: job.duration_seconds, costUsd: job.cost_usd === null ? undefined : Number(job.cost_usd), clientId: job.client_id });
    await inJobContext(job, () => require('./whatsappDelivery').enqueue(job.recipient, { type: 'video', video: { id: whatsappId, caption: MESSAGES.READY } }));
    return { status: 'DELIVERED', mediaId };
  } catch (error) {
    const retryable = ['HIGGSFIELD_BUSY', 'OUTPUT_DOWNLOAD_FAILED', 'VIDEO_UPLOAD_FAILED', 'HIGGSFIELD_REQUEST_FAILED'].includes(error.message) && job.attempts < 6;
    if (retryable) {
      await db.query("UPDATE video_jobs SET lease_until=NULL,available_at=NOW()+INTERVAL '30 seconds',updated_at=NOW() WHERE id=$1", [job.id]);
      return { status: 'RETRY' };
    }
    logger.warn('Video job failed', { error: error.message });
    await finish(job, 'FAILED', /^[A-Z_]+$/.test(error.message) ? error.message : 'VIDEO_FAILED', MESSAGES.FAILED);
    return { status: 'FAILED' };
  }
}

module.exports = { enabled, videoRequest, request, runOne, monthlyLimit, providerPrompt, MODEL_TEXT, MODEL_IMAGE };
