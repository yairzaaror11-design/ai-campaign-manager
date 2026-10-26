CREATE TABLE dashboard_profiles (
 client_id BIGINT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
 display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120),
 locale TEXT NOT NULL DEFAULT 'he' CHECK(locale IN ('he','en','es','de','fr','pt')),
 avatar_png BYTEA CHECK(octet_length(avatar_png)<=1048576),
 revision INTEGER NOT NULL DEFAULT 1,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE dashboard_api_keys (
 id UUID PRIMARY KEY,
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 token_hash TEXT UNIQUE NOT NULL,
 prefix TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 scopes JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 expires_at TIMESTAMPTZ NOT NULL,
 last_used_at TIMESTAMPTZ,
 revoked_at TIMESTAMPTZ
);
CREATE INDEX dashboard_api_keys_client ON dashboard_api_keys(client_id,created_at DESC);
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
