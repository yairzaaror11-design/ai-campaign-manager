CREATE TABLE customer_accounts (
 client_id BIGINT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
 display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120),
 email TEXT CHECK(email IS NULL OR length(email)<=254),
 consent_version TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE portal_login_tickets (
 token_hash TEXT PRIMARY KEY,
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 expires_at TIMESTAMPTZ NOT NULL,
 used_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX portal_ticket_expiry ON portal_login_tickets(expires_at);
CREATE TABLE portal_sessions (
 token_hash TEXT PRIMARY KEY,
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 csrf_hash TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX portal_session_expiry ON portal_sessions(expires_at);
CREATE TABLE crm_leads (
 id UUID PRIMARY KEY,
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 phone TEXT CHECK(phone IS NULL OR length(phone)<=30),
 email TEXT CHECK(email IS NULL OR length(email)<=254),
 source TEXT NOT NULL CHECK(length(source)<=200),
 source_event_id TEXT,
 campaign_id TEXT,
 status TEXT NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW','CONTACTED','APPOINTMENT','WON','LOST')),
 revenue_minor BIGINT CHECK(revenue_minor IS NULL OR revenue_minor>=0),
 currency TEXT CHECK(currency IS NULL OR currency IN ('ILS','USD','EUR')),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=2000),
 version INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(client_id,source,source_event_id)
);
CREATE INDEX crm_client_updated ON crm_leads(client_id,updated_at DESC);
CREATE TABLE customer_subscriptions (
 client_id BIGINT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
 plan_code TEXT NOT NULL DEFAULT 'PILOT',
 status TEXT NOT NULL DEFAULT 'PILOT' CHECK(status IN ('PILOT','ACTIVE','PAST_DUE','CANCELLED')),
 provider TEXT,
 provider_customer_id TEXT,
 provider_subscription_id TEXT UNIQUE,
 period_end TIMESTAMPTZ,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE billing_events (
 provider TEXT NOT NULL,
 event_id TEXT NOT NULL,
 result TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(provider,event_id)
);
