const { Pool } = require('pg');
const { logger } = require('./logger');

let pool = null;
let ready = false;

function configured() {
  return !!process.env.DATABASE_URL;
}

function getPool() {
  if (!configured()) return null;

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === 'false'
        ? false
        : { rejectUnauthorized: true, ...(process.env.DB_CA_CERT ? { ca: process.env.DB_CA_CERT } : {}) },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });

    pool.on('error', (error) => {
      ready = false;
      logger.error('Database pool error', { code: typeof error.code === 'string' && /^[A-Z0-9_]{2,12}$/.test(error.code) ? error.code : 'POOL_ERROR' });
    });
  }

  return pool;
}

async function query(text, params = []) {
  const p = getPool();
  if (!p) throw Error('DATABASE_NOT_CONFIGURED');
  return p.query(text, params);
}

async function transaction(work) {
  const p = getPool();
  if (!p) throw Error('DATABASE_NOT_CONFIGURED');
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await work((sql, params = []) => client.query(sql, params));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) {
      logger.error('Database rollback failed', { code: typeof rollbackError.code === 'string' && /^[A-Z0-9_]{2,12}$/.test(rollbackError.code) ? rollbackError.code : 'ROLLBACK_ERROR' });
    }
    throw error;
  } finally { client.release(); }
}

async function initializeDatabase() {
  if (!configured()) {
    logger.warn('DATABASE_URL is not configured; persistent memory is disabled');
    ready = false;
    return false;
  }

  // Deployments using a least-privilege runtime role must run migrations separately.
  // Preserve existing startup behavior unless explicitly disabled after a migration job succeeds.
  if (process.env.RUN_MIGRATIONS_ON_STARTUP !== 'false') {
    await require('./migrate').migrate(transaction);
  }
  await query('SELECT 1');
  ready = true;
  logger.info('Database initialized');
  return true;
}

async function databaseStatus() {
  if (!configured()) return { configured: false, connected: false };
  try {
    await query('SELECT 1');
    ready = true;
    return { configured: true, connected: true };
  } catch {
    ready = false;
    return { configured: true, connected: false };
  }
}

async function closeDatabase() {
  if (pool) { const current = pool; pool = null; ready = false; await current.end(); }
}

function isReady() {
  return ready;
}

module.exports = {
  query,
  transaction,
  closeDatabase,
  initializeDatabase,
  databaseStatus,
  configured,
  isReady
};
