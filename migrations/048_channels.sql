-- Channels: the agent publishes and collects leads itself.
-- 1. Organic posts published to the business's Facebook Page / Instagram account
--    (one row per post and network: idempotent, with the post id and link).
-- 2. Public landing pages per business and per catalog item (/p/<slug>).
-- 3. Measurement: Meta Pixel id per business and Conversions API events for
--    website leads (Lead) and closed deals (Purchase), deduplicated by event_id.
-- 4. More lead sources: a per-business authenticated webhook; every lead keeps
--    its source campaign / ad / item / UTM.
-- Idempotent: safe to run again.

CREATE TABLE IF NOT EXISTS business_channels (
  client_id BIGINT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  pixel_id TEXT CHECK (pixel_id IS NULL OR pixel_id ~ '^[0-9]{5,20}$'),
  webhook_id TEXT UNIQUE CHECK (webhook_id IS NULL OR webhook_id ~ '^wh[a-f0-9]{24}$'),
  webhook_secret_hash TEXT CHECK (webhook_secret_hash IS NULL OR webhook_secret_hash ~ '^[a-f0-9]{64}$'),
  webhook_rotated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE organic_posts ADD COLUMN IF NOT EXISTS autopublish_checked_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS organic_publications (
  post_id UUID NOT NULL REFERENCES organic_posts(id) ON DELETE CASCADE,
  network TEXT NOT NULL CHECK (network IN ('facebook','instagram')),
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PUBLISHING' CHECK (status IN ('PUBLISHING','PUBLISHED','FAILED','UNCERTAIN')),
  external_id TEXT CHECK (external_id IS NULL OR external_id ~ '^[0-9_]{1,80}$'),
  permalink TEXT CHECK (permalink IS NULL OR permalink ~ '^https://(www\.)?(facebook|instagram)\.com/'),
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 120),
  attempts INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, network)
);
CREATE INDEX IF NOT EXISTS organic_publications_client ON organic_publications(client_id, updated_at DESC);

-- Images Meta fetches by URL when publishing (Instagram requires a public image_url). Short-lived.
CREATE TABLE IF NOT EXISTS channel_media (
  id UUID PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png')),
  bytes BYTEA NOT NULL CHECK (octet_length(bytes) BETWEEN 16 AND 8000000),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS channel_media_expiry ON channel_media(expires_at);

ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'CUSTOM' CHECK (kind IN ('CUSTOM','BUSINESS','ITEM'));
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS catalog_item_id UUID REFERENCES catalog_items(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS landing_one_business_page ON landing_pages(client_id) WHERE kind='BUSINESS';
CREATE UNIQUE INDEX IF NOT EXISTS landing_one_item_page ON landing_pages(client_id, catalog_item_id) WHERE kind='ITEM';

ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS ad_id TEXT CHECK (ad_id IS NULL OR ad_id ~ '^[0-9]{1,40}$');
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS utm JSONB CHECK (utm IS NULL OR jsonb_typeof(utm) = 'object');
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS landing_page_id UUID REFERENCES landing_pages(id) ON DELETE SET NULL;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS measurement_consent BOOLEAN NOT NULL DEFAULT FALSE;

-- Conversions API events for website / webhook leads (lead ads use meta_crm_events).
CREATE TABLE IF NOT EXISTS meta_capi_events (
  lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('LEAD','PURCHASE')),
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  pixel_id TEXT NOT NULL CHECK (pixel_id ~ '^[0-9]{5,20}$'),
  event_id TEXT NOT NULL CHECK (event_id ~ '^[A-Za-z0-9:_-]{8,80}$'),
  event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_source_url TEXT CHECK (event_source_url IS NULL OR length(event_source_url) <= 500),
  -- Hashed identifiers plus browser ids; cleared once sent.
  user_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','SKIPPED','FAILED')),
  reason TEXT,
  attempts INT NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (lead_id, stage)
);
CREATE INDEX IF NOT EXISTS meta_capi_events_due ON meta_capi_events(available_at) WHERE status='PENDING';
