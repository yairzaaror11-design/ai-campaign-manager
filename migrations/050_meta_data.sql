-- Meta data flows (scorpio/meta-data).
-- Where a Lead Ads lead came from: page, form, ad, ad set, campaign (ids and names).
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS source_detail JSONB;
-- Cached Ads Insights per business, period and level; synced_at is shown on the connections screen.
CREATE TABLE IF NOT EXISTS meta_insights_cache (
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  period TEXT NOT NULL,
  payload JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, account_id, period)
);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS last_insights_sync TIMESTAMPTZ;
