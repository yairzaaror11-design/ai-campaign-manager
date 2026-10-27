'use strict';
// Run only against the ephemeral PostgreSQL service used by GitHub Actions.
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const url = process.env.TEST_DATABASE_URL;
if (process.env.CI !== 'true' || process.env.RUN_ISOLATED_ROLE_TEST !== 'true' || !url) throw Error('ISOLATED_CI_ROLE_TEST_ONLY');
const db = new URL(url);
if (!['localhost', '127.0.0.1', '[::1]'].includes(db.hostname) || db.pathname !== '/campaign_test') throw Error('ISOLATED_TEST_DATABASE_REQUIRED');
const env = { ...process.env, PGHOST: '127.0.0.1', PGPORT: db.port || '5432', PGUSER: decodeURIComponent(db.username), PGPASSWORD: decodeURIComponent(db.password), PGDATABASE: 'campaign_test' };
function sql(statement, expectFailure = false) {
  const p = spawnSync('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement], { env, encoding: 'utf8', timeout: 15000 });
  if (p.error) throw Error('PSQL_EXECUTION_FAILED');
  if (expectFailure) { assert.notEqual(p.status, 0, 'unexpected privileged SQL success'); return; }
  if (p.status !== 0) throw Error('PSQL_TEST_FAILED');
  return p.stdout.trim();
}
const roles = ['scorpio_ci_runtime', 'scorpio_ci_migration', 'scorpio_ci_backup'];
const schema = 'scorpio_ci_permissions';
try {
  for (const role of roles) sql('CREATE ROLE ' + role + ' NOLOGIN NOCREATEDB NOCREATEROLE NOSUPERUSER');
  sql('CREATE SCHEMA ' + schema + ' AUTHORIZATION scorpio_ci_migration');
  sql('GRANT USAGE ON SCHEMA ' + schema + ' TO scorpio_ci_runtime, scorpio_ci_backup');
  sql('SET ROLE scorpio_ci_migration; CREATE TABLE ' + schema + '.probe(id integer PRIMARY KEY, value text); RESET ROLE');
  sql('GRANT SELECT, INSERT, UPDATE, DELETE ON ' + schema + '.probe TO scorpio_ci_runtime');
  sql('GRANT SELECT ON ' + schema + '.probe TO scorpio_ci_backup');
  sql("SET ROLE scorpio_ci_runtime; INSERT INTO " + schema + ".probe VALUES (1, 'synthetic'); RESET ROLE");
  assert.equal(sql('SET ROLE scorpio_ci_runtime; SELECT value FROM ' + schema + '.probe; RESET ROLE').split('\n')[0], 'synthetic');
  sql('SET ROLE scorpio_ci_runtime; CREATE TABLE ' + schema + '.forbidden(id int)', true);
  sql('SET ROLE scorpio_ci_runtime; CREATE DATABASE scorpio_forbidden', true);
  sql('SET ROLE scorpio_ci_runtime; CREATE ROLE scorpio_forbidden', true);
  assert.equal(sql('SET ROLE scorpio_ci_backup; SELECT value FROM ' + schema + '.probe; RESET ROLE').split('\n')[0], 'synthetic');
  sql("SET ROLE scorpio_ci_backup; INSERT INTO " + schema + ".probe VALUES (2, 'forbidden')", true);
  sql('SET ROLE scorpio_ci_migration; ALTER TABLE ' + schema + '.probe ADD COLUMN note text; RESET ROLE');
  console.log('Isolated Runtime/Migration/Backup role permissions: PASS');
} finally {
  try { sql('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); } catch {}
  for (const role of roles.reverse()) { try { sql('DROP ROLE IF EXISTS ' + role); } catch {} }
}
