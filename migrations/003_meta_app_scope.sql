-- Existing tokens and login secrets remain stored but require reconnection.
-- Never attribute a legacy credential to a different Meta app automatically.
ALTER TABLE meta_connections ADD COLUMN IF NOT EXISTS app_id TEXT;
ALTER TABLE meta_login_secrets ADD COLUMN IF NOT EXISTS app_id TEXT;
