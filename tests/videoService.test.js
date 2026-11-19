'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('./helpers/isolatedDatabase');

const env = (vars, work) => async () => {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { await work(); } finally { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

test('video requests are recognized only when explicitly asked for', () => {
  const { videoRequest } = require('../videoService');
  assert.equal(videoRequest('מה שלומך?'), null);
  assert.equal(videoRequest('צור לי גרפיקה למבצע'), null);
  const r = videoRequest('תכין לי סרטון של 10 שניות למבצע במספרה');
  assert.equal(r.aspectRatio, '9:16');
  assert.equal(r.durationSeconds, 10);
  assert.equal(videoRequest('תכין לי סרטון ריבועי לפוסט').aspectRatio, '1:1');
  assert.equal(videoRequest('תכין לי סרטון של 30 שניות').durationSeconds, 10, 'duration is capped for cost');
  assert.equal(videoRequest('תכין לי סרטון מהתמונה ששלחתי').usesReference, true);
  assert.ok(videoRequest('/video מבצע קיץ'));
});

test('video is disabled without the flag or credentials', env({ VIDEO_ENABLED: 'true', HF_CREDENTIALS: '' }, async () => {
  const video = require('../videoService');
  assert.equal(video.enabled(), false);
  process.env.HF_CREDENTIALS = 'id:secret';
  assert.equal(video.enabled(), true);
  process.env.VIDEO_ENABLED = 'false';
  assert.equal(video.enabled(), false);
}));

test('a request queues one job per inbound event and respects the monthly cap', env({ VIDEO_ENABLED: 'true', HF_CREDENTIALS: 'id:secret', VIDEO_MONTHLY_LIMIT: '1' }, async () => {
  const { db, close } = await openDatabase();
  try {
    const video = require('../videoService');
    const client = (await db.query("INSERT INTO clients(phone) VALUES('972500000081') RETURNING id")).rows[0].id;
    const req = video.videoRequest('תכין לי סרטון למבצע במספרה');
    assert.equal((await video.request(client, '972500000081', req, { eventId: 'wamid.1' })).status, 'QUEUED');
    assert.equal((await video.request(client, '972500000081', req, { eventId: 'wamid.1' })).status, 'MONTHLY_LIMIT');
    process.env.VIDEO_MONTHLY_LIMIT = '5';
    assert.equal((await video.request(client, '972500000081', req, { eventId: 'wamid.1' })).status, 'ALREADY_QUEUED');
    const job = (await db.query('SELECT * FROM video_jobs WHERE client_id=$1', [client])).rows[0];
    assert.equal(job.model_path, video.MODEL_TEXT);
    assert.match(job.prompt, /no on-screen text/);
  } finally { await close(); }
}));

test('the worker submits, waits, then delivers the video and records its cost', env({ VIDEO_ENABLED: 'true', HF_CREDENTIALS: 'id:secret', WHATSAPP_SEND_ENABLED: 'true' }, async () => {
  const { db, close } = await openDatabase();
  try {
    const video = require('../videoService');
    const client = (await db.query("INSERT INTO clients(phone) VALUES('972500000082') RETURNING id")).rows[0].id;
    await video.request(client, '972500000082', video.videoRequest('תכין לי סרטון למבצע'), { eventId: 'wamid.2' });
    let statusCalls = 0;
    const submitted = [];
    const provider = {
      estimate: async () => 0.63,
      submit: async (path, body, { idempotencyKey }) => { submitted.push({ path, body, idempotencyKey }); return { requestId: 'req_123456' }; },
      status: async () => (++statusCalls === 1 ? { status: 'in_progress', terminal: false } : { status: 'completed', terminal: true, videoUrl: 'https://cdn.example/v.mp4' }),
      download: async () => ({ buffer: Buffer.from('mp4-bytes'), contentType: 'video/mp4' })
    };
    const uploadVideo = async () => '987654321';
    assert.equal((await video.runOne({ provider, uploadVideo })).status, 'SUBMITTED');
    assert.equal(submitted[0].body.aspect_ratio, '9:16');
    assert.equal(submitted[0].body.duration, 5);
    await db.query('UPDATE video_jobs SET available_at=NOW()');
    assert.equal((await video.runOne({ provider, uploadVideo })).status, 'WAITING');
    await db.query('UPDATE video_jobs SET available_at=NOW()');
    assert.equal((await video.runOne({ provider, uploadVideo })).status, 'DELIVERED');
    assert.equal((await video.runOne({ provider, uploadVideo })).status, 'IDLE');

    const out = (await db.query('SELECT payload FROM whatsapp_outbox WHERE client_id=$1', [client])).rows;
    assert.equal(out.length, 1);
    assert.equal(out[0].payload.type, 'video');
    assert.equal(out[0].payload.video.id, '987654321');
    const usage = (await db.query("SELECT cost_usd,units FROM ai_usage WHERE client_id=$1 AND kind='video'", [client])).rows[0];
    assert.equal(Number(usage.cost_usd), 0.63);
    assert.equal(Number(usage.units), 5);
  } finally { await close(); }
}));

test('moderation and timeouts fail the job and tell the owner', env({ VIDEO_ENABLED: 'true', HF_CREDENTIALS: 'id:secret' }, async () => {
  const { db, close } = await openDatabase();
  try {
    const video = require('../videoService');
    const client = (await db.query("INSERT INTO clients(phone) VALUES('972500000083') RETURNING id")).rows[0].id;
    await video.request(client, '972500000083', video.videoRequest('תכין לי סרטון'), { eventId: 'wamid.3' });
    const provider = { estimate: async () => null, submit: async () => ({ requestId: 'req_abcdef' }), status: async () => ({ status: 'nsfw', terminal: true }) };
    await video.runOne({ provider });
    await db.query('UPDATE video_jobs SET available_at=NOW()');
    assert.equal((await video.runOne({ provider })).status, 'FAILED');
    const job = (await db.query('SELECT status,error_code FROM video_jobs WHERE client_id=$1', [client])).rows[0];
    assert.deepEqual(job, { status: 'FAILED', error_code: 'NSFW' });
    const notice = (await db.query('SELECT payload FROM whatsapp_outbox WHERE client_id=$1', [client])).rows[0];
    assert.match(notice.payload.text.body, /לא ניתן להכין סרטון/);

    await video.request(client, '972500000083', video.videoRequest('תכין לי סרטון'), { eventId: 'wamid.4' });
    await db.query("UPDATE video_jobs SET created_at=NOW()-INTERVAL '2 hours' WHERE status='PENDING'");
    assert.equal((await video.runOne({ provider })).status, 'FAILED');
  } finally { await close(); }
}));
