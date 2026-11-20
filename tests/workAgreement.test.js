'use strict';
// Work agreement (הסכם עבודה): set once, act inside it, ask outside it, never pass the ceiling,
// stop everything in one tap; plus trustworthy approvals (readiness, expiry by type, re-offer,
// the activation question) and duplicate protection for anything that may cost money.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const axios = require('axios');
const { openDatabase } = require('./helpers/isolatedDatabase');

const env = { ...process.env };
function setEnv() {
  Object.assign(process.env, { APP_PUBLIC_URL: 'https://test.example', META_APP_ID: process.env.META_APP_ID || '123', META_APP_SECRET: 'test', META_LOGIN_CONFIG_ID: '456', META_TOKEN_ENCRYPTION_KEY: process.env.META_TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64'), APPROVAL_HMAC_KEY: process.env.APPROVAL_HMAC_KEY || crypto.randomBytes(32).toString('hex'), READ_ONLY: 'false', META_WRITES_ENABLED: 'true', WHATSAPP_SEND_ENABLED: 'false' });
  delete process.env.APPROVAL_TTL_MINUTES; delete process.env.APPROVAL_PROTECTIVE_TTL_HOURS; delete process.env.APPROVAL_NEUTRAL_TTL_MINUTES;
}
function restoreEnv() { for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k]; Object.assign(process.env, env); }

async function owner(db, phone, account, { connected = true, selected = true } = {}) {
  const meta = require('../metaConnection');
  const id = (await db.query('INSERT INTO clients(phone,meta_ad_account_id) VALUES($1,$2) RETURNING id', [phone, selected ? 'act_' + account : null])).rows[0].id;
  if (connected) await db.query("INSERT INTO meta_connections(client_id,meta_user_id,token_ciphertext,app_id,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 hour')", [id, 'u' + phone, meta.encrypt('test-token', id), process.env.META_APP_ID]);
  return id;
}
// A small fake Graph API for one ad account: campaigns, ad sets and ads are stored objects; every write is recorded.
function fakeMeta(account, { campaigns = {}, adsets = {}, ads = {}, monthSpend = 0, todaySpend = 0, permissions = ['ads_read', 'ads_management'] } = {}) {
  const objects = new Map(), posts = [];
  for (const [id, c] of Object.entries(campaigns)) objects.set(id, { id, account_id: String(account), status: 'ACTIVE', effective_status: 'ACTIVE', objective: 'OUTCOME_LEADS', ...c });
  for (const [id, s] of Object.entries(adsets)) objects.set(id, { id, account_id: String(account), status: 'PAUSED', ...s });
  for (const [id, a] of Object.entries(ads)) objects.set(id, { id, account_id: String(account), status: 'PAUSED', ...a });
  const get = axios.get, post = axios.post;
  const pathOf = (url) => url.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+/, '');
  axios.get = async (url, opts = {}) => {
    const path = pathOf(url), q = opts.params || {};
    if (path === '/me/permissions') return { data: { data: permissions.map((permission) => ({ permission, status: 'granted' })) } };
    if (path === '/act_' + account) return { data: { id: 'act_' + account, name: 'משרד תיווך', currency: 'ILS', timezone_name: 'Asia/Jerusalem', account_status: 1 } };
    if (path === '/act_' + account + '/insights') return { data: { data: [{ spend: String(q.date_preset === 'today' ? todaySpend : monthSpend) }] } };
    const running = (list) => list.filter((o) => (o.effective_status || o.status) === 'ACTIVE').map((o) => ({ id: o.id, daily_budget: o.daily_budget }));
    if (path === '/act_' + account + '/campaigns') return { data: { data: running([...objects.values()].filter((o) => campaigns[o.id] || o.objective)) } };
    if (path === '/act_' + account + '/adsets') return { data: { data: running([...objects.values()].filter((o) => o.campaign_id && !o.adset_id)) } };
    const key = path.split('/').at(-1);
    if (objects.has(key)) return { data: objects.get(key) };
    throw Error('UNEXPECTED_READ ' + path);
  };
  axios.post = async (url, body) => {
    const p = Object.fromEntries(body.entries()), key = pathOf(url).split('/').at(-1);
    posts.push({ path: pathOf(url), body: p });
    if (objects.has(key)) { const o = { ...objects.get(key), ...p }; if (p.status) o.effective_status = p.status; objects.set(key, o); return { data: { id: key, success: true } }; }
    throw Error('UNEXPECTED_WRITE ' + url);
  };
  return { posts, objects, restore: () => { axios.get = get; axios.post = post; } };
}
const plan = (intent, account, campaignId, parameters = {}, summary = 'בדיקה') => require('../actionPlan').createActionPlan({ intent, summary, target: { accountId: 'act_' + account, campaignId }, parameters });
async function agree(clientId, allow, limits = {}) {
  const authority = require('../scopedAuthority');
  return authority.withWhatsAppOwner(clientId, () => authority.setAgreement(clientId, { monthlyCeiling: 3000, maxDailyPerCampaign: 200, allow, ...limits }));
}
const inCtx = (id, work) => require('../metaConnection').context.run(String(id), work);

test('the owner sets the work agreement once on WhatsApp, with button questions', async () => {
  setEnv();
  const { db, close } = await openDatabase();
  try {
    const wa = require('../workAgreement'), authority = require('../scopedAuthority');
    const id = await owner(db, '972500944001', 94401);
    const first = await wa.handleText(id, 'הסכם עבודה');
    assert.match(first.text, /5 שאלות קצרות/);
    assert.equal(first.interactivePayload.interactive.action.buttons.length, 3, 'monthly ceiling as buttons');
    assert.match((await wa.handleText(id, 'תקרה חודשית 3000')).text, /תקציב היומי המקסימלי/);
    assert.match((await wa.handleText(id, 'מקסימום יומי 5000')).text, /לא יכול להיות גדול מהתקרה/, 'daily above monthly is refused');
    assert.match((await wa.handleText(id, 'מקסימום יומי 150')).text, /מה הסוכן יכול לעשות לבד/);
    assert.match((await wa.handleText(id, 'הסוכן רק יגן על הכסף')).text, /סגנון/);
    await wa.handleText(id, 'רציני, בלי אימוג׳ים');
    const confirm = await wa.handleText(id, 'פוליטיקה, מתחרים');
    assert.match(confirm.leadingText, /תקרת הוצאה חודשית על פרסום: 3,000 ₪/);
    assert.match(confirm.leadingText, /תמיד ישאל אותך קודם/);
    assert.equal(await authority.getAgreement(id), null, 'nothing saved before the owner confirms');
    const done = await wa.handleText(id, 'מאשר את הסכם העבודה');
    assert.match(done.text, /הסכם העבודה נשמר/);
    const a = await authority.getAgreement(id);
    assert.equal(a.monthlyCeiling, 3000); assert.equal(a.maxDailyPerCampaign, 150);
    assert.deepEqual(a.allow, wa.PRESETS.protect);
    assert.deepEqual(a.forbiddenTopics, ['פוליטיקה', 'מתחרים']);
    assert.equal(a.styleNotes, 'רציני, בלי אימוג׳ים');
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM authority_audit WHERE client_id=$1 AND event='AGREEMENT_SET'", [id])).rows[0].n, 1);
    // A new agreement replaces the old one; only one is ever live.
    await agree(id, wa.PRESETS.all);
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM authority_mandates WHERE client_id=$1 AND status IN ('ACTIVE','PAUSED')", [id])).rows[0].n, 1);
    assert.equal((await authority.getAgreement(id)).allow.shiftBudget, true);
    // It is not a scoped mandate and never shows in that list.
    assert.equal((await inCtx(id, () => authority.list(id))).mandates.length, 0);
    // Only the owner can set it, and limits are validated.
    await assert.rejects(inCtx(id, () => authority.setAgreement(id, { monthlyCeiling: 1, maxDailyPerCampaign: 1 })), /AUTHORITY_OWNER_REQUIRED/);
    await assert.rejects(authority.withWhatsAppOwner(id, () => authority.setAgreement(id, { monthlyCeiling: 100, maxDailyPerCampaign: 500 })), /AGREEMENT_DAILY_ABOVE_MONTHLY/);
    await assert.rejects(authority.withWhatsAppOwner(id, () => authority.setAgreement(id, { monthlyCeiling: 100, maxDailyPerCampaign: 50, allow: { deleteEverything: true } })), /INVALID_AGREEMENT_INPUT/);
  } finally { await close(); restoreEnv(); }
});

test('inside the agreement the agent pauses a losing campaign alone and logs why', async () => {
  setEnv();
  const { db, close } = await openDatabase();
  const fake = fakeMeta(94402, { campaigns: { 7701: { name: 'דירות בחולון', daily_budget: '10000' } } });
  try {
    const wa = require('../workAgreement');
    const id = await owner(db, '972500944002', 94402);
    await agree(id, wa.PRESETS.protect);
    const r = await wa.proposeOrAct(id, plan('PAUSE_CAMPAIGN', 94402, '7701', {}, 'השהיה'), { reason: 'הוציא 300 ₪ בשלושה ימים בלי אף ליד' });
    assert.equal(r.autonomous, true); assert.equal(r.ok, true, JSON.stringify(r.result));
    assert.match(r.text, /עשיתי לבד, לפי הסכם העבודה/); assert.match(r.text, /למה: הוציא 300 ₪/);
    assert.deepEqual(fake.posts.map((p) => [p.path, p.body.status]), [['/7701', 'PAUSED']]);
    const use = (await db.query('SELECT reason FROM authority_uses WHERE client_id=$1', [id])).rows;
    assert.equal(use.length, 1); assert.match(use[0].reason, /בלי אף ליד/);
    const log = await require('../activityLog').list(id);
    assert.match(log[0].status, /בוצע ✅ · לבד, לפי הסכם העבודה/); assert.match(log[0].why, /בלי אף ליד/);
  } finally { fake.restore(); await close(); restoreEnv(); }
});

test('outside the agreement the agent asks, and says why', async () => {
  setEnv();
  const { db, close } = await openDatabase();
  const fake = fakeMeta(94403, { campaigns: { 7702: { name: 'פנטהאוז', daily_budget: '10000' }, 7713: { name: 'דופלקס', daily_budget: '10000' } } });
  try {
    const wa = require('../workAgreement');
    const id = await owner(db, '972500944003', 94403);
    // No agreement at all: everything is an approval, exactly as before.
    let r = await wa.proposeOrAct(id, plan('PAUSE_CAMPAIGN', 94403, '7702'));
    assert.equal(r.autonomous, false); assert.ok(r.approval.actionId);
    await agree(id, wa.PRESETS.none);
    r = await wa.proposeOrAct(id, plan('PAUSE_CAMPAIGN', 94403, '7702'));
    assert.equal(r.autonomous, false); assert.match(r.askWhy, /לא ברשימת הדברים שהסוכן עושה לבד/);
    await agree(id, wa.PRESETS.all);
    r = await wa.proposeOrAct(id, plan('CHANGE_BUDGET', 94403, '7713', { dailyBudget: '250' }));
    assert.equal(r.autonomous, false); assert.match(r.askWhy, /מעל התקציב היומי המקסימלי/);
    // Creating a new campaign or activating it the first time always asks.
    assert.equal(require('../scopedAuthority').agreementDecision({ policy: {}, status: 'ACTIVE' }, { intent: 'CREATE_BUNDLE' }).ok, false);
    assert.equal(fake.posts.length, 0, 'nothing was written to Meta');
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM approvals WHERE client_id=$1 AND status='PENDING'", [id])).rows[0].n, 2, 'the pause stays pending next to the budget request');
  } finally { fake.restore(); await close(); restoreEnv(); }
});

test('spending is never authorized beyond the monthly ceiling or the daily maximum', async () => {
  const authority = require('../scopedAuthority'), policy = require('../approvalPolicy');
  const p = { kind: 'WORK_AGREEMENT', clientId: '1', monthlyCeiling: 3000, maxDailyPerCampaign: 200, currency: 'ILS', allow: { shiftBudget: true, lowerBudget: true, activateNew: true }, alwaysAsk: [] };
  const row = { policy: p, policy_hash: policy.planHash(p), status: 'ACTIVE' };
  const raise = (to) => ({ intent: 'CHANGE_BUDGET', tenantId: '1', parameters: { dailyBudgetMinor: to * 100 }, review: { currency: 'ILS', currentDailyBudgetMinor: 10000 } });
  // 2,000 spent, 100/day running, 10 days left: +50/day -> 2,000 + 150×10 = 3,500 > 3,000.
  assert.deepEqual(authority.agreementDecision(row, raise(150), { monthSpend: 2000, committedDailyMinor: 10000, daysLeft: 10 }), { ok: false, why: 'ABOVE_CEILING', projected: 3500 });
  // 1,000 spent: 1,000 + 150×10 = 2,500 <= 3,000.
  assert.equal(authority.agreementDecision(row, raise(150), { monthSpend: 1000, committedDailyMinor: 10000, daysLeft: 10 }).ok, true);
  assert.equal(authority.agreementDecision(row, raise(201), { monthSpend: 0, committedDailyMinor: 0, daysLeft: 1 }).why, 'ABOVE_DAILY');
  assert.equal(authority.agreementDecision(row, raise(150), null).why, 'SPEND_UNKNOWN', 'unknown spend means ask');
  assert.equal(authority.agreementDecision(row, raise(50), {}).ok, true, 'lowering a budget never needs the spend picture');
  const activate = { intent: 'ACTIVATE_BUNDLE', tenantId: '1', parameters: {}, review: { currency: 'ILS', adSets: [{ daily_budget: '15000' }] } };
  assert.equal(authority.agreementDecision(row, activate, { monthSpend: 2900, committedDailyMinor: 0, daysLeft: 2 }).why, 'ABOVE_CEILING');
  assert.equal(authority.agreementDecision({ ...row, policy_hash: 'x' }, raise(50), {}).ok, false, 'a tampered agreement authorizes nothing');

  // End to end: the real month spend comes from Meta and the agent asks instead of raising.
  setEnv();
  const { db, close } = await openDatabase();
  const fake = fakeMeta(94404, { campaigns: { 7703: { name: 'מגרשים', daily_budget: '10000' } }, monthSpend: 2990 });
  try {
    const wa = require('../workAgreement');
    const id = await owner(db, '972500944004', 94404);
    await agree(id, wa.PRESETS.all);
    const r = await wa.proposeOrAct(id, plan('CHANGE_BUDGET', 94404, '7703', { dailyBudget: '120' }));
    assert.equal(r.autonomous, false); assert.match(r.askWhy, /תקרת ההוצאה החודשית/);
    assert.equal(fake.posts.length, 0);
  } finally { fake.restore(); await close(); restoreEnv(); }
});

test('one tap stops all automatic actions, including one already authorized', async () => {
  setEnv();
  const { db, close } = await openDatabase();
  const fake = fakeMeta(94405, { campaigns: { 7704: { name: 'דירות', daily_budget: '10000' }, 7705: { name: 'משרדים', daily_budget: '10000' } } });
  try {
    const wa = require('../workAgreement'), authority = require('../scopedAuthority');
    const id = await owner(db, '972500944005', 94405);
    assert.match((await wa.handleText(id, 'עצור את כל הפעולות האוטומטיות')).text, /עוד לא הוגדר הסכם עבודה/);
    await agree(id, wa.PRESETS.protect);
    // Authorized by the agreement, then the owner stops everything before it runs.
    const approval = await require('../approvalEngine').createApprovalForClient(id, plan('PAUSE_CAMPAIGN', 94405, '7704'));
    assert.equal(await inCtx(id, () => authority.authorizeByAgreement(id, approval.actionPlan, {}, 'בדיקה')), true);
    assert.match((await wa.handleText(id, 'עצור את כל הפעולות האוטומטיות')).text, /עצרתי את כל הפעולות האוטומטיות/);
    const blocked = await inCtx(id, () => require('../actionExecutor').executeApprovedForClient(id, approval.actionPlan));
    assert.equal(blocked.ok, false); assert.equal(blocked.reason, 'SCOPED_AUTHORITY_BLOCKED');
    assert.equal(fake.posts.length, 0);
    const asked = await wa.proposeOrAct(id, plan('PAUSE_CAMPAIGN', 94405, '7705'));
    assert.equal(asked.autonomous, false); assert.match(asked.askWhy, /עצורות כרגע/);
    assert.equal((await authority.getAgreement(id)).paused, true);
    assert.match((await wa.handleText(id, 'הסכם עבודה')).leadingText, /הפעולות האוטומטיות עצורות/);
    assert.match((await wa.handleText(id, 'חדש את הפעולות האוטומטיות')).text, /חזרו לפעול/);
    const acted = await wa.proposeOrAct(id, plan('PAUSE_CAMPAIGN', 94405, '7705'));
    assert.equal(acted.autonomous, true); assert.equal(acted.ok, true);
    assert.deepEqual(fake.posts.map((p) => p.path), ['/7705']);
  } finally { fake.restore(); await close(); restoreEnv(); }
});

test('readiness is checked before any approval, in plain Hebrew with the next step', async () => {
  setEnv();
  const { db, close } = await openDatabase();
  const fake = fakeMeta(94406, { campaigns: { 7706: { name: 'דירות', daily_budget: '10000' } }, permissions: ['ads_read'] });
  try {
    const engine = require('../approvalEngine');
    const jargon = /READ_ONLY|ads_read|ads_management|act_|META_/;
    const none = await owner(db, '972500944006', 94406, { connected: false });
    let e = await engine.createApprovalForClient(none, plan('PAUSE_CAMPAIGN', 94406, '7706')).catch((x) => x);
    assert.equal(e.message, 'NOT_READY'); assert.match(e.reply, /לא מחובר/); assert.match(e.reply, /הצעד הבא/); assert.doesNotMatch(e.reply, jargon);
    const noAccount = await owner(db, '972500944007', 94406, { selected: false });
    e = await engine.createApprovalForClient(noAccount, plan('PAUSE_CAMPAIGN', 94406, '7706')).catch((x) => x);
    assert.match(e.reply, /עוד לא בחרת באיזה חשבון מודעות/); assert.doesNotMatch(e.reply, jargon);
    const readOnly = await owner(db, '972500944008', 94406);
    e = await engine.createApprovalForClient(readOnly, plan('PAUSE_CAMPAIGN', 94406, '7706')).catch((x) => x);
    assert.match(e.reply, /רק לראות נתונים/); assert.match(e.reply, /חבר הרשאת יצירת קמפיינים/); assert.doesNotMatch(e.reply, jargon);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM approvals WHERE client_id = ANY($1::bigint[])', [[none, noAccount, readOnly]])).rows[0].n, 0, 'no approval was offered');
    // The dashboard surfaces the same sentence.
    const r = await require('../dashboardApprovals').prepareCampaignAction(none, '7706', 'PAUSE').catch((x) => x);
    assert.ok(r.reply === undefined || /לא מחובר/.test(r.reply));
  } finally { fake.restore(); await close(); restoreEnv(); }
});

test('approvals expire by type and a new request never cancels a pending protective one', async () => {
  setEnv();
  const { db, close } = await openDatabase();
  const fake = fakeMeta(94409, { campaigns: { 7707: { name: 'א', daily_budget: '10000' }, 7708: { name: 'ב', daily_budget: '10000' } } });
  try {
    const engine = require('../approvalEngine'), wa = require('../workAgreement');
    const id = await owner(db, '972500944009', 94409);
    const minutes = (a) => (new Date(a.expiresAt) - Date.now()) / 60000;
    const pause = await engine.createApprovalForClient(id, plan('PAUSE_CAMPAIGN', 94409, '7707'));
    assert.ok(minutes(pause) > 11 * 60, 'protective: hours');
    const lower = await engine.createApprovalForClient(id, plan('CHANGE_BUDGET', 94409, '7708', { dailyBudget: '60' }));
    assert.ok(minutes(lower) > 11 * 60); assert.equal(wa.actionClass(lower.actionPlan), 'PROTECTIVE');
    const raise = await engine.createApprovalForClient(id, plan('CHANGE_BUDGET', 94409, '7707', { dailyBudget: '150' }));
    assert.ok(minutes(raise) <= 10.1 && minutes(raise) > 9, 'spending: a short window');
    assert.equal(wa.actionClass(raise.actionPlan), 'SPENDING');
    const status = async (a) => (await db.query('SELECT status FROM approvals WHERE client_id=$1 AND action_id=$2', [id, a.actionId])).rows[0].status;
    // The raise on campaign 7707 is related to the pause on 7707 and replaces it; the lower on 7708 stays.
    assert.equal(await status(lower), 'PENDING', 'an unrelated request did not cancel the pending protective approval');
    assert.equal(await status(pause), 'SUPERSEDED');
    const raise2 = await engine.createApprovalForClient(id, plan('CHANGE_BUDGET', 94409, '7708', { dailyBudget: '130' }));
    assert.equal(await status(raise), 'SUPERSEDED', 'a newer spending request replaces the older one');
    assert.equal(await status(raise2), 'PENDING');
    assert.equal((await db.query('SELECT action_class FROM approvals WHERE client_id=$1 AND action_id=$2', [id, lower.actionId])).rows[0].action_class, 'PROTECTIVE');
  } finally { fake.restore(); await close(); restoreEnv(); }
});

test('a tap on an expired button re-offers the same action with fresh numbers', async () => {
  setEnv();
  const { db, close } = await openDatabase();
  const fake = fakeMeta(94410, { campaigns: { 7709: { name: 'דירות 4 חדרים', daily_budget: '10000' } } });
  try {
    const engine = require('../approvalEngine'), ui = require('../conversationUi'), delivery = require('../whatsappDelivery');
    const id = await owner(db, '972500944010', 94410);
    const first = await engine.createApprovalForClient(id, plan('CHANGE_BUDGET', 94410, '7709', { dailyBudget: '150' }, 'הגדלת התקציב'));
    const card = await ui.prepareApproval(id, first, 'סיכום');
    const buttonId = card.interactivePayload.interactive.action.buttons[0].reply.id;
    // Another card arrives (so this one is no longer the current menu), the approval expires,
    // and meanwhile Meta's numbers changed.
    await ui.prepareChoices(id, 'שאלה אחרת', [{ title: 'כן', text: 'כן' }], 'guard_alert');
    await db.query("UPDATE approvals SET expires_at=NOW()-INTERVAL '1 minute' WHERE client_id=$1 AND action_id=$2", [id, first.actionId]);
    fake.objects.set('7709', { ...fake.objects.get('7709'), daily_budget: '9000' });
    const tap = { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: buttonId } } };
    const routed = await delivery.messageContext.run({ eventId: 'tap-1' }, async () => {
      const text = await ui.consumeEarlierApproval(id, tap);
      return { text, approved: delivery.messageContext.getStore().approvedActionId };
    });
    assert.equal(routed.text, '/approve-current ' + first.actionId, 'the expired button still reaches its own action');
    assert.equal(await ui.presentedApproval(id, first.actionId), true);
    const consumed = await engine.consumeActionForClient(id, first.actionId);
    assert.equal(consumed.reason, 'EXPIRED'); assert.equal(consumed.reofferable, true);
    const r = await inCtx(id, () => require('../dashboardApprovals').approve(id, first.actionId));
    assert.equal(r.reoffered, true); assert.match(r.reply, /בדקתי שוב את המספרים/);
    const fresh = (await db.query('SELECT payload FROM action_plans WHERE client_id=$1 AND id=$2', [id, r.actionId])).rows[0].payload;
    assert.equal(fresh.review.currentDailyBudgetMinor, '9000', 'fresh numbers from Meta');
    assert.equal(fresh.parameters.dailyBudgetMinor, 15000);
    assert.equal((await db.query('SELECT status FROM action_plans WHERE client_id=$1 AND id=$2', [id, first.actionId])).rows[0].status, 'CANCELLED');
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM approvals WHERE client_id=$1 AND status='PENDING'", [id])).rows[0].n, 1);
    assert.equal(fake.posts.length, 0, 'nothing ran without a fresh approval');
  } finally { fake.restore(); await close(); restoreEnv(); }
});

test('campaign creation ends with an explicit activation question and the cost line', async () => {
  setEnv();
  const { db, close } = await openDatabase();
  const fake = fakeMeta(94411, { campaigns: { 7710: { name: 'קמפיין חדש', status: 'PAUSED', effective_status: 'PAUSED' } }, adsets: { 8801: { campaign_id: '7710', name: 'קהל', daily_budget: '7000', targeting: { geo_locations: { countries: ['IL'] } } } }, ads: { 8802: { adset_id: '8801' } } });
  try {
    const wa = require('../workAgreement');
    const id = await owner(db, '972500944011', 94411);
    const created = plan('CREATE_BUNDLE', 94411, undefined);
    const offer = await wa.offerActivation(id, created, { objects: { campaignId: '7710', adsetIds: ['8801'], adIds: ['8802'] } });
    assert.ok(offer.approval, 'not authorized by an agreement: ask');
    assert.ok(offer.text.startsWith('הקמפיין מוכן ומושהה. להפעיל עכשיו?'));
    assert.match(offer.text, /כמה זה יעלה: עד 70 ₪ ליום/);
    const card = await require('../conversationUi').prepareApproval(id, offer.approval, offer.text);
    assert.deepEqual(card.interactivePayload.interactive.action.buttons.map((b) => b.reply.title), ['להפעיל עכשיו', 'לא עכשיו']);
    assert.match(card.interactivePayload.interactive.body.text, /להפעיל עכשיו\?/);
    const pending = await require('../dashboardApprovals').pending(id);
    assert.match(pending[0].summary, /^הקמפיין מוכן ומושהה. להפעיל עכשיו\?/); assert.equal(pending[0].startsSpending, true);
    assert.equal(fake.posts.length, 0, 'nothing activated without the answer');
    // An agreement that explicitly allows activation inside the ceiling acts and reports instead.
    await agree(id, { ...wa.PRESETS.all, activateNew: true });
    const auto = await wa.offerActivation(id, created, { objects: { campaignId: '7710', adsetIds: ['8801'], adIds: ['8802'] } });
    assert.equal(auto.autonomous, true); assert.match(auto.text, /עשיתי לבד/);
  } finally { fake.restore(); await close(); restoreEnv(); }
});

test('the same money action never runs twice, and an uncertain one is not retried', async () => {
  setEnv();
  const { db, close } = await openDatabase();
  const fake = fakeMeta(94412, { campaigns: { 7711: { name: 'דירות', daily_budget: '10000' }, 7712: { name: 'בתים', daily_budget: '10000' } } });
  try {
    const engine = require('../approvalEngine'), exec = require('../actionExecutor');
    const id = await owner(db, '972500944012', 94412);
    const run = async (p) => { const a = await engine.createApprovalForClient(id, p); const c = await engine.consumeActionForClient(id, a.actionId); assert.equal(c.ok, true); return inCtx(id, () => exec.executeApprovedForClient(id, c.approval.actionPlan)); };
    assert.equal((await run(plan('CHANGE_BUDGET', 94412, '7711', { dailyBudget: '150' }))).ok, true);
    const twice = await run(plan('CHANGE_BUDGET', 94412, '7711', { dailyBudget: '150' }));
    assert.equal(twice.reason, 'DUPLICATE_ACTION'); assert.match(twice.message, /לא ביצעתי אותה שוב/);
    assert.equal(fake.posts.length, 1, 'one write to Meta');
    // A previous change on 7712 ended uncertain: no new money action on it until checked.
    await db.query("INSERT INTO action_plans(id,client_id,intent,payload,status,plan_hash,account_id,connection_generation) VALUES('UNCERTAIN0001',$1,'CHANGE_BUDGET',$2::jsonb,'MANUAL_REVIEW','h','act_94412',0)", [id, JSON.stringify({ intent: 'CHANGE_BUDGET', target: { campaignId: '7712' }, parameters: { dailyBudget: '170' } })]);
    const stopped = await run(plan('CHANGE_BUDGET', 94412, '7712', { dailyBudget: '120' }));
    assert.equal(stopped.reason, 'DUPLICATE_ACTION'); assert.match(stopped.message, /לא הסתיים בוודאות/);
    // Pausing is safe to repeat even then.
    assert.equal((await run(plan('PAUSE_CAMPAIGN', 94412, '7712'))).ok, true);
    assert.equal(fake.posts.length, 2);
  } finally { fake.restore(); await close(); restoreEnv(); }
});

test('the owner always sees done, running, waiting, failed and actual spend', async () => {
  setEnv();
  const { db, close } = await openDatabase();
  try {
    const log = require('../activityLog');
    const id = (await db.query("INSERT INTO clients(phone) VALUES('972500944013') RETURNING id")).rows[0].id;
    const add = (pid, status, intent = 'PAUSE_CAMPAIGN') => db.query("INSERT INTO action_plans(id,client_id,intent,payload,status) VALUES($1,$2,$3,$4::jsonb,$5)", [pid, id, intent, JSON.stringify({ intent, target: { campaignName: 'דירות ' + pid } }), status]);
    await add('STAT00000001', 'VERIFIED'); await add('STAT00000002', 'APPROVED'); await add('STAT00000003', 'MANUAL_REVIEW', 'CHANGE_BUDGET');
    await add('STAT00000004', 'PROPOSED');
    await db.query("INSERT INTO approvals(client_id,action_id,code,expires_at,plan_hash) VALUES($1,'STAT00000004','c4',NOW()+INTERVAL '1 hour','h')", [id]);
    const s = await log.status(id, { spendLoader: async () => ({ today: 42, month: 870, currency: 'ILS', activeCampaigns: 2 }) });
    assert.equal(s.done.length, 1); assert.equal(s.waiting.length, 1); assert.equal(s.failed.length, 1);
    assert.deepEqual(s.running.map((x) => x.what), ['2 קמפיינים פעילים עכשיו', 'השהיית קמפיין: דירות STAT00000002 (בביצוע)']);
    assert.equal(s.spend.month, 870);
    const text = log.formatStatus(s);
    for (const part of ['מה עשיתי', 'מה רץ עכשיו', 'מחכה לאישור שלך', 'מה נכשל או נעצר', 'הוצאה בפועל', 'היום 42 ₪ · החודש 870 ₪']) assert.ok(text.includes(part), part);
    const r = await log.handleStatus(id, 'תמונת מצב');
    assert.match(r.reply, /הוצאה בפועל:\n {2}לא זמין כרגע/, 'without Meta it says so instead of a number');
    assert.equal(await log.handleStatus(id, 'שלום'), null);
  } finally { await close(); restoreEnv(); }
});
