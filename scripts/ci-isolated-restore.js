'use strict';
// Ephemeral CI-only PostgreSQL backup/restore exercise with synthetic data.
// Does not read DATABASE_URL, production credentials, or customer tables.
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const base = process.env.TEST_DATABASE_URL;
if (!base || !process.env.CI || process.env.RUN_ISOLATED_RESTORE_REHEARSAL !== 'true') {
  throw Error('ISOLATED_CI_RESTORE_ONLY');
}
const parsed = new URL(base);
if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) throw Error('LOCAL_DB_REQUIRED');
if (parsed.pathname !== '/campaign_test') throw Error('TEST_DATABASE_REQUIRED');
const env = { ...process.env, PGHOST: '127.0.0.1', PGPORT: parsed.port || '5432', PGUSER: decodeURIComponent(parsed.username), PGPASSWORD: decodeURIComponent(parsed.password) };
const source = 'campaign_bachat_rehearsal_source';
const target = 'campaign_bachat_restore_ci';
function run(command, args, db = 'postgres') {
  const result = spawnSync(command, args, { env: { ...env, PGDATABASE: db }, encoding: 'utf8', timeout: 30000 });
  if (result.error || result.status !== 0) throw Error(command + '_FAILED: ' + (result.error?.code || result.status));
  if (command === 'pg_dump' || command === 'pg_restore') console.log(command + ': PASS');
  return result.stdout.trim();
}
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpio-restore-'));
fs.chmodSync(tmp, 0o700);
const archive = path.join(tmp, 'test.dump');
try {
  run('createdb', [source]);
  run('createdb', [target]);
  run('psql', ['-v', 'ON_ERROR_STOP=1', '-c', 'CREATE TABLE restore_probe (id integer PRIMARY KEY, payload text NOT NULL); INSERT INTO restore_probe VALUES (1, \'synthetic-only\');'], source);
  run('pg_dump', ['--format=custom', '--file=' + archive, source]);
  run('pg_restore', ['--exit-on-error', '--single-transaction', '--dbname=' + target, archive]);
  const result = run('psql', ['-At', '-c', 'SELECT payload FROM restore_probe WHERE id=1'], target);
  assert.equal(result, 'synthetic-only');
  console.log('Restored synthetic data comparison: PASS');
  console.log('Isolated synthetic pg_dump/pg_restore rehearsal: PASS');
} finally {
  try { run('dropdb', ['--if-exists', '--force', target]); } catch {}
  try { run('dropdb', ['--if-exists', '--force', source]); } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });
}
