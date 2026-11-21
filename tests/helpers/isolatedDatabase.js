'use strict';
// Native PostgreSQL in CI/rehearsal, embedded PostgreSQL for a focused offline run.
async function openDatabase(){
 if(!process.env.TEST_DATABASE_URL)return require('./database').openDatabase();
 const target=new URL(process.env.TEST_DATABASE_URL);
 if(!['postgres:','postgresql:'].includes(target.protocol)||!['localhost','127.0.0.1','[::1]'].includes(target.hostname)||!['bot_tests','campaign_test','scorpio_test'].includes(decodeURIComponent(target.pathname.slice(1))))throw Error('ISOLATED_TEST_DATABASE_REQUIRED');
 process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;process.env.DB_SSL='false';
 const db=require('../../db');await db.initializeDatabase();return{db,native:true,close:()=>db.closeDatabase()};
}
module.exports={openDatabase};
