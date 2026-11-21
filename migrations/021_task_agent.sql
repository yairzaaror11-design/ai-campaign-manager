CREATE TABLE agent_tasks (
 id UUID PRIMARY KEY,
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 request TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'READY',
 revision INTEGER NOT NULL DEFAULT 1,
 state JSONB NOT NULL DEFAULT '{}'::jsonb,
 lease_token UUID,
 lease_until TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX agent_one_open_task ON agent_tasks(client_id) WHERE status NOT IN ('COMPLETE','CANCELLED');
CREATE TABLE agent_task_turns (
 client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL,
 task_id UUID NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
 fingerprint TEXT NOT NULL,
 result JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(client_id,request_id)
);
