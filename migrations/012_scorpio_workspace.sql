-- Additive tenant-owned workspace records; existing campaign and integration tables are unchanged.
CREATE TABLE workspace_items (
 id UUID PRIMARY KEY,
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('products','content','tasks','expenses')),
 payload JSONB NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX workspace_client_kind ON workspace_items(client_id,kind,created_at DESC,id DESC);
CREATE TABLE workspace_requests (
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 request_id UUID NOT NULL,
 fingerprint TEXT NOT NULL,
 result JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(client_id,request_id)
);
