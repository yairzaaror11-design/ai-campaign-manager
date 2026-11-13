-- Shared authenticated-channel history; no backfill of guessed legacy messages.
ALTER TABLE agent_task_turns ADD COLUMN channel TEXT CHECK(channel IN ('PORTAL','WHATSAPP'));
ALTER TABLE agent_task_turns ADD COLUMN input_text TEXT CHECK(length(input_text)<=2000);
CREATE INDEX agent_turn_history ON agent_task_turns(client_id,created_at DESC);
