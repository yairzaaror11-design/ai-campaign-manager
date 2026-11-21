'use strict';
// Lightweight self-check, run by the background jobs every few minutes.
// Checks: database, Meta access per connected business, WhatsApp sending,
// queue backlogs and job freshness. On failure the support operators get a
// plain-Hebrew WhatsApp note (opsAlerts); on recovery, one "back to normal" note.
// /health shows only the status of each check (no ids, tokens or customer data).
const db = require('./db');
const { logger } = require('./logger');

const QUEUE_STALE_SECONDS = 600; // a message waiting 10+ minutes means sending/handling is stuck
const HEARTBEAT_STALE_SECONDS = 300;
const META_LIVE_EVERY_MS = 6 * 60 * 60 * 1000;
let lastResult = null;
let lastLiveMetaAt = 0;

const seconds = (value) => (value ? Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000)) : null);

async function checkDatabase() {
  const began = Date.now();
  try { await db.query('SELECT 1'); return { status: 'ok', latencyMs: Date.now() - began }; } catch { return { status: 'fail' }; }
}

// Expiry from the database every run; a live read of the selected ad account
// every 6 hours (or when forced) catches revoked access and disabled accounts.
async function checkMeta({ live = false, probe } = {}) {
  const rows = (await db.query(`SELECT m.client_id, m.expires_at, c.meta_ad_account_id FROM meta_connections m
    JOIN clients c ON c.id=m.client_id ORDER BY m.client_id LIMIT 500`)).rows;
  const problems = [];
  for (const row of rows) {
    const left = new Date(row.expires_at).getTime() - Date.now();
    if (left <= 0) { problems.push({ clientId: String(row.client_id), reason: 'EXPIRED' }); continue; }
    if (left < 7 * 86400000) problems.push({ clientId: String(row.client_id), reason: 'EXPIRING', soft: true });
    if (!live || !row.meta_ad_account_id) continue;
    try {
      const account = await require('./metaConnection').context.run(String(row.client_id), () =>
        (probe || ((id) => require('./metaConnection').tenantRead('/' + id, { fields: 'account_status' })))(row.meta_ad_account_id));
      if (account && account.account_status !== undefined && Number(account.account_status) !== 1) problems.push({ clientId: String(row.client_id), reason: 'ACCOUNT_NOT_ACTIVE' });
    } catch (error) {
      problems.push({ clientId: String(row.client_id), reason: /^[A-Z_]+$/.test(error.message) ? error.message : 'META_READ_FAILED' });
    }
  }
  const hard = problems.filter((p) => !p.soft);
  return { status: hard.length ? 'fail' : problems.length ? 'warn' : 'ok', connected: rows.length, problems };
}

async function checkWhatsApp() {
  if (process.env.WHATSAPP_SEND_ENABLED !== 'true') return { status: 'disabled' };
  const r = (await db.query(`SELECT
      COUNT(*) FILTER (WHERE status IN ('FAILED','UNKNOWN') AND created_at>NOW()-INTERVAL '1 hour')::int AS failed,
      COUNT(*) FILTER (WHERE status IN ('SENT','DELIVERED','READ') AND created_at>NOW()-INTERVAL '1 hour')::int AS sent
    FROM whatsapp_outbox`)).rows[0];
  // Several failures and nothing sent in the last hour = sending is broken (token, number, Meta).
  const status = r.failed >= 3 && r.sent === 0 ? 'fail' : r.failed > 0 ? 'warn' : 'ok';
  return { status, failedLastHour: r.failed, sentLastHour: r.sent };
}

async function checkQueues() {
  const r = (await db.query(`SELECT
      (SELECT MIN(created_at) FROM whatsapp_inbound_events WHERE status IN ('PENDING','PROCESSING')) AS inbound_oldest,
      (SELECT COUNT(*)::int FROM whatsapp_inbound_events WHERE status IN ('PENDING','PROCESSING')) AS inbound_waiting,
      (SELECT COUNT(*)::int FROM whatsapp_inbound_events WHERE status='MANUAL_REVIEW' AND created_at>NOW()-INTERVAL '1 day') AS inbound_review,
      (SELECT MIN(created_at) FROM whatsapp_outbox WHERE status IN ('PENDING','PROCESSING')) AS outbound_oldest,
      (SELECT COUNT(*)::int FROM whatsapp_outbox WHERE status IN ('PENDING','PROCESSING')) AS outbound_waiting`)).rows[0];
  const inboundAge = seconds(r.inbound_oldest), outboundAge = process.env.WHATSAPP_SEND_ENABLED === 'true' ? seconds(r.outbound_oldest) : null;
  const stuck = (inboundAge ?? 0) > QUEUE_STALE_SECONDS || (outboundAge ?? 0) > QUEUE_STALE_SECONDS;
  return { status: stuck ? 'fail' : r.inbound_review > 0 ? 'warn' : 'ok', inboundWaiting: r.inbound_waiting, inboundOldestSeconds: inboundAge, inboundManualReview: r.inbound_review, outboundWaiting: r.outbound_waiting, outboundOldestSeconds: outboundAge };
}

async function checkJobs() {
  const beat = (await db.query("SELECT MAX(last_success_at) AS at FROM worker_heartbeats WHERE role='MESSAGES'")).rows[0].at;
  const jobs = (await db.query('SELECT name, last_success_at, last_failure_at FROM job_runs ORDER BY name')).rows;
  // A job is failing when its last run failed and it has not succeeded for 30+ minutes.
  const failing = jobs.filter((j) => j.last_failure_at && (!j.last_success_at || new Date(j.last_failure_at) > new Date(j.last_success_at)) && (seconds(j.last_success_at) ?? Infinity) > 1800).map((j) => j.name);
  const heartbeatAge = seconds(beat);
  const stale = heartbeatAge === null || heartbeatAge > HEARTBEAT_STALE_SECONDS;
  return { status: stale || failing.length ? 'fail' : 'ok', heartbeatSeconds: heartbeatAge, failing };
}

const JOB_NAMES = { maintenance: 'ניקוי ושמירת נתונים', metaAuth: 'בדיקת חיבורי Meta', reports: 'דוחות שבועיים', leadCheckins: 'תזכורות לידים', campaignGuard: 'שומר הקמפיינים', seasonal: 'הצעות עונתיות', dailyAdvice: 'עצה יומית', crmFeedback: 'משוב לידים ל־Meta', organic: 'פוסטים אורגניים', subscriptions: 'מנויים וחיובים', audiences: 'קהלי קונים', retentionNotices: 'אזהרות לפני מחיקה', selfCheck: 'בדיקה עצמית' };
const META_REASONS = { EXPIRED: 'פג תוקף החיבור', ACCOUNT_NOT_ACTIVE: 'חשבון המודעות לא פעיל (חסום או חוב)', EXPIRING: 'החיבור יפוג בתוך שבוע' };

// Runs all checks, alerts on failures, and keeps the result for /health.
async function run({ live, probe, alert = true } = {}) {
  const liveMeta = live ?? (Date.now() - lastLiveMetaAt > META_LIVE_EVERY_MS);
  if (liveMeta) lastLiveMetaAt = Date.now();
  const database = await checkDatabase();
  const safe = async (fn) => { try { return await fn(); } catch { return { status: 'fail', error: 'CHECK_FAILED' }; } };
  const checks = database.status === 'ok'
    ? { database, meta: await safe(() => checkMeta({ live: liveMeta, probe })), whatsapp: await safe(checkWhatsApp), queues: await safe(checkQueues), jobs: await safe(checkJobs) }
    : { database };
  const overall = Object.values(checks).some((c) => c.status === 'fail') ? 'fail' : Object.values(checks).some((c) => c.status === 'warn') ? 'warn' : 'ok';
  lastResult = { overall, checkedAt: new Date().toISOString(), checks };
  // Shared with the web service when the jobs run in a separate worker.
  await db.query("INSERT INTO job_runs(name,last_success_at,detail) VALUES('self_check_result',NOW(),$1::jsonb) ON CONFLICT(name) DO UPDATE SET last_success_at=NOW(),detail=EXCLUDED.detail", [JSON.stringify(publicView())]).catch(() => {});
  if (alert && database.status === 'ok') await sendAlerts(checks, liveMeta).catch(() => logger.warn('Self-check alerts not sent'));
  if (database.status !== 'ok') logger.error('Self-check: database unreachable');
  return lastResult;
}

async function sendAlerts(checks, liveMeta) {
  const ops = require('./opsAlerts');
  const toggle = (key, failing, text, okText) => (failing ? ops.fail(key, text) : ops.recover(key, okText));
  const meta = checks.meta;
  if (meta?.problems) {
    const failingIds = new Set();
    for (const p of meta.problems.filter((x) => !x.soft)) {
      failingIds.add(p.clientId);
      await ops.fail(`meta:${p.clientId}`, `🔌 החיבור ל־Meta של לקוח ${p.clientId} לא עובד (${META_REASONS[p.reason] || 'אין גישה לחשבון המודעות'}).\nצריך לבקש מבעל העסק לחבר מחדש את חשבון הפרסום.`);
    }
    // Live-only problems are seen only on live runs, so recovery is decided there.
    const open = liveMeta ? (await db.query("SELECT key FROM ops_alerts WHERE key LIKE 'meta:%' AND status='FAILING'")).rows : [];
    for (const { key } of open) if (!failingIds.has(key.slice(5))) await ops.recover(key, `✅ החיבור ל־Meta של לקוח ${key.slice(5)} חזר לעבוד.`);
  }
  if (checks.whatsapp) await toggle('whatsapp-send', checks.whatsapp.status === 'fail', `📵 שליחת הודעות WhatsApp נכשלת: ${checks.whatsapp.failedLastHour} הודעות נכשלו בשעה האחרונה ואף אחת לא יצאה.\nכדאי לבדוק את הטוקן של WhatsApp ב־Render ואת מצב המספר ב־Meta.`, '✅ שליחת הודעות WhatsApp חזרה לעבוד.');
  if (checks.queues) await toggle('queues', checks.queues.status === 'fail', `⏳ הודעות מחכות בתור יותר מ־10 דקות (נכנסות: ${checks.queues.inboundWaiting}, יוצאות: ${checks.queues.outboundWaiting}).\nייתכן שהמערכת תקועה. אם זה לא מסתדר בעוד כמה דקות, כדאי לעשות Restart לשירות ב־Render.`, '✅ התור התרוקן, ההודעות זורמות שוב.');
  if (checks.jobs) {
    const names = (checks.jobs.failing || []).map((n) => JOB_NAMES[n] || n).join(', ');
    await toggle('jobs', checks.jobs.status === 'fail', `⚙️ משימות רקע לא רצות כמו שצריך${names ? ': ' + names : ''}.\nאם זה נמשך, כדאי לעשות Restart לשירות ב־Render ולבדוק את הלוגים.`, '✅ משימות הרקע רצות שוב כרגיל.');
  }
}

// What /health shows: status per check and ages only.
function publicView() {
  if (!lastResult) return { overall: 'unknown' };
  const c = lastResult.checks, out = { overall: lastResult.overall, checkedAt: lastResult.checkedAt };
  for (const [name, check] of Object.entries(c)) out[name] = check.status;
  if (c.queues) { out.inboundOldestSeconds = c.queues.inboundOldestSeconds; out.outboundOldestSeconds = c.queues.outboundOldestSeconds; }
  if (c.jobs) out.heartbeatSeconds = c.jobs.heartbeatSeconds;
  return out;
}

// Records each background job's last success/failure for the freshness check.
async function track(name, work) {
  try {
    const result = await work();
    await db.query('INSERT INTO job_runs(name,last_success_at) VALUES($1,NOW()) ON CONFLICT(name) DO UPDATE SET last_success_at=NOW()', [name]).catch(() => {});
    return result;
  } catch (error) {
    logger.error('Background job failed', { job: name, error: /^[A-Z_]+$/.test(error?.message) ? error.message : 'JOB_FAILED' });
    await db.query('INSERT INTO job_runs(name,last_failure_at) VALUES($1,NOW()) ON CONFLICT(name) DO UPDATE SET last_failure_at=NOW()', [name]).catch(() => {});
    return null;
  }
}

// /health view: this process's last result, or the worker's (from the database).
async function healthView() {
  if (lastResult && Date.now() - Date.parse(lastResult.checkedAt) < 15 * 60000) return publicView();
  try {
    const row = (await db.query("SELECT detail FROM job_runs WHERE name='self_check_result'")).rows[0];
    if (row?.detail?.checkedAt) return { ...row.detail, ...(Date.now() - Date.parse(row.detail.checkedAt) > 15 * 60000 ? { stale: true } : {}) };
  } catch { /* the database check below reports this */ }
  return publicView();
}

function reset() { lastResult = null; lastLiveMetaAt = 0; }

module.exports = { run, publicView, healthView, track, checkDatabase, checkMeta, checkWhatsApp, checkQueues, checkJobs, reset, JOB_NAMES };
