'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('./helpers/isolatedDatabase');

test('five interrupted lead claims exhaust the queue without duplicating a saved lead', async () => {
  const { db, close } = await openDatabase();
  const importer = require('../metaLeadImport');
  const graph = require('../metaConnection');
  const forms = require('../metaLeadForms');
  const crm = require('../crmService');
  const original = { query: db.query, graph: graph.graph, pageAccess: forms.pageAccess, app: process.env.META_APP_ID };
  try {
    process.env.META_APP_ID = '123';
    const client = (await db.query("INSERT INTO clients(phone) VALUES('972500000099') RETURNING id,meta_generation")).rows[0];
    await db.query("INSERT INTO meta_lead_sources VALUES('20','10',$1,$2,'123')",[client.id,client.meta_generation]);
    const event = {entry:[{id:'10',changes:[{field:'leadgen',value:{page_id:'10',form_id:'20',leadgen_id:'30'}}]}]};
    await importer.enqueue(event);
    forms.pageAccess = async () => ({token:'fixture',connection:client});
    let requests = 0;
    graph.graph = async () => {
      requests++;
      return {id:'30',form_id:'20',field_data:[{name:'email',values:['lead@example.test']}]};
    };

    // Lose both completion writes, as when the process disappears after saving CRM.
    db.query = (sql, args) => {
      if (sql.startsWith('UPDATE meta_lead_events SET status=')) throw Error('interrupted');
      return original.query(sql,args);
    };
    for (let attempt=1;attempt<=5;attempt++) {
      await assert.rejects(importer.runOne(), /interrupted/);
      const result = await db.query("SELECT attempts,status FROM meta_lead_events WHERE lead_id='30'");
      assert.deepEqual(result.rows,[{attempts:attempt,status:'PENDING'}]);
      await db.query("UPDATE meta_lead_events SET available_at=NOW() WHERE lead_id='30'");
    }
    await importer.runOne();
    await importer.enqueue(event);
    await importer.runOne();
    const result = await db.query("SELECT attempts,status FROM meta_lead_events WHERE lead_id='30'");
    assert.deepEqual(result.rows,[{attempts:5,status:'FAILED'}]);
    assert.equal(requests,1);
    assert.equal((await crm.list(client.id)).length,1);
  } finally {
    db.query = original.query;
    graph.graph = original.graph;
    forms.pageAccess = original.pageAccess;
    if (original.app === undefined) delete process.env.META_APP_ID;
    else process.env.META_APP_ID = original.app;
    await close();
  }
});
