CREATE TABLE model_acceptance_cache (
  service TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  result JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
