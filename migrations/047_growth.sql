-- Growth: funnels per business type, deal value in the business's own terms, team routing,
-- and the after-sale loop (thank-you + review, referral, win-back). Idempotent.

-- Per-business growth settings: editable deal defaults, the Google review link (set once),
-- how new leads are routed to the team, and the owner's one-time approval of the cadence.
CREATE TABLE IF NOT EXISTS growth_settings (
  client_id BIGINT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  commission_pct NUMERIC(6,2) NOT NULL DEFAULT 2 CHECK (commission_pct >= 0 AND commission_pct <= 100),
  rent_commission_pct NUMERIC(6,2) NOT NULL DEFAULT 100 CHECK (rent_commission_pct >= 0 AND rent_commission_pct <= 300),
  review_url TEXT CHECK (review_url IS NULL OR (length(review_url) <= 500 AND review_url ~ '^https://')),
  routing TEXT NOT NULL DEFAULT 'OWNER' CHECK (routing IN ('OWNER','ROUND_ROBIN','AREA')),
  rr_cursor INTEGER NOT NULL DEFAULT 0,
  outreach_approved_at TIMESTAMPTZ,
  referral_days INTEGER NOT NULL DEFAULT 14 CHECK (referral_days BETWEEN 3 AND 180),
  winback_days INTEGER CHECK (winback_days IS NULL OR winback_days BETWEEN 14 AND 730),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Team members get leads (round-robin or by area/item). They are notified on WhatsApp only
-- after they themselves wrote the join code to the agent (opted_in_at).
CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  phone TEXT CHECK (phone IS NULL OR phone ~ '^[0-9]{8,15}$'),
  areas JSONB NOT NULL DEFAULT '[]'::jsonb,
  item_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  join_code TEXT NOT NULL CHECK (join_code ~ '^[0-9]{6}$'),
  opted_in_at TIMESTAMPTZ,
  opted_out_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS team_members_phone ON team_members(client_id, phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS team_members_join_code ON team_members(join_code);
CREATE INDEX IF NOT EXISTS team_members_client ON team_members(client_id, created_at);

-- Leads carry their funnel, their team member, and the deal in the business's terms.
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS funnel TEXT CHECK (funnel IS NULL OR funnel ~ '^[a-z_]{2,40}$');
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS assigned_member_id UUID REFERENCES team_members(id) ON DELETE SET NULL;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS deal_value_minor BIGINT CHECK (deal_value_minor IS NULL OR deal_value_minor >= 0);
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS commission_pct NUMERIC(6,2) CHECK (commission_pct IS NULL OR (commission_pct >= 0 AND commission_pct <= 300));
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS customer_consent BOOLEAN;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS crm_leads_member ON crm_leads(client_id, assigned_member_id) WHERE assigned_member_id IS NOT NULL;

-- Which funnel a prepared campaign belongs to (by agent task first, Meta campaign id once known).
CREATE TABLE IF NOT EXISTS growth_campaign_funnels (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  task_id UUID,
  campaign_id TEXT CHECK (campaign_id IS NULL OR campaign_id ~ '^[0-9]{1,40}$'),
  funnel TEXT NOT NULL CHECK (funnel ~ '^[a-z_]{2,40}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS growth_campaign_funnels_client ON growth_campaign_funnels(client_id, campaign_id);

-- The after-sale loop: one row per planned customer message.
CREATE TABLE IF NOT EXISTS growth_outreach (
  id UUID PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('THANKS_REVIEW','REFERRAL','WINBACK')),
  status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','OFFERED','SENT','LINK_GIVEN','SKIPPED','OPTED_OUT')),
  due_at TIMESTAMPTZ NOT NULL,
  wa_phone TEXT CHECK (wa_phone IS NULL OR wa_phone ~ '^[0-9]{8,15}$'),
  body TEXT CHECK (body IS NULL OR length(body) <= 1000),
  offered_at TIMESTAMPTZ,
  done_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lead_id, kind)
);
CREATE INDEX IF NOT EXISTS growth_outreach_due ON growth_outreach(status, due_at);
CREATE INDEX IF NOT EXISTS growth_outreach_client ON growth_outreach(client_id, due_at);

-- Timeline kinds for growth. Widen whatever check exists (never narrow it).
DO $$
DECLARE def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
    WHERE conname='lead_events_kind_check' AND conrelid='lead_events'::regclass;
  IF def IS NOT NULL AND position('OUTREACH' IN def)=0 THEN
    ALTER TABLE lead_events DROP CONSTRAINT lead_events_kind_check;
    EXECUTE 'ALTER TABLE lead_events ADD CONSTRAINT lead_events_kind_check '
      || regexp_replace(def, '^CHECK \((.*)\)$', 'CHECK ((\1) OR kind IN (''ASSIGNED'',''DEAL'',''OUTREACH''))');
  END IF;
END $$;
