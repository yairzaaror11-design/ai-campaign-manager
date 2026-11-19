-- Speed to lead: when the owner first got back to each lead, and the ready
-- first message SCORPIO drafted for them (the owner sends it from their own WhatsApp).
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS first_contact_at TIMESTAMPTZ;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS ready_message TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='crm_leads_ready_message_length') THEN
    ALTER TABLE crm_leads ADD CONSTRAINT crm_leads_ready_message_length CHECK (ready_message IS NULL OR length(ready_message) <= 1000);
  END IF;
END $$;
-- Backfill from the lead timeline: the first move out of NEW into a contacted stage.
UPDATE crm_leads l SET first_contact_at=e.at
FROM (SELECT lead_id, MIN(at) AS at FROM lead_events WHERE kind='STATUS' AND detail IN ('CONTACTED','APPOINTMENT','WON') GROUP BY lead_id) e
WHERE e.lead_id=l.id AND l.first_contact_at IS NULL;
CREATE INDEX IF NOT EXISTS crm_leads_first_contact ON crm_leads(client_id, created_at) WHERE first_contact_at IS NOT NULL;
