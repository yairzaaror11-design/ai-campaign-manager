-- Spend safety: the owner's own daily ad-spend ceiling (in the ad account currency),
-- a midday guard run, and the new guard alert kinds.
CREATE TABLE IF NOT EXISTS client_spend_caps (
  client_id BIGINT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  daily_cap NUMERIC(12,2) NOT NULL CHECK (daily_cap > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS campaign_guard_intraday_runs (
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  slot SMALLINT NOT NULL,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, day, slot)
);
ALTER TABLE campaign_guard_alerts DROP CONSTRAINT IF EXISTS campaign_guard_alerts_kind_check;
ALTER TABLE campaign_guard_alerts ADD CONSTRAINT campaign_guard_alerts_kind_check
  CHECK (kind IN ('ACCOUNT','DELIVERY','WASTE','WINNER','FATIGUE','SPEND_CAP','BURN_NO_LEADS','HIGH_CPL'));
