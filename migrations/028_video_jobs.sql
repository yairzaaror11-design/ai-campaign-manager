-- Short ad videos are generated asynchronously: a WhatsApp request creates a job,
-- the background worker submits it to the provider, polls, and delivers the result.
CREATE TABLE IF NOT EXISTS video_jobs (
  id TEXT PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  prompt TEXT NOT NULL CHECK (char_length(prompt) BETWEEN 3 AND 2500),
  model_path TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds BETWEEN 3 AND 15),
  aspect_ratio TEXT NOT NULL CHECK (aspect_ratio IN ('9:16','1:1','16:9')),
  reference_media_id UUID REFERENCES tenant_media(id) ON DELETE SET NULL,
  provider_request_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SUBMITTED','DELIVERED','FAILED')),
  error_code TEXT,
  cost_usd NUMERIC(12,6),
  media_id UUID REFERENCES tenant_media(id) ON DELETE SET NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS video_jobs_open ON video_jobs(available_at) WHERE status IN ('PENDING','SUBMITTED');
CREATE INDEX IF NOT EXISTS video_jobs_client_month ON video_jobs(client_id, created_at);
