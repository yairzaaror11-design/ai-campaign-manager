'use strict';
// Operator-run rehearsal only. This script never connects to production as a restore target.
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function parseTarget(raw) {
  if (!raw) throw Error('ISOLATED_TARGET_REQUIRED');
  let url;
  try { url = new URL(raw); } catch { throw Error('INVALID_TARGET_URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw Error('INVALID_TARGET_PROTOCOL');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw Error('RESTORE_TARGET_MUST_BE_LOCAL');
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!/^campaign_bachat_restore_[a-z0-9_]+$/.test(database)) throw Error('RESTORE_TARGET_NAME_UNSAFE');
  if (!url.username) throw Error('TARGET_USER_REQUIRED');
  return url;
}
function pgEnv(url, base=process.env) {
  return {...base, PGHOST:url.hostname.replace(/^\\[|\\]$/g,''), PGPORT:url.port||'5432',
    PGUSER:decodeURIComponent(url.username), PGPASSWORD:decodeURIComponent(url.password),
    PGDATABASE:decodeURIComponent(url.pathname.slice(1))};
}
function execute(command,args,env) {
  const result=spawnSync(command,args,{env,stdio:['ignore','pipe','pipe'],encoding:'utf8',timeout:180000});
  if(result.error || result.status!==0) throw Error(command.toUpperCase().replace(/[^A-Z]/g,'_')+'_FAILED');
  return result.stdout.trim();
}
function verifyInputs({source,target,archive}) {
  if (!source) throw Error('SOURCE_REQUIRED');
  let sourceUrl;
  try {sourceUrl=new URL(source);} catch {throw Error('INVALID_SOURCE_URL');}
  if (!['postgres:','postgresql:'].includes(sourceUrl.protocol)) throw Error('INVALID_SOURCE_PROTOCOL');
  const targetUrl=parseTarget(target);
  // Host aliases can point at the same local PostgreSQL instance. Never dump and restore into the same DB.
  const loopback = host => ['localhost', '127.0.0.1', '[::1]'].includes(host);
  const sameHost = sourceUrl.hostname === targetUrl.hostname || (loopback(sourceUrl.hostname) && loopback(targetUrl.hostname));
  const samePort = (sourceUrl.port || '5432') === (targetUrl.port || '5432');
  if (sameHost && samePort && decodeURIComponent(sourceUrl.pathname) === decodeURIComponent(targetUrl.pathname)) throw Error('SOURCE_EQUALS_TARGET');
  if (!archive || !path.isAbsolute(archive)) throw Error('ABSOLUTE_ARCHIVE_PATH_REQUIRED');
  return {sourceUrl,targetUrl};
}
function run({source,target,archive,confirm}) {
  const {sourceUrl,targetUrl}=verifyInputs({source,target,archive});
  if (confirm!=='RESTORE_TO_ISOLATED_LOCAL_DATABASE') throw Error('EXPLICIT_REHEARSAL_CONFIRMATION_REQUIRED');
  if (fs.existsSync(archive)) throw Error('ARCHIVE_ALREADY_EXISTS');
  // The target database must already exist and be empty. No database creation or DROP is performed.
  const targetEnv=pgEnv(targetUrl);
  const count=execute('psql',['-X','-A','-t','-v','ON_ERROR_STOP=1','-c',
    "SELECT count(*) FROM pg_tables WHERE schemaname='public'"],targetEnv);
  if(count!=='0') throw Error('RESTORE_TARGET_NOT_EMPTY');
  execute('pg_dump',['--format=custom','--no-owner','--no-acl','--file',archive],pgEnv(sourceUrl));
  const digest=createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  execute('pg_restore',['--exit-on-error','--single-transaction','--no-owner','--no-acl','--dbname',
    decodeURIComponent(targetUrl.pathname.slice(1)),archive],targetEnv);
  const tables=Number(execute('psql',['-X','-A','-t','-v','ON_ERROR_STOP=1','-c',
    "SELECT count(*) FROM pg_tables WHERE schemaname='public'"],targetEnv));
  if(!Number.isSafeInteger(tables)||tables===0) throw Error('RESTORE_EMPTY_OR_INVALID');
  return {status:'RESTORE_VERIFIED_LOCALLY',archiveSha256:digest,restoredTableCount:tables,
    note:'Row-level verification and application migrations require separate rehearsal checks'};
}
if(require.main===module) {
  try {
    const result=run({source:process.env.BACKUP_SOURCE_DATABASE_URL,
      target:process.env.RESTORE_TARGET_DATABASE_URL,archive:process.env.BACKUP_ARCHIVE_PATH,
      confirm:process.env.RESTORE_CONFIRMATION});
    console.log(JSON.stringify(result));
  } catch(error) {
    console.error(/^[A-Z0-9_]+$/.test(error.message)?error.message:'BACKUP_RESTORE_REHEARSAL_FAILED');
    process.exitCode=1;
  }
}
module.exports={parseTarget,verifyInputs,run};
