'use strict';
// Budget control from the dashboard: change a daily budget and duplicate a winner,
// both prepared as approvals and executed only through the explicit approve path.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const axios = require('axios');
const { openDatabase } = require('./helpers/isolatedDatabase');
const budget = require('../budgetControl');
const { formatActionPlan } = require('../actionPlan');

test('winners beat the account average on cost per sale, else cost per lead', () => {
  const rows = budget.markWinners([
    { id: '1', spend: 1000, leads: 20, won: 4 }, // ₪250 per sale
    { id: '2', spend: 1000, leads: 10, won: 1 },
    { id: '3', spend: 1000, leads: 5, won: 0 }
  ]);
  assert.equal(rows[0].winner.by, 'SALE'); // avg per sale 600
  assert.equal(rows[0].winner.cost, 250);
  assert.equal(rows[1].winner, undefined);
  assert.equal(rows[2].winner, undefined);
  const byLead = budget.markWinners([{ id: '1', spend: 300, leads: 10, won: 0 }, { id: '2', spend: 900, leads: 5, won: 0 }]);
  assert.equal(byLead[0].winner.by, 'LEAD'); // ₪30 vs avg ₪80
  assert.equal(byLead[1].winner, undefined);
  assert.equal(budget.markWinners([{ id: '1', spend: 300, leads: 10, won: 0 }])[0].winner, undefined, 'a single campaign is not a winner over itself');
});

test('the budget change card shows current vs new budget and the cost', () => {
  const text = formatActionPlan({ intent: 'CHANGE_BUDGET', summary: 'הגדלה', target: { accountId: 'act_1', campaignName: 'קיץ' }, parameters: { dailyBudget: '120', currency: 'ILS' }, review: { currency: 'ILS', currentDailyBudgetMinor: '10000' } });
  assert.match(text, /תקציב יומי: מ־100 ₪ ל־120 ₪ ליום/);
  assert.match(text, /עד 120 ₪ ליום · בערך 3,600 ₪ לחודש/);
  const resume = formatActionPlan({ intent: 'RESUME_CAMPAIGN', target: { accountId: 'act_1' }, parameters: {}, review: { currency: 'ILS', currentDailyBudgetMinor: '5000' } });
  assert.match(resume, /עד 50 ₪ ליום/, 'resume shows what it will cost');
  const dup = formatActionPlan({ intent: 'DUPLICATE_CAMPAIGN', target: { accountId: 'act_1' }, parameters: { dailyBudget: '150', currency: 'ILS' }, review: { currency: 'ILS', currentDailyBudgetMinor: '10000' } });
  assert.match(dup, /תקציב יומי לעותק: 150 ₪ \(במקור: 100 ₪\)/);
  assert.match(dup, /אחרי ההפעלה, עד 150 ₪ ליום/);
  assert.match(dup, /אישור הפעלה נפרד/);
});

test('dashboard budget change and winner duplicate run only through explicit approval', async (t) => {
  const env = { ...process.env };
  Object.assign(process.env, { META_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'), APPROVAL_HMAC_KEY: crypto.randomBytes(32).toString('hex'),
    META_APP_ID: '123', META_APP_SECRET: 'secret', META_LOGIN_CONFIG_ID: '456', APP_PUBLIC_URL: 'https://campaign.example' });
  const { db, close } = await openDatabase();
  const meta = require('../metaConnection');
  const dashboard = require('../dashboardApprovals');
  const originalGet = axios.get, originalPost = axios.post;
  // A tiny Meta: an ad-set-budget campaign (481), a campaign-budget winner (482) and a big one (483).
  const objects = new Map([
    ['act_481', { id: 'act_481', name: 'Budget Biz', currency: 'ILS', timezone_name: 'Asia/Jerusalem' }],
    ['481', { id: '481', account_id: '481', name: 'קהל אחד', status: 'ACTIVE', effective_status: 'ACTIVE', objective: 'OUTCOME_LEADS' }],
    ['4811', { id: '4811', account_id: '481', campaign_id: '481', name: 'set', daily_budget: '5000', effective_status: 'ACTIVE' }],
    ['482', { id: '482', account_id: '481', name: 'מנצח', status: 'ACTIVE', effective_status: 'ACTIVE', objective: 'OUTCOME_LEADS', daily_budget: '10000' }],
    ['4821', { id: '4821', account_id: '481', campaign_id: '482', effective_status: 'ACTIVE' }],
    ['48211', { id: '48211', account_id: '481', adset_id: '4821', effective_status: 'ACTIVE' }],
    ['48212', { id: '48212', account_id: '481', adset_id: '4821', effective_status: 'ACTIVE' }],
    ['483', { id: '483', account_id: '481', name: 'גדול', status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '10000' }]
  ]);
  const children = (id, edge) => [...objects.values()].filter((o) => edge === 'adsets' ? o.campaign_id === id : edge === 'ads' ? (o.adset_id && objects.get(o.adset_id)?.campaign_id === id) || o.campaign_ad === id : false);
  for (let i = 0; i < 4; i++) objects.set('4830' + i, { id: '4830' + i, account_id: '481', campaign_ad: '483', effective_status: 'ACTIVE' });
  let writes = 0, seq = 9000;
  axios.get = async (url) => {
    const path = url.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+/, '');
    if (path === '/me/permissions') return { data: { data: [{ permission: 'ads_management', status: 'granted' }] } };
    const [, id, edge] = path.split('/');
    if (edge) return { data: { data: children(id, edge) } };
    if (objects.has(id)) return { data: objects.get(id) };
    throw Object.assign(Error('not found'), { response: { data: { error: { code: 100 } } } });
  };
  axios.post = async (url, body) => {
    writes++;
    const fields = Object.fromEntries(body.entries());
    const [, id, edge] = url.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+/, '').split('/');
    if (edge === 'copies') {
      assert.equal(fields.deep_copy, 'true'); assert.equal(fields.status_option, 'PAUSED');
      const copy = String(++seq), set = String(++seq);
      objects.set(copy, { ...objects.get(id), id: copy, status: 'PAUSED', effective_status: 'PAUSED', name: objects.get(id).name + ' — עותק' });
      for (const s of children(id, 'adsets')) {
        objects.set(set, { ...s, id: set, campaign_id: copy, effective_status: 'PAUSED' });
        for (const ad of children(id, 'ads')) { const n = String(++seq); objects.set(n, { ...ad, id: n, adset_id: set, effective_status: 'PAUSED' }); }
      }
      return { data: { copied_campaign_id: copy } };
    }
    objects.set(id, { ...objects.get(id), ...fields });
    return { data: { success: true } };
  };
  try {
    const client = (await db.query("INSERT INTO clients(phone) VALUES('972500000481') ON CONFLICT(phone) DO UPDATE SET phone=EXCLUDED.phone RETURNING id")).rows[0].id;
    await db.query("INSERT INTO meta_connections(client_id,meta_user_id,token_ciphertext,app_id,expires_at) VALUES($1,'10481',$2,'123',NOW()+INTERVAL '1 hour') ON CONFLICT DO NOTHING", [client, meta.encrypt('token-481', client)]);
    await db.query("UPDATE clients SET meta_ad_account_id='act_481',meta_user_id='10481' WHERE id=$1", [client]);
    const inContext = (fn) => meta.context.run(String(client), fn);
    process.env.READ_ONLY = 'false'; process.env.META_WRITES_ENABLED = 'true';

    await t.test('ad-set budget: current vs new, prepared, nothing written until approved', async () => {
      const info = await inContext(() => budget.info(client, '481'));
      assert.equal(info.ok, true); assert.equal(info.level, 'ADSET'); assert.equal(info.currentDailyBudget, 50);
      const r = await inContext(() => budget.prepareBudgetChange(client, '481', 60));
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.match(r.summary, /מ־50 ₪ ל־60 ₪ ליום/);
      assert.match(r.summary, /💸 כמה זה יעלה: עד 60 ₪ ליום · בערך 1,800 ₪ לחודש/);
      assert.equal(writes, 0, 'preparing never writes to Meta');
      const done = await inContext(() => dashboard.approve(client, r.actionId));
      assert.equal(done.ok, true, done.reply);
      assert.equal(objects.get('4811').daily_budget, '6000');
      assert.equal(objects.get('481').daily_budget, undefined, 'the campaign itself is untouched');
      assert.equal((await inContext(() => budget.prepareBudgetChange(client, '481', 60))).ok, false, 'same budget is refused');
    });

    await t.test('the owner daily cap refuses the plan in Hebrew', async () => {
      await require('../spendCap').set(client, 55);
      const before = writes;
      const r = await inContext(() => budget.prepareBudgetChange(client, '482', 150));
      assert.equal(r.ok, false); assert.match(r.reply, /תקרת ההוצאה היומית/);
      assert.equal(writes, before);
      await require('../spendCap').clear(client);
    });

    await t.test('winner duplicate: paused deep copy with the new budget, activation is a separate approval', async () => {
      const tooBig = await inContext(() => budget.prepareDuplicate(client, '483', 100));
      assert.equal(tooBig.ok, false); assert.match(tooBig.reply, /עד 3/);
      const r = await inContext(() => budget.prepareDuplicate(client, '482', 150));
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.match(r.summary, /שכפול קמפיין \(מושהה\)/);
      const before = writes;
      const done = await inContext(() => dashboard.approve(client, r.actionId));
      assert.equal(done.ok, true, done.reply);
      const saved = (await db.query("SELECT execution_result FROM action_plans WHERE id=$1 AND client_id=$2", [r.actionId, client])).rows[0].execution_result;
      const copy = objects.get(saved.objects.campaignId);
      assert.equal(copy.status, 'PAUSED'); assert.equal(copy.daily_budget, '15000');
      assert.equal(objects.get('482').daily_budget, '10000', 'the original keeps its budget');
      assert.equal(saved.objects.adIds.length, 2);
      assert.equal(writes - before, 2, 'one copy and one budget write, no activation');
      const activation = await inContext(() => dashboard.prepareCampaignAction(client, saved.objects.campaignId, 'RESUME'));
      assert.equal(activation.ok, true, JSON.stringify(activation));
      const plan = (await db.query('SELECT intent,payload FROM action_plans WHERE id=$1', [activation.actionId])).rows[0];
      assert.equal(plan.intent, 'ACTIVATE_BUNDLE');
      assert.deepEqual(plan.payload.parameters.adIds, saved.objects.adIds);
      const pending = await dashboard.pending(client);
      assert.equal(pending.find((p) => p.actionId === activation.actionId).startsSpending, true);
      assert.match(pending.find((p) => p.actionId === activation.actionId).summary, /עד 150 ₪ ליום/);
    });
  } finally {
    axios.get = originalGet; axios.post = originalPost;
    for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
    Object.assign(process.env, env);
    await close();
  }
});
