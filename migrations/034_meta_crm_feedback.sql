-- CRM feedback to Meta (Conversions API for lead ads): each lead stage is
-- reported once so Meta can optimise for leads that become customers.
CREATE TABLE IF NOT EXISTS meta_crm_events (
  lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('NEW','CONTACTED','APPOINTMENT','WON')),
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  meta_lead_id TEXT NOT NULL CHECK (meta_lead_id ~ '^[0-9]{1,40}$'),
  event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','SKIPPED','FAILED')),
  reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (lead_id, stage)
);
CREATE INDEX IF NOT EXISTS meta_crm_events_due ON meta_crm_events(available_at) WHERE status='PENDING';
CREATE TABLE IF NOT EXISTS meta_crm_datasets (
  client_id BIGINT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  ad_account_id TEXT NOT NULL,
  dataset_id TEXT CHECK (dataset_id IS NULL OR dataset_id ~ '^[0-9]{1,40}$'),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
