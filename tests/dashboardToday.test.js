'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('./helpers/isolatedDatabase');

test('today lists what needs the owner, most urgent first; approvals can be rejected from the dashboard', async () => {
  const { db, close } = await openDatabase();
  try {
    const feed = require('../dashboardFeed'), approvals = require('../dashboardApprovals'), crm = require('../crmService');
    const id = (await db.query("INSERT INTO clients(phone) VALUES('972500000451') RETURNING id")).rows[0].id;
    assert.deepEqual(await feed.today(id), [], 'a quiet business has nothing to do');
    const late = await crm.create(id, { name: 'דנה', phone: '0501111111' });
    await db.query("UPDATE crm_leads SET created_at=NOW()-INTERVAL '2 hours' WHERE id=$1", [late.id]);
    await crm.create(id, { name: 'חדש', phone: '0502222222' }); // under 15 minutes: not yet urgent
    const won = await crm.create(id, { name: 'סגור', phone: '0503333333' });
    await crm.update(id, won.id, { status: 'WON', version: won.version });
    const plan = { id: 'ABCDEF123456', intent: 'PAUSE_CAMPAIGN', summary: 'השהיה', target: { accountId: 'act_1', campaignId: '9' }, parameters: {} };
    await db.query("INSERT INTO action_plans(id,client_id,intent,payload,status,plan_hash,account_id,connection_generation) VALUES($1,$2,'PAUSE_CAMPAIGN',$3::jsonb,'PROPOSED','h','act_1',0)", [plan.id, id, JSON.stringify(plan)]);
    await db.query("INSERT INTO approvals(client_id,action_id,code,expires_at,plan_hash) VALUES($1,$2,'c',NOW()+INTERVAL '1 hour','h')", [id, plan.id]);
    const items = await feed.today(id);
    assert.deepEqual(items.map((x) => x.kind), ['APPROVAL', 'LEADS_WAITING', 'WON_NO_AMOUNT']);
    assert.match(items[1].text, /ליד אחד מחכה/);
    const pending = await approvals.pending(id);
    assert.equal(pending.length, 1); assert.equal(pending[0].startsSpending, false); assert.match(pending[0].summary, /נדרש אישור מפורש/);
    assert.match((await approvals.reject(id, plan.id)).reply, /בוטלה/);
    assert.equal((await approvals.pending(id)).length, 0);
    await assert.rejects(approvals.approve(id, "'; drop"), /INVALID_APPROVAL/);
    const setup = await feed.checklist(id);
    assert.equal(setup.total, 3); assert.equal(setup.done, 0);
    const t = await feed.trend(id, 14);
    assert.equal(t.series.length, 14); assert.equal(t.leads, 3); assert.equal(t.series.at(-1).spend, null, 'no Meta connection, no spend line');
  } finally { await close(); }
});
