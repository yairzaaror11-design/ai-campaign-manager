'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createActionPlan, formatActionPlan } = require('../actionPlan'), { strictPlan } = require('../approvalPolicy');
const base = (variants) => createActionPlan({ intent: 'CREATE_BUNDLE', target: { accountId: 'act_1' }, parameters: { name: 'Leads', objective: 'OUTCOME_LEADS', dailyBudget: 30, dailyBudgetMinor: 3000, currency: 'ILS', pageId: '555', link: 'https://business.example', message: 'נמאס לחפש?', headline: 'דירה בלי עמלה', imageHash: 'abc', ...(variants ? { variants } : {}),
  adSets: [{ name: 'A', dailyBudget: 30, dailyBudgetMinor: 3000, currency: 'ILS', billingEvent: 'IMPRESSIONS', optimizationGoal: 'LINK_CLICKS', targeting: { geo_locations: { countries: ['IL'] } }, startTime: '2026-12-01T09:00:00Z' }] } });

test('a bundle may carry up to two genuinely different extra angles', () => {
  const plan = base([{ headline: '200 משפחות מרוצות', message: 'תשאלו את השכנים' }, { headline: 'ייעוץ ראשון חינם', message: 'השאירו פרטים' }]);
  strictPlan(plan);
  const text = formatActionPlan(plan);
  assert.match(text, /גרסה 2: 200 משפחות מרוצות/); assert.match(text, /גרסה 3: ייעוץ ראשון חינם/); assert.match(text, /3 הגרסאות/);
});
test('too many, malformed or duplicate variants are rejected', () => {
  const v = { headline: 'x', message: 'y' };
  assert.throws(() => strictPlan(base([v, { ...v, headline: 'z' }, { ...v, headline: 'w' }])), /INVALID_AD_VARIANTS/);
  assert.throws(() => strictPlan(base([{ headline: 'x' }])), /INVALID_AD_VARIANTS/);
  assert.throws(() => strictPlan(base([{ ...v, imageHash: 'other' }])), /INVALID_AD_VARIANTS/);
  assert.throws(() => strictPlan(base([{ headline: 'דירה בלי עמלה', message: 'נמאס לחפש?' }])), /DUPLICATE_AD_VARIANT/);
  strictPlan(base());
});

test('verification checks every ad of every angle in every ad set', async () => {
  const meta = require('../metaConnection');
  const graph = meta.graph, credentials = meta.credentials;
  const plan = base([{ headline: 'ב', message: 'ב' }, { headline: 'ג', message: 'ג' }]);
  const objects = { campaignId: '10', creativeId: '20', creativeIds: ['20', '21', '22'], adsetIds: ['30'], adIds: ['40', '41', '42'] };
  const db = { '10': { id: '10', account_id: '1', status: 'PAUSED', name: 'Leads', objective: 'OUTCOME_LEADS' }, '20': { account_id: '1' }, '21': { account_id: '1' }, '22': { account_id: '1' },
    '30': { account_id: '1', status: 'PAUSED', campaign_id: '10', daily_budget: '3000' }, '40': { account_id: '1', status: 'PAUSED', adset_id: '30', creative: { id: '20' } }, '41': { account_id: '1', status: 'PAUSED', adset_id: '30', creative: { id: '21' } }, '42': { account_id: '1', status: 'PAUSED', adset_id: '30', creative: { id: '22' } } };
  meta.credentials = async () => ({ token: 't' });
  meta.graph = async (path) => db[path.slice(1)];
  try {
    const verify = (o) => meta.context.run('1', () => require('../metaVerify').verifyAction(plan, { id: '10', objects: o }));
    assert.equal((await verify(objects)).verified, true);
    assert.equal((await verify({ ...objects, adIds: ['40', '42', '41'] })).verified, false, 'angle/ad mismatch');
    assert.equal((await verify({ ...objects, creativeIds: ['20', '21'], adIds: ['40', '41'] })).verified, false, 'missing angle');
  } finally { meta.graph = graph; meta.credentials = credentials; }
});
