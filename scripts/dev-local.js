'use strict';
// Local development launcher: runs the real index.js against an embedded
// PostgreSQL (PGlite) stored in .local-dev/pgdata, with every outward effect off.
// No production credentials are read or needed.
const path = require('path');
const fs = require('fs');

const safe = {
  NODE_ENV: 'development',
  PORT: process.env.PORT || '3000',
  DATABASE_URL: 'postgresql://local-pglite.invalid/scorpio_dev',
  DB_SSL: 'false',
  READ_ONLY: 'true',
  META_WRITES_ENABLED: 'false',
  WHATSAPP_SEND_ENABLED: 'false',
  BILLING_ENABLED: 'false',
  TASK_AGENT_EVALUATE_ON_START: 'false',
  WHATSAPP_WORKER_IN_WEB: 'true',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info'
};
// Force the safety values: a local .env must not be able to turn effects on.
Object.assign(process.env, safe);

// Exported so the E2E launcher (e2e/server.js) can reuse the same safe wiring
// with its own throwaway data directory.
async function startLocal({ dataDir = path.join(__dirname, '..', '.local-dev', 'pgdata') } = {}) {
  const { PGlite } = require('@electric-sql/pglite');
  fs.mkdirSync(dataDir, { recursive: true });
  const pg = new PGlite(dataDir);
  await pg.waitReady;

  const { Pool } = require('pg');
  const execute = (sql, params = []) =>
    params.length ? pg.query(sql, params) : pg.exec(sql).then((r) => r.at(-1));
  // Same wiring as tests/helpers/database.js: plain queries run directly,
  // transactions run one at a time (PGlite has a single connection).
  let pending = Promise.resolve();
  const serial = (fn) => { const run = pending.then(fn); pending = run.catch(() => {}); return run; };
  Pool.prototype.query = execute;
  Pool.prototype.connect = async () => ({ query: execute, release() {} });
  Pool.prototype.end = async () => {};
  Pool.prototype.on = function () { return this; };

  const db = require('../db');
  db.query = execute;
  db.transaction = (work) => serial(async () => {
    await execute('BEGIN');
    try { const result = await work(execute); await execute('COMMIT'); return result; }
    catch (error) { await execute('ROLLBACK'); throw error; }
  });

  console.log(`[dev-local] embedded database at ${dataDir}; READ_ONLY, no Meta writes, no WhatsApp sends`);
  // index.js only self-starts when run directly, so call its exported start().
  return require('../index.js').start();
}

module.exports = { startLocal };

if (require.main === module) startLocal().catch((error) => {
  console.error('[dev-local] failed to start:', error);
  process.exit(1);
});
