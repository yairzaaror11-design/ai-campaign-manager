'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseTarget,verifyInputs,run}=require('../scripts/backup-restore-rehearsal');

test('restore target must be local and clearly isolated',()=>{
  assert.equal(parseTarget('postgresql://operator:secret@localhost:5432/campaign_bachat_restore_ci').hostname,'localhost');
  for(const target of [
    'postgresql://operator:secret@production.example/campaign_bachat_restore_ci',
    'postgresql://operator:secret@127.0.0.1/campaign_bachat',
    'postgresql://operator:secret@localhost/postgres',
    'https://operator:secret@localhost/campaign_bachat_restore_ci',
    'postgresql://operator:secret@localhost/campaign_bachat_restore_ci;DROP',
    ''
  ]) assert.throws(()=>parseTarget(target));
});
test('source and target must be distinct and archive path absolute',()=>{
  const source='postgresql://operator:secret@localhost/campaign_bachat_restore_ci';
  assert.throws(()=>verifyInputs({source,target:source,archive:'/tmp/restore.dump'}),/SOURCE_EQUALS_TARGET/);
  assert.throws(()=>verifyInputs({source:'postgresql://user:pass@db.example/live',target:source,archive:'relative.dump'}));
  assert.doesNotThrow(()=>verifyInputs({source:'postgresql://user:pass@db.example/live',
    target:'postgresql://operator:secret@127.0.0.1/campaign_bachat_restore_ci',archive:'/tmp/restore.dump'}));
});
test('rehearsal cannot start without explicit confirmation',()=>{
  assert.throws(()=>run({source:'postgresql://user:pass@db.example/live',
    target:'postgresql://operator:secret@127.0.0.1/campaign_bachat_restore_ci',
    archive:'/tmp/restore.dump'}),/EXPLICIT_REHEARSAL_CONFIRMATION_REQUIRED/);
});

test('restore refuses the same database via loopback host aliases and default port',()=>{
 const a='postgresql://operator:secret@localhost:5432/campaign_bachat_restore_ci';
 const b='postgresql://operator:secret@127.0.0.1/campaign_bachat_restore_ci';
 assert.throws(()=>verifyInputs({source:a,target:b,archive:'/tmp/rehearsal.dump'}),/SOURCE_EQUALS_TARGET/);
 assert.throws(()=>verifyInputs({source:b,target:a,archive:'/tmp/rehearsal.dump'}),/SOURCE_EQUALS_TARGET/);
 assert.doesNotThrow(()=>verifyInputs({source:a,target:'postgresql://operator:secret@127.0.0.1:5433/campaign_bachat_restore_ci',archive:'/tmp/rehearsal.dump'}));
});
