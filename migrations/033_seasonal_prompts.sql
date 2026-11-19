-- Proactive "the holiday is coming, prepare a campaign?" prompts: once per owner per occasion per year.
CREATE TABLE IF NOT EXISTS seasonal_prompts (
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  occasion TEXT NOT NULL,
  year INT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, occasion, year)
);
