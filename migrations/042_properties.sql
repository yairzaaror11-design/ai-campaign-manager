-- Properties (נכסים) for real-estate brokerage offices: each listing the broker
-- advertises, its real photos, the property owner's consent to advertise and the
-- broker license number every ad must show. Leads and organic posts may point
-- to the property they belong to.
CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  deal_type TEXT CHECK (deal_type IS NULL OR deal_type IN ('SALE','RENT')),
  property_kind TEXT NOT NULL DEFAULT 'APARTMENT' CHECK (property_kind IN ('APARTMENT','GARDEN','PENTHOUSE','DUPLEX','HOUSE','OFFICE','STORE','LAND','OTHER')),
  address TEXT NOT NULL DEFAULT '' CHECK (length(address) <= 200),
  city TEXT NOT NULL DEFAULT '' CHECK (length(city) <= 80),
  neighbourhood TEXT NOT NULL DEFAULT '' CHECK (length(neighbourhood) <= 80),
  price BIGINT CHECK (price IS NULL OR price BETWEEN 1 AND 2000000000),
  rooms NUMERIC(3,1) CHECK (rooms IS NULL OR rooms BETWEEN 0.5 AND 30),
  size_sqm INT CHECK (size_sqm IS NULL OR size_sqm BETWEEN 1 AND 100000),
  floor INT CHECK (floor IS NULL OR floor BETWEEN -5 AND 200),
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  photo_media_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  owner_consent BOOLEAN NOT NULL DEFAULT FALSE,
  owner_consent_at TIMESTAMPTZ,
  license_number TEXT NOT NULL DEFAULT '' CHECK (length(license_number) <= 20),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','PAUSED','SOLD','RENTED')),
  campaign_task_id UUID,
  meta_campaign_id TEXT CHECK (meta_campaign_id IS NULL OR meta_campaign_id ~ '^[0-9]{1,40}$'),
  pause_action_id TEXT,
  closed_at TIMESTAMPTZ,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Nothing is advertised without the property owner's consent.
  CONSTRAINT properties_active_needs_consent CHECK (status <> 'ACTIVE' OR owner_consent)
);
CREATE INDEX IF NOT EXISTS properties_client_status ON properties(client_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS properties_pause_action ON properties(client_id, pause_action_id) WHERE pause_action_id IS NOT NULL;

-- Real photos are kept here (WhatsApp media references expire), small and per tenant.
CREATE TABLE IF NOT EXISTS property_photos (
  id UUID PRIMARY KEY,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  bytes BYTEA NOT NULL CHECK (octet_length(bytes) BETWEEN 100 AND 6000000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS property_photos_property ON property_photos(client_id, property_id, created_at);

ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS crm_leads_property ON crm_leads(client_id, property_id) WHERE property_id IS NOT NULL;
ALTER TABLE organic_posts ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS organic_posts_property ON organic_posts(client_id, property_id) WHERE property_id IS NOT NULL;
