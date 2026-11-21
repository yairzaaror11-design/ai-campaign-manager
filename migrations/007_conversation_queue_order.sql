ALTER TABLE whatsapp_inbound_events ADD COLUMN IF NOT EXISTS ingest_order BIGSERIAL;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_inbound_ingest_order ON whatsapp_inbound_events(ingest_order);
ALTER TABLE whatsapp_outbox ADD COLUMN IF NOT EXISTS delivery_order BIGSERIAL;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_outbox_delivery_order ON whatsapp_outbox(delivery_order);
