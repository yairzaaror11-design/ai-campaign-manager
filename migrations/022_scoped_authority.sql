-- Additive, opt-in standing authority. Applied only after a separately approved release.
CREATE TABLE authority_mandates (
 id UUID PRIMARY KEY,
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 policy JSONB NOT NULL,
 policy_hash TEXT NOT NULL CHECK(length(policy_hash)=64),
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','REVOKED')),
 revision INTEGER NOT NULL DEFAULT 1,
 approved_by TEXT,
 approved_at TIMESTAMPTZ,
 revoked_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX authority_client_status ON authority_mandates(client_id,status,created_at);
CREATE TABLE authority_requests (
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 request_id UUID NOT NULL,
 fingerprint TEXT NOT NULL,
 mandate_id UUID NOT NULL REFERENCES authority_mandates(id) ON DELETE CASCADE,
 PRIMARY KEY(client_id,request_id)
);
CREATE TABLE authority_uses (
 action_id TEXT PRIMARY KEY REFERENCES action_plans(id) ON DELETE CASCADE,
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 mandate_id UUID NOT NULL REFERENCES authority_mandates(id),
 mandate_revision INTEGER NOT NULL,
 plan_hash TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX authority_use_count ON authority_uses(client_id,mandate_id);
CREATE TABLE authority_audit (
 id BIGSERIAL PRIMARY KEY,
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 mandate_id UUID NOT NULL REFERENCES authority_mandates(id) ON DELETE CASCADE,
 actor TEXT NOT NULL,
 event TEXT NOT NULL CHECK(event IN ('PROPOSED','APPROVED','REVOKED','ACTION_AUTHORIZED')),
 revision INTEGER NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
