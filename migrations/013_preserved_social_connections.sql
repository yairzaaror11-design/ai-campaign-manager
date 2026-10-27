-- Preserve the existing feature/dashboard-rtl social integration model.
CREATE TABLE social_connections (
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 provider TEXT NOT NULL CHECK(provider IN ('facebook','instagram','linkedin','tiktok','youtube','x')),
 generation INTEGER NOT NULL DEFAULT 0,
 app_id TEXT,
 token_ciphertext TEXT,
 external_id TEXT,
 display_name TEXT,
 scopes TEXT NOT NULL DEFAULT '',
 accounts JSONB NOT NULL DEFAULT '[]',
 expires_at TIMESTAMPTZ,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(client_id,provider)
);
CREATE TABLE social_oauth_states (
 state_hash TEXT PRIMARY KEY,
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 provider TEXT NOT NULL,
 generation INTEGER NOT NULL,
 app_id TEXT NOT NULL,
 binding_hash TEXT NOT NULL,
 account_hash TEXT,
 verifier_ciphertext TEXT,
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX social_oauth_states_expiry ON social_oauth_states(expires_at);

