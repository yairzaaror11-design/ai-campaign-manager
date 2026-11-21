-- Support strict per-sender predecessor checks without scanning all live events.
CREATE INDEX whatsapp_inbound_sender_order
 ON whatsapp_inbound_events ((payload->'message'->>'from'),ingest_order)
 WHERE status IN ('PENDING','PROCESSING');
