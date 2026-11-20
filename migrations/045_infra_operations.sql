-- Infrastructure: AI cost attribution, operator alerts, job freshness and
-- the 7-day warning before an inactive marketing profile is deleted.
ALTER TABLE ai_usage DROP CONSTRAINT IF EXISTS ai_usage_kind_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_kind_check CHECK (kind IN ('text','analysis','image','video','transcription','system'));
-- What the call was for when it is not a customer's call (e.g. model_acceptance).
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS purpose TEXT CHECK (purpose IS NULL OR length(purpose) <= 60);
CREATE INDEX IF NOT EXISTS ai_usage_created ON ai_usage(created_at);

-- One row per alert key so the operator is told once, not every minute.
CREATE TABLE IF NOT EXISTS ops_alerts (
  key TEXT PRIMARY KEY CHECK (length(key) <= 200),
  status TEXT NOT NULL CHECK (status IN ('FAILING','OK','SENT')),
  detail TEXT CHECK (detail IS NULL OR length(detail) <= 500),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sent_at TIMESTAMPTZ
);

-- Last successful run of each background job, for the self-check.
CREATE TABLE IF NOT EXISTS job_runs (
  name TEXT PRIMARY KEY CHECK (length(name) <= 60),
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  detail JSONB
);

ALTER TABLE marketing_profiles ADD COLUMN IF NOT EXISTS retention_notice_at TIMESTAMPTZ;
