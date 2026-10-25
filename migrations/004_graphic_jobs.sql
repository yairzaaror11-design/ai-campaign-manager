CREATE TABLE IF NOT EXISTS graphic_jobs (
 id TEXT PRIMARY KEY,
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 status TEXT NOT NULL CHECK (status IN ('PROCESSING','COMPLETE','FAILED')),
 media_id UUID REFERENCES tenant_media(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_graphic_jobs_expiry ON graphic_jobs(expires_at);

-- Global usage counters contain no customer data and survive job expiry/deletion.
CREATE TABLE IF NOT EXISTS graphic_usage_counters (name TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0));
