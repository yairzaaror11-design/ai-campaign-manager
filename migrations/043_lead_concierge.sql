-- Lead concierge: the agent answers a new lead first (in the business's name),
-- asks a few qualification questions, and books a viewing. Idempotent.

-- Per-business opt-in, business type (question set) and weekly meeting availability.
CREATE TABLE IF NOT EXISTS lead_concierge_settings (
  client_id BIGINT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  decided_at TIMESTAMPTZ,
  asked_at TIMESTAMPTZ,
  availability JSONB NOT NULL DEFAULT '[]'::jsonb,
  slot_minutes INTEGER NOT NULL DEFAULT 60 CHECK (slot_minutes BETWEEN 15 AND 240),
  vertical TEXT CHECK (vertical IS NULL OR vertical ~ '^[a-z_]{2,30}$'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One agent conversation per lead. wa_phone is the lead's WhatsApp number (digits only).
CREATE TABLE IF NOT EXISTS lead_conversations (
  id UUID PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  wa_phone TEXT NOT NULL CHECK (wa_phone ~ '^[0-9]{8,15}$'),
  vertical TEXT NOT NULL DEFAULT 'default' CHECK (vertical ~ '^[a-z_]{2,30}$'),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONTACTED','QUALIFYING','SCHEDULING','BOOKED','DONE','OWNER','OPTED_OUT','FALLBACK')),
  step TEXT,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  score TEXT CHECK (score IS NULL OR score IN ('HOT','WARM','COLD')),
  ui JSONB,
  fallback_reason TEXT,
  first_outbox_id UUID,
  handoff_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lead_id)
);
CREATE INDEX IF NOT EXISTS lead_conversations_phone ON lead_conversations(wa_phone, updated_at DESC);
CREATE INDEX IF NOT EXISTS lead_conversations_client ON lead_conversations(client_id, created_at DESC);

-- Every message the agent sent in the business's name, and every lead reply.
CREATE TABLE IF NOT EXISTS lead_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES lead_conversations(id) ON DELETE CASCADE,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  body TEXT NOT NULL CHECK (length(body) <= 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lead_messages_conversation ON lead_messages(conversation_id, id);

-- People who wrote "הסר" to a business are never contacted by it again.
CREATE TABLE IF NOT EXISTS lead_optouts (
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  wa_phone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, wa_phone)
);

CREATE TABLE IF NOT EXISTS lead_viewings (
  id UUID PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES lead_conversations(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'BOOKED' CHECK (status IN ('BOOKED','ATTENDED','NO_SHOW','PROGRESSING','CANCELLED')),
  reminder_status TEXT,
  outcome_asked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS lead_viewings_no_double_booking ON lead_viewings(client_id, starts_at) WHERE status='BOOKED';
CREATE INDEX IF NOT EXISTS lead_viewings_due ON lead_viewings(status, starts_at);

-- Timeline kinds for the concierge. Widen whatever check exists (never narrow it).
DO $$
DECLARE def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
    WHERE conname='lead_events_kind_check' AND conrelid='lead_events'::regclass;
  IF def IS NOT NULL AND position('CONCIERGE_FALLBACK' IN def)=0 THEN
    ALTER TABLE lead_events DROP CONSTRAINT lead_events_kind_check;
    EXECUTE 'ALTER TABLE lead_events ADD CONSTRAINT lead_events_kind_check '
      || regexp_replace(def, '^CHECK \((.*)\)$', 'CHECK ((\1) OR kind IN (''CONCIERGE'',''CONCIERGE_FALLBACK'',''VIEWING''))');
  END IF;
END $$;
