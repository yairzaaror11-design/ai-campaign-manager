CREATE TABLE IF NOT EXISTS marketing_profiles (
  client_id BIGINT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS marketing_profiles_updated ON marketing_profiles(updated_at);
