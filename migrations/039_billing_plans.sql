-- Fair billing: three flat monthly plans, a 14-day free trial with a reminder,
-- one-step cancellation and a no-questions refund in the first paid month.
ALTER TABLE customer_subscriptions DROP CONSTRAINT IF EXISTS customer_subscriptions_status_check;
ALTER TABLE customer_subscriptions ADD CONSTRAINT customer_subscriptions_status_check
  CHECK (status IN ('PILOT','TRIAL','ACTIVE','PAST_DUE','CANCELLED'));
ALTER TABLE customer_subscriptions
  ADD COLUMN IF NOT EXISTS plan_key TEXT CHECK (plan_key IN ('basic','growth','premium')),
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_prompted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS access_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_channel TEXT CHECK (cancel_channel IN ('WHATSAPP','PORTAL')),
  ADD COLUMN IF NOT EXISTS provider_cancel_status TEXT CHECK (provider_cancel_status IN ('NOT_NEEDED','DONE','MANUAL_REQUIRED'));

ALTER TABLE billing_checkouts ADD COLUMN IF NOT EXISTS plan_key TEXT;

CREATE TABLE IF NOT EXISTS billing_refund_requests (
  id UUID PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  plan_key TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('WHATSAPP','PORTAL')),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','REFUNDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
-- One open request per business at a time; repeated taps return the same request.
CREATE UNIQUE INDEX IF NOT EXISTS billing_refund_open ON billing_refund_requests(client_id) WHERE status='REQUESTED';
CREATE INDEX IF NOT EXISTS customer_subscriptions_trial_due ON customer_subscriptions(trial_ends_at) WHERE status='TRIAL' AND trial_reminder_sent_at IS NULL;
