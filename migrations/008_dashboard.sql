CREATE TABLE dashboard_sessions (
 token_hash TEXT PRIMARY KEY,
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 account_hash TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX dashboard_sessions_expiry ON dashboard_sessions(expires_at);
CREATE TABLE dashboard_leads (
 id UUID PRIMARY KEY,
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 phone TEXT NOT NULL DEFAULT '',
 email TEXT NOT NULL DEFAULT '',
 source TEXT NOT NULL DEFAULT 'dashboard',
 status TEXT NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW','CONTACTED','IN_PROGRESS','MEETING','WON','LOST','IRRELEVANT')),
 notes TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX dashboard_leads_tenant ON dashboard_leads(client_id,created_at DESC);
CREATE TABLE dashboard_tasks (
 id UUID PRIMARY KEY,
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 due_at DATE,
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','DONE')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX dashboard_tasks_tenant ON dashboard_tasks(client_id,created_at DESC);
