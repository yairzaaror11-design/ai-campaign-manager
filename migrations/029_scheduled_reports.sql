-- One proactive weekly business report per client per ISO week.
CREATE TABLE IF NOT EXISTS scheduled_reports (
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SENT','TEMPLATE_SENT','SKIPPED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, period_key)
);
