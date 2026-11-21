-- Meta connection health per business: granted / declined permissions (from
-- GET /me/permissions), token and data-access expiry (from debug_token), last
-- successful sync, revocation, owner notices, and the assets the owner chose
-- (Facebook Page and Instagram professional account; the ad account stays in
-- clients.meta_ad_account_id and the Pixel in business_channels.pixel_id).
-- No tokens are stored here. Idempotent: safe to run again.
CREATE TABLE IF NOT EXISTS meta_auth_state (
  client_id BIGINT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED','EXPIRED','DISCONNECTED')),
  reason TEXT CHECK (reason IS NULL OR reason ~ '^[A-Z_]{1,60}$'),
  granted JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(granted) = 'array'),
  declined JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(declined) = 'array'),
  token_expires_at TIMESTAMPTZ,
  data_access_expires_at TIMESTAMPTZ,
  last_check_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  expiry_notice_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_notice_at TIMESTAMPTZ,
  page_id TEXT CHECK (page_id IS NULL OR page_id ~ '^[0-9]{1,30}$'),
  page_name TEXT CHECK (page_name IS NULL OR length(page_name) <= 200),
  instagram_id TEXT CHECK (instagram_id IS NULL OR instagram_id ~ '^[0-9]{1,30}$'),
  instagram_username TEXT CHECK (instagram_username IS NULL OR length(instagram_username) <= 100),
  pixel_name TEXT CHECK (pixel_name IS NULL OR length(pixel_name) <= 200),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS meta_auth_state_status ON meta_auth_state(status);
