'use strict';
const {PGlite}=require('@electric-sql/pglite');
// Stores may destructure these functions at module load. Keep the functions stable
// while routing them to the currently open fixture rather than a closed fixture.
let active=null;
function execute(sql,params=[]) {
 if(!active)throw Error('TEST_DATABASE_NOT_OPEN');
 return params.length?active.pg.query(sql,params):active.pg.exec(sql).then(r=>r.at(-1));
}
function transaction(work) {
 if(!active)throw Error('TEST_DATABASE_NOT_OPEN');
 const fixture=active;
 const run=fixture.pending.then(async()=>{await execute('BEGIN');try{const result=await work(execute);await execute('COMMIT');return result;}catch(e){await execute('ROLLBACK');throw e;}});
 fixture.pending=run.catch(()=>{});return run;
}
async function openDatabase() {
 if(active)throw Error('TEST_DATABASE_ALREADY_OPEN');
 const pg=new PGlite();
 active={pg,pending:Promise.resolve()};
 const db=require('../../db');
 const {Pool}=require('pg');
 const before={query:db.query,transaction:db.transaction,poolQuery:Pool.prototype.query,connect:Pool.prototype.connect};
 Pool.prototype.query=execute;
 Pool.prototype.connect=async()=>({query:execute,release(){}});
 db.query=execute;
 db.transaction=transaction;
 process.env.DATABASE_URL='postgresql://test.invalid';
 process.env.DB_SSL='false';
 await db.initializeDatabase();
 return {db,pg,close:async()=>{await active.pending;await db.closeDatabase();db.query=before.query;db.transaction=before.transaction;Pool.prototype.query=before.poolQuery;Pool.prototype.connect=before.connect;await pg.close();active=null;}};
}
module.exports={openDatabase};
