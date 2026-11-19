CREATE TABLE IF NOT EXISTS ai_usage (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT REFERENCES clients(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('text','analysis','image','video','transcription')),
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cached_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_tokens >= 0),
  units NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (units >= 0),
  cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ai_usage_client_month ON ai_usage(client_id, created_at);
