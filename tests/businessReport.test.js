'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('./helpers/isolatedDatabase');
const report = require('../businessReport');

async function lead(db, client, status, { revenue = null, ageDays = 0 } = {}) {
  await db.query(`INSERT INTO crm_leads(id,client_id,name,source,status,revenue_minor,currency,created_at)
    VALUES(gen_random_uuid(),$1,'ליד','meta_lead_ads',$2,$3,$4,NOW()-make_interval(days=>$5))`,
    [client, status, revenue, revenue === null ? null : 'ILS', ageDays]);
}

test('the report connects spend to leads, meetings, sales and revenue', async () => {
  const { db, close } = await openDatabase();
  try {
    const client = (await db.query("INSERT INTO clients(phone) VALUES('972500000101') RETURNING id")).rows[0].id;
    await lead(db, client, 'NEW', { ageDays: 2 });
    await lead(db, client, 'NEW');
    await lead(db, client, 'CONTACTED');
    await lead(db, client, 'APPOINTMENT');
    await lead(db, client, 'WON', { revenue: 250000 });
    await lead(db, client, 'LOST');
    await lead(db, client, 'WON', { revenue: 100000, ageDays: 40 }); // outside the period
    const r = await report.build(client, 'last_7d', { spendFor: async () => 1200 });
    assert.deepEqual(r.funnel, { leads: 6, untouched: 2, staleUntouched: 1, contacted: 4, meetings: 2, won: 1, lost: 1, revenue: 2500 });
    assert.equal(r.metrics.costPerLead, 200);
    assert.equal(r.metrics.costPerCustomer, 1200);
    assert.ok(Math.abs(r.metrics.revenuePerShekel - 2500 / 1200) < 1e-9);
    assert.match(r.nextSteps[0], /1 לידים שמחכים יותר מיום/);
    const text = report.format(r);
    assert.match(text, /פניות: 6 \(₪200 לפנייה\)/);
    assert.match(text, /כל ₪1 בפרסום החזיר ₪2\.1/);
  } finally { await close(); }
});

test('no connected ad account and no leads still produce a useful report', async () => {
  const { db, close } = await openDatabase();
  try {
    const client = (await db.query("INSERT INTO clients(phone) VALUES('972500000102') RETURNING id")).rows[0].id;
    const text = await report.businessReport(client, 'last_7d', { spendFor: async () => null });
    assert.match(text, /אין חשבון מטא מחובר/);
    assert.match(text, /עוד אין (פניות|לידים)/);
    await assert.rejects(report.build(client, 'last_year'), /UNSUPPORTED_REPORT_PERIOD/);
  } finally { await close(); }
});

test('spend without leads points at the campaign', () => {
  const f = { leads: 0, untouched: 0, staleUntouched: 0, contacted: 0, meetings: 0, won: 0, lost: 0, revenue: 0 };
  assert.match(report.nextSteps(f, report.metrics(f, 500), 500)[0], /על פרסום אבל לא נכנסו לידים/);
});

test('outcomes are split by campaign and a better-closing campaign is suggested, not executed', async () => {
  const { db, close } = await openDatabase();
  try {
    const client = (await db.query("INSERT INTO clients(phone) VALUES('972500000103') RETURNING id")).rows[0].id;
    const add = (campaign, status, revenue = null) => db.query(`INSERT INTO crm_leads(id,client_id,name,source,status,campaign_id,revenue_minor,currency)
      VALUES(gen_random_uuid(),$1,'ליד','meta_lead_ads',$2,$3,$4,$5)`, [client, status, campaign, revenue, revenue === null ? null : 'ILS']);
    for (const s of ['WON', 'WON', 'CONTACTED', 'NEW']) await add('111', s, s === 'WON' ? 50000 : null);
    for (const s of ['LOST', 'NEW', 'CONTACTED', 'LOST']) await add('222', s);
    const spendFor = async () => ({ total: 800, campaigns: { 111: { name: 'מבצע קיץ', spend: 400 }, 222: { name: 'גיוס כללי', spend: 400 } } });
    const r = await report.build(client, 'last_7d', { spendFor });
    assert.equal(r.spend, 800);
    const summer = r.campaigns.find((c) => c.id === '111');
    assert.deepEqual([summer.leads, summer.won, summer.revenue, summer.costPerCustomer], [4, 2, 1000, 200]);
    assert.ok(r.nextSteps.some((s) => /״מבצע קיץ״ סוגר 50% מהלידים לעומת 0%/.test(s) && /בלי אישור שלך/.test(s)));
    const text = report.format(r);
    assert.match(text, /לפי קמפיין:/);
    assert.match(text, /מבצע קיץ: 4 פניות, 2 נסגרו/);
  } finally { await close(); }
});

test('the report says plainly when there is no sales data yet', () => {
  const f = { leads: 4, untouched: 4, staleUntouched: 0, contacted: 0, meetings: 0, won: 0, lost: 0, revenue: 0 };
  const text = report.format({ days: 7, funnel: f, spend: 100, metrics: report.metrics(f, 100), campaigns: [], nextSteps: ['x'] });
  assert.match(text, /עדיין לא להוכיח מאיזה קמפיין נוצרה הכנסה/);
});
