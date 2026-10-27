'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('./helpers/database');

test('runtime can initialize without DDL when migrations are delegated to a separate role',async()=>{
 const prior=process.env.RUN_MIGRATIONS_ON_STARTUP;
 process.env.RUN_MIGRATIONS_ON_STARTUP='false';
 let h;
 try {
  h=await openDatabase();
  const before=await h.db.query("SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname='public'");
  assert.equal(before.rows[0].n,0);
  process.env.RUN_MIGRATIONS_ON_STARTUP='true';
  await h.db.initializeDatabase();
  const after=await h.db.query("SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname='public'");
  assert.ok(after.rows[0].n>0);
 } finally {
  if(h) await h.close();
  if(prior===undefined)delete process.env.RUN_MIGRATIONS_ON_STARTUP;
  else process.env.RUN_MIGRATIONS_ON_STARTUP=prior;
 }
});
