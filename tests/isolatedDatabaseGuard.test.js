'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('new native integration harness rejects production, remote and ambiguous targets before database initialization',async()=>{
 const env={...process.env},db=require('../db'),before=db.initializeDatabase;let calls=0;
 db.initializeDatabase=async()=>{calls++;throw Error('FIXTURE_INITIALIZE_ONLY');};
 try{
  for(const target of ['postgresql://fixture:fixture@production.example/scorpio_test','postgresql://fixture:fixture@127.0.0.1/production','postgresql://fixture:fixture@localhost/campaign_test_production','https://localhost/scorpio_test','postgresql://localhost/scorpio_test%2Fproduction']){
   process.env.TEST_DATABASE_URL=target;await assert.rejects(require('./helpers/isolatedDatabase').openDatabase(),/ISOLATED_TEST_DATABASE_REQUIRED/);
  }
  assert.equal(calls,0);process.env.TEST_DATABASE_URL='postgresql://fixture:fixture@127.0.0.1/bot_tests';await assert.rejects(require('./helpers/isolatedDatabase').openDatabase(),/FIXTURE_INITIALIZE_ONLY/);assert.equal(calls,1);
 }finally{db.initializeDatabase=before;for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);}
});
