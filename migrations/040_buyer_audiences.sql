-- Buyer-based audiences: a Meta Custom Audience of the owner's existing customers
-- (CRM leads marked WON), used to exclude buyers from new campaigns and as the
-- seed of a 1% lookalike. Only SHA-256 hashes of normalized phone numbers are
-- kept here, for the exact list the owner approved; raw numbers stay in crm_leads.
CREATE TABLE IF NOT EXISTS buyer_audience_snapshots (
  id UUID PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  ad_account_id TEXT NOT NULL CHECK (ad_account_id ~ '^act_[0-9]+$'),
  hashes TEXT[] NOT NULL,
  digest TEXT NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  buyer_count INTEGER NOT NULL CHECK (buyer_count >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS buyer_audience_snapshots_client ON buyer_audience_snapshots(client_id, created_at DESC);

-- When SCORPIO last offered (never executed) a refresh or a lookalike, so the
-- weekly background check proposes at most once a week per account.
CREATE TABLE IF NOT EXISTS buyer_audience_offers (
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  ad_account_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('SYNC','LOOKALIKE')),
  offered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, ad_account_id, kind)
);
