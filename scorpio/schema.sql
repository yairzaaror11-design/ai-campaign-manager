-- Additive module schema; uses the existing clients tenant identity and dashboard CRM.
CREATE TABLE IF NOT EXISTS scorpio_versions(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE dashboard_leads ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE dashboard_leads ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS scorpio_business(client_id BIGINT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,payload JSONB NOT NULL DEFAULT '{}',revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS scorpio_notes(id UUID PRIMARY KEY,client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,lead_id UUID NOT NULL REFERENCES dashboard_leads(id) ON DELETE CASCADE,body TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS scorpio_notes_tenant ON scorpio_notes(client_id,lead_id);
CREATE TABLE IF NOT EXISTS scorpio_records(id UUID PRIMARY KEY,client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind IN ('campaign','post','appointment','ticket','notification','folder')),payload JSONB NOT NULL,revision INTEGER NOT NULL DEFAULT 1,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS scorpio_records_tenant ON scorpio_records(client_id,kind,updated_at DESC);
CREATE TABLE IF NOT EXISTS scorpio_assets(id UUID PRIMARY KEY,client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,name TEXT NOT NULL,mime TEXT NOT NULL,bytes BYTEA NOT NULL,folder_id UUID,payload JSONB NOT NULL DEFAULT '{}',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS scorpio_assets_tenant ON scorpio_assets(client_id,created_at DESC);
CREATE TABLE IF NOT EXISTS scorpio_connections(client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,provider TEXT NOT NULL,app_id TEXT NOT NULL,generation INTEGER NOT NULL DEFAULT 0,credentials TEXT,accounts JSONB NOT NULL DEFAULT '[]',account_id TEXT,expires_at TIMESTAMPTZ,last_sync_at TIMESTAMPTZ,snapshot JSONB,error_code TEXT,PRIMARY KEY(client_id,provider));
CREATE TABLE IF NOT EXISTS scorpio_oauth(state_hash TEXT PRIMARY KEY,client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,provider TEXT NOT NULL,binding_hash TEXT NOT NULL,actor_hash TEXT NOT NULL,app_id TEXT NOT NULL,generation INTEGER NOT NULL,verifier TEXT,expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS scorpio_plans(id UUID PRIMARY KEY,name TEXT NOT NULL,currency TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),interval TEXT NOT NULL CHECK(interval IN ('month','year')),credits INTEGER NOT NULL CHECK(credits>=0),limits JSONB NOT NULL DEFAULT '{}',active BOOLEAN NOT NULL DEFAULT TRUE,revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS scorpio_subscriptions(id UUID PRIMARY KEY,client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,plan_id UUID NOT NULL REFERENCES scorpio_plans(id),plan_snapshot JSONB NOT NULL,checkout_id TEXT UNIQUE,provider_id TEXT UNIQUE,status TEXT NOT NULL DEFAULT 'PENDING',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS scorpio_credits(id UUID PRIMARY KEY,client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,delta INTEGER NOT NULL,reason TEXT NOT NULL,external_id TEXT UNIQUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS scorpio_billing_events(event_id TEXT PRIMARY KEY,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS scorpio_ai_jobs(id UUID PRIMARY KEY,client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,kind TEXT NOT NULL,status TEXT NOT NULL,request_hash TEXT NOT NULL,asset_id UUID,output TEXT,error_code TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
-- The existing dashboard also writes leads. Increment revisions there as well so
-- edits from either surface invalidate stale module forms.
CREATE OR REPLACE FUNCTION scorpio_lead_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.revision := OLD.revision + 1; RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS scorpio_lead_revision_trigger ON dashboard_leads;
CREATE TRIGGER scorpio_lead_revision_trigger BEFORE UPDATE ON dashboard_leads FOR EACH ROW EXECUTE FUNCTION scorpio_lead_revision();
