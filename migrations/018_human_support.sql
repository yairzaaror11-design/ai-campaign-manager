CREATE TABLE support_cases (
 id UUID PRIMARY KEY,
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 channel TEXT NOT NULL CHECK(channel IN ('PORTAL','WHATSAPP')),
 reason TEXT NOT NULL,
 context JSONB NOT NULL DEFAULT '[]',
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','IN_PROGRESS','RESOLVED')),
 bot_paused BOOLEAN NOT NULL DEFAULT true,
 version INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX support_one_open ON support_cases(client_id) WHERE status<>'RESOLVED';
CREATE TABLE support_messages (
 id UUID PRIMARY KEY,
 case_id UUID NOT NULL REFERENCES support_cases(id) ON DELETE CASCADE,
 author TEXT NOT NULL CHECK(author IN ('CUSTOMER','OPERATOR','SYSTEM')),
 body TEXT NOT NULL,
 event_id TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(case_id,event_id)
);
CREATE INDEX support_messages_case ON support_messages(case_id,created_at);
CREATE TABLE support_requests (
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 event_id TEXT NOT NULL,
 case_id UUID NOT NULL REFERENCES support_cases(id) ON DELETE CASCADE,
 fingerprint TEXT NOT NULL,
 PRIMARY KEY(client_id,event_id)
);
