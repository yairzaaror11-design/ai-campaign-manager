'use strict';
// AI cost attribution and cap, operator alerts, self-check, data retention, worker mode.
// Shared database in CI: every assertion is scoped to rows this file created.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('./helpers/isolatedDatabase');

const env = (vars, work) => async () => {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { await work(); } finally { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
let phoneSeq = 0;
const phone = () => '9726' + String(require('node:crypto').randomInt(0, 1e6)).padStart(6, '0') + String(++phoneSeq % 1000).padStart(3, '0');
let database;
test.before(async () => { database = await openDatabase(); });
test.after(async () => { await database.close(); });
const db = () => database.db;
async function client({ open = false } = {}) {
  const p = phone();
  const id = (await db().query('INSERT INTO clients(phone) VALUES($1) RETURNING id', [p])).rows[0].id;
  if (open) await db().query('INSERT INTO whatsapp_contacts(phone,last_inbound_at) VALUES($1,NOW())', [p]);
  return { id: String(id), phone: p };
}
const usageRows = async (where, params) => (await db().query(`SELECT client_id, kind, purpose FROM ai_usage WHERE ${where}`, params)).rows;

test('AI calls are billed to the customer in context, the explicit id, or marked as system work', async () => {
  const ledger = require('../usageLedger'), meta = require('../metaConnection');
  const a = await client(), b = await client();
  const model = 'test-model-' + a.id;
  await meta.context.run(a.id, () => ledger.record({ provider: 'gemini', model, kind: 'text', inputTokens: 10 }));
  await ledger.forClient(b.id, () => ledger.record({ provider: 'gemini', model, kind: 'text' }));
  await meta.context.run(a.id, () => ledger.record({ provider: 'gemini', model, kind: 'video', clientId: b.id }));
  await ledger.system('model_acceptance', () => ledger.record({ provider: 'claude', model, kind: 'text' }));
  // The synthetic probe tenant id is not a customer.
  await meta.context.run('synthetic-model-probe', () => ledger.system('model_acceptance', () => ledger.record({ provider: 'claude', model, kind: 'analysis' })));
  await ledger.record({ provider: 'gemini', model, kind: 'text' });
  const rows = await usageRows('model=$1 ORDER BY id', [model]);
  assert.deepEqual(rows.map((r) => [r.client_id === null ? null : String(r.client_id), r.kind, r.purpose]), [
    [a.id, 'text', null], [b.id, 'text', null], [b.id, 'video', null],
    [null, 'system', 'model_acceptance'], [null, 'system', 'model_acceptance'], [null, 'system', 'unattributed']
  ]);
  assert.throws(() => ledger.system('Bad Purpose!', () => {}), /INVALID_USAGE_PURPOSE/);
});

test('the model acceptance run is recorded as system work', env({ TASK_AGENT_EVALUATE_ON_START: 'false' }, async () => {
  const ledger = require('../usageLedger');
  const evaluation = require('../taskEvaluation');
  const model = 'eval-model-' + Date.now();
  await evaluation.run({ providers: [{ provider: 'gemini', model, configured: true }], decide: async () => { await ledger.record({ provider: 'gemini', model, kind: 'text' }); throw Error('INVALID_TASK_DECISION'); }, route: async () => ({ kind: 'ANSWER', reply: 'x' }) });
  const rows = await usageRows('model=$1', [model]);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.client_id === null && r.kind === 'system' && r.purpose === 'model_acceptance'));
}));

test('cost cap levels: off by default, warn at 80%, cheaper model at 100%, no new media at 150%', env({ AI_COST_CAP_USD_PER_CLIENT: undefined, SUPPORT_OPERATOR_CLIENT_IDS: '' }, async () => {
  const cap = require('../aiCostCap'), ledger = require('../usageLedger'), meta = require('../metaConnection');
  cap.reset();
  assert.equal(cap.capUsd(), null);
  assert.equal(cap.levelFor(1e9), 'ok');
  const c = await client();
  await ledger.record({ provider: 'test', model: 'unpriced', kind: 'text', clientId: c.id, costUsd: 4.5 });
  assert.equal(await cap.level(c.id), 'ok', 'no cap configured = never limited');
  process.env.AI_COST_CAP_USD_PER_CLIENT = '5';
  cap.reset();
  assert.equal(await cap.level(c.id), 'warn');
  assert.equal(await cap.imageLimit(c.id, 3), 3);
  assert.equal(await cap.videoAllowed(c.id), true);
  await ledger.record({ provider: 'test', model: 'unpriced', kind: 'text', clientId: c.id, costUsd: 1 });
  assert.equal(await cap.level(c.id), 'degrade', 'the cache follows new spend');
  assert.equal(await cap.imageLimit(c.id, 3), 1);
  assert.equal(await cap.videoAllowed(c.id), false);
  const options = await meta.context.run(c.id, () => cap.textOptions('gemini', { planningOnly: true }));
  assert.equal(options.model, 'gemini-3.5-flash-lite');
  assert.equal((await meta.context.run(c.id, () => cap.textOptions('claude', {}))).model, 'claude-haiku-5-5');
  assert.equal((await meta.context.run(c.id, () => cap.textOptions('gemini', { provider: 'gemini', model: 'x' }))).model, 'x', 'explicit evaluation choices are kept');
  await ledger.record({ provider: 'test', model: 'unpriced', kind: 'text', clientId: c.id, costUsd: 2 });
  assert.equal(await cap.level(c.id), 'block');
  assert.equal(await cap.imageLimit(c.id, 2), 0);
  // Another customer is not affected.
  const other = await client();
  assert.equal(await cap.level(other.id), 'ok');
  // Each level is told to the operator once per month.
  await new Promise((r) => setTimeout(r, 50));
  const month = new Date().toISOString().slice(0, 7);
  const alerts = (await db().query('SELECT key FROM ops_alerts WHERE key LIKE $1 ORDER BY key', [`ai-cap:${c.id}:${month}:%`])).rows.map((r) => r.key.split(':').at(-1));
  assert.deepEqual(alerts, ['block', 'degrade', 'warn']);
}));

test('over the cap the text call uses the cheaper model of the same provider', env({ AI_COST_CAP_USD_PER_CLIENT: '1', AI_PROVIDER: 'gemini', AI_FALLBACK_PROVIDER: '' }, async () => {
  const ai = require('../aiService'), cap = require('../aiCostCap'), ledger = require('../usageLedger'), meta = require('../metaConnection');
  cap.reset();
  const seen = [];
  ai.registerProvider('gemini', async (text, history, options) => { seen.push(options.model); return { text: 'ok', actionPlans: [] }; });
  const c = await client();
  await meta.context.run(c.id, () => ai.processMessage('שלום'));
  await ledger.record({ provider: 'test', model: 'unpriced', kind: 'text', clientId: c.id, costUsd: 1.2 });
  await meta.context.run(c.id, () => ai.processMessage('שלום'));
  assert.deepEqual(seen, [undefined, 'gemini-3.5-flash-lite']);
}));

test('a blocked customer gets no new graphics and no video; chat is untouched', env({ AI_COST_CAP_USD_PER_CLIENT: '1', GRAPHICS_ENABLED: 'true', VIDEO_ENABLED: 'true', HF_CREDENTIALS: 'id:secret' }, async () => {
  const cap = require('../aiCostCap'), ledger = require('../usageLedger'), meta = require('../metaConnection');
  cap.reset();
  const c = await client();
  await ledger.record({ provider: 'test', model: 'unpriced', kind: 'image', clientId: c.id, costUsd: 2 });
  const delivery = require('../whatsappDelivery');
  await assert.rejects(meta.context.run(c.id, () => delivery.messageContext.run({ eventId: 'cap-' + c.id, sequence: 0 }, () =>
    require('../graphicService').createGraphic(c.id, 'מבצע קיץ', { generateImage: async () => { throw Error('SHOULD_NOT_GENERATE'); } }))), /AI_COST_CAP_REACHED/);
  const req = require('../videoService').videoRequest('תכין לי סרטון למבצע במספרה');
  assert.equal((await require('../videoService').request(c.id, c.phone, req, { eventId: 'cap-video-' + c.id })).status, 'COST_CAP');
}));

test('owner usage summary shows only their own month; operator summary splits customers and system', env({ AI_COST_CAP_USD_PER_CLIENT: '10' }, async () => {
  const ledger = require('../usageLedger');
  require('../aiCostCap').reset();
  const a = await client(), b = await client();
  await ledger.record({ provider: 'gemini', model: 'unpriced', kind: 'text', clientId: a.id, costUsd: 1.25 });
  await ledger.record({ provider: 'gemini', model: 'unpriced', kind: 'image', clientId: a.id, costUsd: 0.5, units: 1 });
  await ledger.record({ provider: 'gemini', model: 'unpriced', kind: 'text', clientId: b.id, costUsd: 9 });
  const own = await ledger.ownerSummary(a.id);
  assert.equal(own.costUsd, 1.75);
  assert.deepEqual(own.items.map((i) => [i.kind, i.costUsd]), [['image', 0.5], ['text', 1.25]]);
  assert.equal(own.cap.usd, 10);
  assert.equal(own.cap.level, 'ok');
  const ops = await ledger.operatorSummary();
  assert.equal(ops.perClient.find((x) => x.clientId === b.id).level, 'warn');
  assert.equal(ops.perClient.find((x) => x.clientId === a.id).costUsd, 1.75);
  assert.ok(ops.system.some((s) => s.purpose === 'model_acceptance'));
}));

test('operator alerts: once per failure, throttled, one recovery note', env({ SUPPORT_OPERATOR_CLIENT_IDS: undefined }, async () => {
  const ops = require('../opsAlerts');
  const op = await client({ open: true });
  process.env.SUPPORT_OPERATOR_CLIENT_IDS = op.id;
  const key = 'test-alert:' + op.id;
  const outbox = async () => (await db().query('SELECT payload FROM whatsapp_outbox WHERE client_id=$1 ORDER BY created_at', [op.id])).rows;
  assert.equal((await ops.fail(key, 'בדיקה נכשלה')).sent, 1);
  assert.equal((await ops.fail(key, 'בדיקה נכשלה')).throttled, true);
  assert.equal((await ops.recover(key, 'חזר לעבוד')).sent, 1);
  assert.equal((await ops.recover(key, 'חזר לעבוד')).sent, 0);
  assert.deepEqual((await outbox()).map((r) => r.payload.text.body), ['בדיקה נכשלה', 'חזר לעבוד']);
  // Outside the 24h window and without an approved template nothing is queued (still logged).
  const closed = await client();
  process.env.SUPPORT_OPERATOR_CLIENT_IDS = closed.id;
  assert.equal((await ops.fail('test-alert:' + closed.id, 'x')).sent, 0);
}));

test('self-check: expired or revoked Meta access alerts the operator in Hebrew; /health shows status only', env({ SUPPORT_OPERATOR_CLIENT_IDS: undefined, WHATSAPP_SEND_ENABLED: undefined }, async () => {
  const selfCheck = require('../selfCheck');
  selfCheck.reset();
  const op = await client({ open: true }), expired = await client(), revoked = await client();
  process.env.SUPPORT_OPERATOR_CLIENT_IDS = op.id;
  await db().query("INSERT INTO meta_connections(client_id,meta_user_id,token_ciphertext,expires_at) VALUES($1,'u1','x',NOW()-INTERVAL '1 day'),($2,'u2','x',NOW()+INTERVAL '30 days')", [expired.id, revoked.id]);
  await db().query("UPDATE clients SET meta_ad_account_id='act_1' WHERE id=$1", [revoked.id]);
  const result = await selfCheck.run({ live: true, probe: async () => { const tenant = require('../metaConnection').context.getStore(); if (tenant === revoked.id) throw Error('META_TOKEN_INVALID'); return { account_status: 1 }; } });
  assert.equal(result.checks.database.status, 'ok');
  const mine = result.checks.meta.problems.filter((p) => [expired.id, revoked.id].includes(p.clientId)).map((p) => [p.clientId, p.reason]);
  assert.deepEqual(mine, [[expired.id, 'EXPIRED'], [revoked.id, 'META_TOKEN_INVALID']]);
  assert.equal(result.checks.meta.status, 'fail');
  assert.equal(result.checks.whatsapp.status, 'disabled');
  const texts = (await db().query('SELECT payload FROM whatsapp_outbox WHERE client_id=$1', [op.id])).rows.map((r) => r.payload.text.body);
  assert.ok(texts.some((t) => t.includes(`לקוח ${expired.id}`) && t.includes('לחבר מחדש')));
  assert.ok(texts.some((t) => t.includes(`לקוח ${revoked.id}`)));
  // Reconnected: one recovery note on the next live run.
  await db().query("UPDATE meta_connections SET expires_at=NOW()+INTERVAL '60 days' WHERE client_id=$1", [expired.id]);
  await selfCheck.run({ live: true, probe: async () => ({ account_status: 1 }) });
  const after = (await db().query('SELECT payload FROM whatsapp_outbox WHERE client_id=$1', [op.id])).rows.map((r) => r.payload.text.body);
  assert.ok(after.some((t) => t.includes(`לקוח ${expired.id} חזר לעבוד`)));
  // /health exposes only statuses and ages.
  const view = await selfCheck.healthView();
  assert.ok(['ok', 'warn', 'fail'].includes(view.meta));
  const json = JSON.stringify(view);
  assert.ok(!/clientId|client_id|problems/.test(json) && !json.includes('token') && !json.includes(op.phone), 'health view must not expose customer ids, tokens or phones');
  assert.ok(['ok', 'warn', 'fail'].includes(view.overall));
  await db().query('DELETE FROM meta_connections WHERE client_id IN ($1,$2)', [expired.id, revoked.id]);
}));

test('/health includes a checks object without secrets', env({ READ_ONLY: 'true' }, async () => {
  const express = require('express');
  const app = express(); app.use('/health', require('../health'));
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/health`);
    const body = await res.json();
    assert.equal(typeof body.checks, 'object');
    assert.equal(body.checks.database, 'ok');
    assert.ok(!JSON.stringify(body.checks).match(/token|secret|phone|972/i));
  } finally { server.close(); }
}));

test('job freshness: a job that keeps failing is reported', async () => {
  const selfCheck = require('../selfCheck');
  const name = 'testjob' + Date.now();
  assert.equal(await selfCheck.track(name, async () => { throw Error('BOOM'); }), null);
  let jobs = await selfCheck.checkJobs();
  assert.ok(jobs.failing.includes(name));
  await selfCheck.track(name, async () => 'ok');
  jobs = await selfCheck.checkJobs();
  assert.ok(!jobs.failing.includes(name));
  await db().query('DELETE FROM job_runs WHERE name=$1', [name]);
});

test('retention: owner is warned 7 days before an inactive profile is deleted, and can keep it', env({ DATA_RETENTION_DAYS: '90' }, async () => {
  const retention = require('../dataRetention'), maintenance = require('../maintenance');
  const old = await client({ open: true }), fresh = await client(), keeper = await client();
  for (const [c, days] of [[old, 85], [fresh, 10], [keeper, 95]]) await db().query("INSERT INTO marketing_profiles(client_id,payload,updated_at) VALUES($1,'{}'::jsonb,NOW()-($2::integer*INTERVAL '1 day'))", [c.id, days]);
  const sent = [];
  await retention.warnDue({ send: async (c, text) => { sent.push([String(c.id), text, c.window_open]); return c.window_open ? 'CHAT' : 'UNREACHABLE'; }, limit: 10000 });
  const mine = sent.filter(([id]) => [old.id, fresh.id, keeper.id].includes(id));
  assert.deepEqual(mine.map(([id]) => id).sort(), [old.id, keeper.id].sort());
  assert.match(mine[0][1], /בעוד 7 ימים/);
  assert.equal(mine.find(([id]) => id === old.id)[2], true);
  // A second run does not warn again.
  const again = [];
  await retention.warnDue({ send: async (c) => { again.push(String(c.id)); return 'CHAT'; }, limit: 10000 });
  assert.ok(!again.includes(old.id) && !again.includes(keeper.id));
  // The keeper (already past 90 days) is NOT deleted until 7 days after the warning.
  await maintenance.maintain();
  const exists = async (c) => (await db().query('SELECT 1 FROM marketing_profiles WHERE client_id=$1', [c.id])).rows.length === 1;
  assert.equal(await exists(keeper), true);
  // "Keep my data" from the owner resets the clock.
  const reply = await require('../metaConnection').context.run(keeper.id, () => retention.handleText(keeper.phone, 'שמור את המידע שלי'));
  assert.match(reply.reply, /שמרתי/);
  const row = (await db().query('SELECT retention_notice_at, updated_at>NOW()-INTERVAL \'1 minute\' AS touched FROM marketing_profiles WHERE client_id=$1', [keeper.id])).rows[0];
  assert.equal(row.retention_notice_at, null);
  assert.equal(row.touched, true);
  assert.equal(await retention.handleText(keeper.phone, 'מה שלומך'), null);
  // Warned 8 days ago and still inactive past 90 days: deleted.
  await db().query("UPDATE marketing_profiles SET updated_at=NOW()-INTERVAL '100 days', retention_notice_at=NOW()-INTERVAL '8 days' WHERE client_id=$1", [old.id]);
  await maintenance.maintain();
  assert.equal(await exists(old), false);
  assert.equal(await exists(fresh), true);
  const audit = (await db().query("SELECT result FROM tenant_audit WHERE client_id=$1 AND event='RETENTION_NOTICE'", [old.id])).rows;
  assert.deepEqual(audit.map((r) => r.result), ['CHAT']);
}));

test('retention notice payload has the keep button within the WhatsApp limits', () => {
  const r = require('../dataRetention');
  const p = r.buttonPayload(r.noticeText(90));
  const button = p.interactive.action.buttons[0].reply;
  assert.equal(button.id, r.KEEP_BUTTON_ID);
  assert.ok(button.title.length <= 20);
  assert.ok(p.interactive.body.text.length <= 1024);
});

test('audit record (approvals) is kept 7 years while conversation content goes at 90 days', env({ DATA_RETENTION_DAYS: '90', AUDIT_RETENTION_DAYS: undefined }, async () => {
  const c = await client();
  const add = (event, days) => db().query("INSERT INTO tenant_audit(client_id,event,result,created_at) VALUES($1,$2,'X',NOW()-($3::integer*INTERVAL '1 day'))", [c.id, event, days]);
  await add('APPROVAL_CONSUMED', 400);
  await add('APPROVAL_CREATED', 2600);
  await add('CONVERSATION_STATE', 100);
  await add('CONVERSATION_STATE', 10);
  await db().query("INSERT INTO conversation_messages(client_id,role,content,created_at) VALUES($1,'user','שלום',NOW()-INTERVAL '100 days')", [c.id]).catch(() => null);
  await require('../maintenance').maintain();
  const left = (await db().query('SELECT event FROM tenant_audit WHERE client_id=$1 ORDER BY created_at', [c.id])).rows.map((r) => r.event);
  assert.deepEqual(left, ['APPROVAL_CONSUMED', 'CONVERSATION_STATE']);
  assert.equal(require('../dataRetention').auditRetentionDays(), 2557);
  process.env.AUDIT_RETENTION_DAYS = '30';
  assert.throws(() => require('../dataRetention').auditRetentionDays(), /INVALID_AUDIT_RETENTION_DAYS/);
}));

test('background jobs run in the web service by default, or only in the worker when asked', env({ RUN_BACKGROUND_JOBS_IN: undefined, WHATSAPP_WORKER_IN_WEB: undefined }, async () => {
  const jobs = require('../backgroundJobs');
  assert.equal(jobs.jobsRunIn(), 'web');
  process.env.RUN_BACKGROUND_JOBS_IN = 'worker';
  assert.equal(jobs.jobsRunIn(), 'worker');
  delete process.env.RUN_BACKGROUND_JOBS_IN;
  process.env.WHATSAPP_WORKER_IN_WEB = 'false';
  assert.equal(jobs.jobsRunIn(), 'worker');
  delete process.env.WHATSAPP_WORKER_IN_WEB;
  process.env.RUN_BACKGROUND_JOBS_IN = 'everywhere';
  assert.throws(() => require('../runtimeConfig').validateRuntime(), /INVALID_RUN_BACKGROUND_JOBS_IN/);
}));

test('the separate worker refuses to start unless jobs are moved out of the web service', env({ RUN_BACKGROUND_JOBS_IN: undefined, WHATSAPP_WORKER_IN_WEB: undefined, DATABASE_URL: 'postgresql://x.invalid/db' }, async () => {
  await assert.rejects(require('../messageWorker').main(), /SET_RUN_BACKGROUND_JOBS_IN_WORKER/);
}));

test('the paid Render plan is only prepared: render.yaml stays free, the proposal is marked for owner approval', () => {
  const fs = require('node:fs'), path = require('node:path');
  const live = fs.readFileSync(path.join(__dirname, '..', 'render.yaml'), 'utf8');
  const paid = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'render.paid.yaml'), 'utf8');
  assert.match(live, /plan: free/);
  assert.doesNotMatch(live, /type: worker/);
  assert.match(paid, /REQUIRES OWNER APPROVAL — PAID/);
  assert.equal((paid.match(/requires owner approval — paid/g) || []).length, 2);
  assert.match(paid, /type: worker[\s\S]*startCommand: npm run worker:messages/);
  assert.equal((paid.match(/key: RUN_BACKGROUND_JOBS_IN\n\s+value: worker/g) || []).length, 2);
});
