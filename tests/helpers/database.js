'use strict';
const {PGlite}=require('@electric-sql/pglite');
async function openDatabase() {
 const pg=new PGlite();
 const db=require('../../db');
 const {Pool}=require('pg');
 const before={query:db.query,transaction:db.transaction,poolQuery:Pool.prototype.query,connect:Pool.prototype.connect};
 const execute=(sql,params=[])=>params.length?pg.query(sql,params):pg.exec(sql).then(r=>r.at(-1));
 Pool.prototype.query=execute;
 Pool.prototype.connect=async()=>({query:execute,release(){}});
 db.query=execute;
 let pending=Promise.resolve();
 db.transaction=work=>{
  const run=pending.then(async()=>{await execute('BEGIN');try {const result=await work(execute);await execute('COMMIT');return result;}catch(e){await execute('ROLLBACK');throw e;}});
  pending=run.catch(()=>{});return run;
 };
 process.env.DATABASE_URL='postgresql://test.invalid';
 process.env.DB_SSL='false';
 await db.initializeDatabase();
 return {db,pg,close:async()=>{await pending;await db.closeDatabase();db.query=before.query;db.transaction=before.transaction;Pool.prototype.query=before.poolQuery;Pool.prototype.connect=before.connect;await pg.close();}};
}
module.exports={openDatabase};
