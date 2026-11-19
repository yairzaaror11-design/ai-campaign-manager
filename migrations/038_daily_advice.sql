-- "ההמלצה של היום": at most one recommendation per owner per business morning.
-- daily_advice_runs claims the day (also when nothing was worth sending);
-- daily_advice keeps what was sent, the owner's answer and the approvals it raised.
CREATE TABLE IF NOT EXISTS daily_advice_runs (
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  result TEXT NOT NULL DEFAULT 'STARTED',
  ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, day)
);
CREATE TABLE IF NOT EXISTS daily_advice (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  advice_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('SHIFT_BUDGET','PAUSE_WASTE','REFRESH_CREATIVE','FOLLOW_UP_LEADS','ADD_REVENUE')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  impact_text TEXT NOT NULL,
  impact_weekly NUMERIC NOT NULL DEFAULT 0,
  action JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'SENT' CHECK (status IN ('SENT','APPROVED','DISMISSED')),
  step INT NOT NULL DEFAULT 0,
  action_ids TEXT[] NOT NULL DEFAULT '{}',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  UNIQUE (client_id, day)
);
CREATE INDEX IF NOT EXISTS daily_advice_recent ON daily_advice(client_id, advice_key, sent_at);
