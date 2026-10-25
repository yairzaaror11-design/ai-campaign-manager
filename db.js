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
        : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });

    pool.on('error', (error) => {
      ready = false;
      logger.error('Database pool error', { error: error.message });
    });
  }

  return pool;
}

async function query(text, params = []) {
  const p = getPool();
  if (!p) throw Error('DATABASE_NOT_CONFIGURED');
  return p.query(text, params);
}

async function initializeDatabase() {
  if (!configured()) {
    logger.warn('DATABASE_URL is not configured; persistent memory is disabled');
    ready = false;
    return false;
  }

  const schema = `
    CREATE TABLE IF NOT EXISTS clients (
      id BIGSERIAL PRIMARY KEY,
      phone TEXT UNIQUE NOT NULL,
      display_name TEXT,
      meta_ad_account_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS conversation_messages (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user','assistant')),
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_conversation_client_created
      ON conversation_messages(client_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS action_plans (
      id TEXT PRIMARY KEY,
      client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      intent TEXT NOT NULL,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'PROPOSED',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS campaign_briefs (
      id UUID PRIMARY KEY,
      client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      payload JSONB NOT NULL,
      status TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_campaign_briefs_client_status
      ON campaign_briefs(client_id, status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS approvals (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      action_id TEXT NOT NULL REFERENCES action_plans(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(client_id, code)
    );

    CREATE INDEX IF NOT EXISTS idx_approvals_lookup
      ON approvals(client_id, code, status);
  `;

  await query(schema);
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

function isReady() {
  return ready;
}

module.exports = {
  query,
  initializeDatabase,
  databaseStatus,
  configured,
  isReady
};
