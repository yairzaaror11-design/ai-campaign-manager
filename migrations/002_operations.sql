ALTER TABLE action_plans ADD COLUMN IF NOT EXISTS plan_hash TEXT;
ALTER TABLE action_plans ADD COLUMN IF NOT EXISTS account_id TEXT;
ALTER TABLE action_plans ADD COLUMN IF NOT EXISTS connection_generation BIGINT;
ALTER TABLE action_plans ADD COLUMN IF NOT EXISTS execution_result JSONB;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS plan_hash TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS meta_user_id TEXT;
UPDATE clients c SET meta_user_id=m.meta_user_id FROM meta_connections m WHERE c.id=m.client_id AND c.meta_user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_client_meta_user ON clients(meta_user_id);
CREATE TABLE IF NOT EXISTS tenant_audit (
 id BIGSERIAL PRIMARY KEY,
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 action_id TEXT,
 event TEXT NOT NULL,
 result TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS whatsapp_contacts (
 phone TEXT PRIMARY KEY,
 last_inbound_at TIMESTAMPTZ NOT NULL,
 opted_in BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS whatsapp_outbox (
 id UUID PRIMARY KEY,
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 dedupe_key TEXT UNIQUE NOT NULL,
 recipient TEXT NOT NULL,
 payload JSONB NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','SENT','DELIVERED','READ','FAILED','UNKNOWN','BLOCKED')),
 provider_id TEXT UNIQUE,
 error_code TEXT,
 lease_until TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS whatsapp_receipts (
 event_hash TEXT PRIMARY KEY,
 provider_id TEXT NOT NULL,
 status TEXT NOT NULL,
 error_code TEXT,
 provider_timestamp BIGINT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS api_rate_limits (
 bucket TEXT PRIMARY KEY,
 attempts INTEGER NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS deletion_receipts (
 code_hash TEXT PRIMARY KEY,
 status TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outbox_ready ON whatsapp_outbox(status,created_at);
CREATE TABLE IF NOT EXISTS meta_execution_attempts (
 action_id TEXT PRIMARY KEY REFERENCES action_plans(id) ON DELETE CASCADE,
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 status TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS deleted_client_guards (
 phone_digest TEXT PRIMARY KEY,
 deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS tenant_media (
 id UUID PRIMARY KEY,
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 whatsapp_media_id TEXT NOT NULL,
 media_type TEXT NOT NULL,
 mime_type TEXT NOT NULL,
 caption TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS performance_snapshots (
 id UUID PRIMARY KEY,
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL,
 date_preset TEXT NOT NULL,
 payload JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS worker_heartbeats (
 worker_id UUID PRIMARY KEY,
 role TEXT NOT NULL,
 last_success_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_brief_per_client ON campaign_briefs(client_id) WHERE status IN ('COLLECTING','REVIEW');
