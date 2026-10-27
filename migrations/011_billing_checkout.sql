CREATE TABLE billing_checkouts (
 id UUID PRIMARY KEY,
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 provider_session_id TEXT UNIQUE,
 price_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','READY','COMPLETE','FAILED')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX billing_checkout_client ON billing_checkouts(client_id,created_at DESC);
CREATE TABLE billing_invoices (
 provider_invoice_id TEXT PRIMARY KEY,
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 amount_paid_minor BIGINT NOT NULL CHECK(amount_paid_minor>=0),
 currency TEXT NOT NULL,
 status TEXT NOT NULL,
 hosted_url TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE billing_subscription_state (
 provider_subscription_id TEXT PRIMARY KEY,
 status TEXT NOT NULL CHECK(status IN ('ACTIVE','PAST_DUE','CANCELLED')),
 last_event_created BIGINT NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
