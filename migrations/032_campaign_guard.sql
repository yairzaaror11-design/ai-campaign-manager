-- Daily campaign guard: one review per owner per day, and each alert at most
-- once per campaign and kind in a 3-day window.
CREATE TABLE IF NOT EXISTS campaign_guard_runs (
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, day)
);
CREATE TABLE IF NOT EXISTS campaign_guard_alerts (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ACCOUNT','DELIVERY','WASTE','WINNER','FATIGUE')),
  action_id TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS campaign_guard_alerts_recent ON campaign_guard_alerts(client_id, campaign_id, kind, sent_at);
CREATE INDEX IF NOT EXISTS campaign_guard_alerts_action ON campaign_guard_alerts(client_id, action_id);
