-- "What I sell" (מה אני מוכר): one catalog per business, for every vertical.
-- Common columns here; vertical fields (e.g. real estate: deal type, city, rooms)
-- live in attributes and are defined by verticalProfiles.js. Leads and organic
-- posts may point to the item they belong to.
CREATE TABLE IF NOT EXISTS catalog_items (
  id UUID PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  vertical TEXT NOT NULL DEFAULT 'generic' CHECK (vertical IN ('real_estate','services','retail','fitness','generic')),
  kind TEXT NOT NULL DEFAULT 'ITEM' CHECK (kind ~ '^[A-Z_]{2,20}$'),
  title TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 160),
  price BIGINT CHECK (price IS NULL OR price BETWEEN 1 AND 2000000000),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  photo_media_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  consent_required BOOLEAN NOT NULL DEFAULT FALSE,
  owner_consent BOOLEAN NOT NULL DEFAULT FALSE,
  owner_consent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','PAUSED','SOLD_OUT','ENDED')),
  closed_reason TEXT CHECK (closed_reason IS NULL OR closed_reason ~ '^[A-Z_]{2,20}$'),
  closed_at TIMESTAMPTZ,
  campaign_task_id UUID,
  meta_campaign_id TEXT CHECK (meta_campaign_id IS NULL OR meta_campaign_id ~ '^[0-9]{1,40}$'),
  pause_action_id TEXT,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Where the vertical requires it (real estate), nothing is advertised without the owner's consent.
  CONSTRAINT catalog_items_active_needs_consent CHECK (status <> 'ACTIVE' OR NOT consent_required OR owner_consent)
);
CREATE INDEX IF NOT EXISTS catalog_items_client_status ON catalog_items(client_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS catalog_items_pause_action ON catalog_items(client_id, pause_action_id) WHERE pause_action_id IS NOT NULL;

-- Real photos are kept here (WhatsApp media references expire), small and per tenant.
CREATE TABLE IF NOT EXISTS catalog_item_photos (
  id UUID PRIMARY KEY,
  item_id UUID NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  bytes BYTEA NOT NULL CHECK (octet_length(bytes) BETWEEN 100 AND 6000000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS catalog_item_photos_item ON catalog_item_photos(client_id, item_id, created_at);

ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS catalog_item_id UUID REFERENCES catalog_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS crm_leads_catalog_item ON crm_leads(client_id, catalog_item_id) WHERE catalog_item_id IS NOT NULL;
ALTER TABLE organic_posts ADD COLUMN IF NOT EXISTS catalog_item_id UUID REFERENCES catalog_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS organic_posts_catalog_item ON organic_posts(client_id, catalog_item_id) WHERE catalog_item_id IS NOT NULL;
