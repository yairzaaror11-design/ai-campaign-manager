-- Proactive follow-up questions to the owner about each lead's progress.
-- One question per lead per stage, ever.
CREATE TABLE IF NOT EXISTS lead_checkins (
  lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('NEW','CONTACTED','APPOINTMENT')),
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (lead_id, stage)
);
CREATE INDEX IF NOT EXISTS lead_checkins_client_recent ON lead_checkins(client_id, sent_at);
