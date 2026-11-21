CREATE TABLE meta_lead_sources (
  form_id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  meta_generation BIGINT NOT NULL,
  app_id TEXT NOT NULL
);

CREATE TABLE meta_lead_events (
  lead_id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL REFERENCES meta_lead_sources(form_id) ON DELETE CASCADE,
  generation BIGINT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','DONE','FAILED'))
);
CREATE INDEX meta_lead_events_pending ON meta_lead_events(available_at) WHERE status='PENDING';
