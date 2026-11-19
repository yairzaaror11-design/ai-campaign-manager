-- Timeline of each lead: when it arrived, every stage change, notes and reminders.
CREATE TABLE IF NOT EXISTS lead_events (
  id BIGSERIAL PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('CREATED','STATUS','NOTE','REVENUE','REMINDER')),
  detail TEXT NOT NULL DEFAULT '' CHECK (length(detail) <= 300),
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lead_events_lead ON lead_events(lead_id, at);
