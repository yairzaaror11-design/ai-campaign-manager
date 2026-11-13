
    CREATE TABLE IF NOT EXISTS clients (
      id BIGSERIAL PRIMARY KEY,
      phone TEXT UNIQUE NOT NULL,
      display_name TEXT,
      meta_ad_account_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS conversation_messages (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user','assistant')),
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_conversation_client_created
      ON conversation_messages(client_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS action_plans (
      id TEXT PRIMARY KEY,
      client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      intent TEXT NOT NULL,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'PROPOSED',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS campaign_briefs (
      id UUID PRIMARY KEY,
      client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      payload JSONB NOT NULL,
      status TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_campaign_briefs_client_status
      ON campaign_briefs(client_id, status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS campaign_lifecycles (
      id UUID PRIMARY KEY,
      client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      payload JSONB NOT NULL,
      status TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_campaign_lifecycles_client ON campaign_lifecycles(client_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS campaign_journal (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      lifecycle_id UUID NOT NULL REFERENCES campaign_lifecycles(id),
      event JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS workflow_jobs (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      lifecycle_id UUID NOT NULL REFERENCES campaign_lifecycles(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('CREATE_PAUSED','ACTIVATE')),
      status TEXT NOT NULL DEFAULT 'PENDING',
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_error TEXT,
      locked_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(lifecycle_id, kind)
    );
    ALTER TABLE workflow_jobs ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE workflow_jobs ADD COLUMN IF NOT EXISTS last_error TEXT;
    CREATE INDEX IF NOT EXISTS idx_workflow_jobs_ready ON workflow_jobs(status, available_at, locked_until);
    CREATE TABLE IF NOT EXISTS mock_meta_objects (
      lifecycle_id UUID PRIMARY KEY REFERENCES campaign_lifecycles(id) ON DELETE CASCADE,
      client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      objects JSONB NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('PAUSED','ACTIVE')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS whatsapp_inbound_events (
      event_id TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','PROCESSING','DONE','MANUAL_REVIEW')),
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      locked_until TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_whatsapp_inbound_ready
      ON whatsapp_inbound_events(status, available_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_whatsapp_inbound_expired
      ON whatsapp_inbound_events(status, locked_until)
      WHERE status = 'PROCESSING';

    CREATE TABLE IF NOT EXISTS telnyx_inbound_messages (
      event_id TEXT PRIMARY KEY,
      message_id TEXT,
      from_number TEXT NOT NULL,
      to_number TEXT NOT NULL,
      message_text TEXT NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_telnyx_messages_expiry
      ON telnyx_inbound_messages(expires_at);

    CREATE TABLE IF NOT EXISTS approvals (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      action_id TEXT NOT NULL REFERENCES action_plans(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(client_id, code)
    );

    CREATE INDEX IF NOT EXISTS idx_approvals_lookup
      ON approvals(client_id, code, status);
  

    ALTER TABLE clients ADD COLUMN IF NOT EXISTS meta_generation BIGINT NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS campaign_local_drafts (
      id UUID PRIMARY KEY,
      client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      ad_account_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS meta_connections (
      client_id BIGINT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
      meta_user_id TEXT NOT NULL,
      token_ciphertext TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta_login_secrets (
      secret_hash TEXT PRIMARY KEY,
      client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      generation BIGINT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('INVITE','STATE')),
      binding_hash TEXT,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_meta_login_expiry ON meta_login_secrets(expires_at);
  
